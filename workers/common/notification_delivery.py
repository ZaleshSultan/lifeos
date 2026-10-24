"""Fenced PostgreSQL delivery transitions and conservative Telegram outcomes."""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any


class WorkerError(RuntimeError):
    """Fixed diagnostic, safe to display without third-party response content."""


class TelegramDeliveryError(WorkerError):
    def __init__(
        self, outcome: str, reason: str, retry_after_seconds: int | None = None
    ):
        super().__init__(reason)
        self.outcome = outcome
        self.reason = reason
        self.retry_after_seconds = retry_after_seconds


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class TelegramApiClient:
    def __init__(self, bot_token: str, *, opener=None) -> None:
        self.api_url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
        self._open = opener or urllib.request.build_opener(_NoRedirect()).open

    def send_message(
        self,
        chat_id: str,
        text: str,
        reply_markup: dict | None = None,
        *,
        parse_mode: str | None = None,
    ) -> int:
        payload: dict[str, Any] = {
            "chat_id": chat_id,
            "text": text,
            "disable_web_page_preview": True,
        }
        if parse_mode is not None:
            payload["parse_mode"] = parse_mode
        if reply_markup is not None:
            payload["reply_markup"] = reply_markup
        request = urllib.request.Request(
            self.api_url,
            data=json.dumps(payload).encode(),
            headers={"content-type": "application/json"},
            method="POST",
        )
        try:
            with self._open(request, timeout=30) as response:
                result = json.loads(response.read(65537).decode())
        except urllib.error.HTTPError as exc:
            # Only an explicit Bot API rejection establishes that no message was sent.
            try:
                result = json.loads(exc.read(65537).decode())
            except Exception:
                raise TelegramDeliveryError(
                    "unknown", "telegram_unverified_response"
                ) from None
            if (
                not isinstance(result, dict)
                or result.get("ok") is not False
                or result.get("error_code") != exc.code
            ):
                raise TelegramDeliveryError(
                    "unknown", "telegram_unverified_response"
                ) from None
            self._rejected(result)
            raise TelegramDeliveryError("unknown", "telegram_http_unknown") from None
        except Exception:
            # A network error may occur after Telegram accepted the request.
            raise TelegramDeliveryError(
                "unknown", "telegram_transport_unknown"
            ) from None
        if not isinstance(result, dict):
            raise TelegramDeliveryError("unknown", "telegram_unverified_response")
        if result.get("ok") is False:
            self._rejected(result)
        message = result.get("result")
        message_id = message.get("message_id") if isinstance(message, dict) else None
        if (
            result.get("ok") is not True
            or type(message_id) is not int
            or message_id <= 0
        ):
            raise TelegramDeliveryError("unknown", "telegram_unverified_response")
        return message_id

    @staticmethod
    def _rejected(result: dict) -> None:
        code = result.get("error_code")
        if code == 429:
            params = result.get("parameters")
            wait = params.get("retry_after") if isinstance(params, dict) else None
            wait = wait if type(wait) is int and wait > 0 else 60
            raise TelegramDeliveryError("retry", "telegram_rate_limited", wait)
        if type(code) is int and 400 <= code < 500:
            raise TelegramDeliveryError("permanent", "telegram_rejected")
        raise TelegramDeliveryError("unknown", "telegram_server_unknown")


class DeliveryStore:
    """Mixin for existing worker REST clients; no independent connection/config."""

    def _delivery_rpc(self, name: str, body: dict | None = None):
        try:
            return self.request("POST", f"rpc/{name}", body=body or {})
        except Exception:
            raise WorkerError("notification_state_unavailable") from None

    def recover_deliveries(self, kind: str) -> dict:
        return (
            self._delivery_rpc("recover_notification_deliveries", {"p_kind": kind})
            or {}
        )

    def claim_digest(self, user_id: str, local_date: str) -> dict | None:
        rows = self._delivery_rpc(
            "claim_daily_digest", {"p_user_id": user_id, "p_local_date": local_date}
        )
        return rows[0] if rows else None

    @staticmethod
    def _claim_args(kind: str, claim: dict) -> dict:
        if not all(claim.get(key) for key in ("id", "user_id", "claim_token")):
            raise WorkerError("notification_claim_invalid")
        return {
            "p_kind": kind,
            "p_user_id": claim["user_id"],
            "p_id": claim["id"],
            "p_claim_token": claim["claim_token"],
        }

    def begin_delivery(self, kind: str, claim: dict) -> str | None:
        chat = self._delivery_rpc(
            "begin_notification_delivery", self._claim_args(kind, claim)
        )
        if chat is None:
            return None
        if type(chat) is not int or chat == 0:
            raise WorkerError("notification_recipient_invalid")
        return str(chat)

    def finish_delivery(
        self,
        kind: str,
        claim: dict,
        outcome: str,
        reason: str = "none",
        message_id: int | None = None,
        retry_after_seconds: int | None = None,
    ) -> bool:
        args = self._claim_args(kind, claim)
        args.update(
            p_outcome=outcome,
            p_reason=reason,
            p_message_id=message_id,
            p_retry_after_seconds=retry_after_seconds,
        )
        return self._delivery_rpc("finish_notification_delivery", args) is True

    def defer_reminder_delivery(self, claim: dict, not_before: str) -> bool:
        args = self._claim_args("reminder", claim)
        del args["p_kind"]
        args["p_not_before"] = not_before
        return self._delivery_rpc("defer_reminder_delivery", args) is True

    def queue_health(self) -> dict:
        return self._delivery_rpc("notification_queue_health") or {}

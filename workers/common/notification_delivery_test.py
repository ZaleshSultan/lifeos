from __future__ import annotations
import io
import json
import sys
import unittest
import urllib.error
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from common.notification_delivery import (
    DeliveryStore,
    TelegramApiClient,
    TelegramDeliveryError,
    WorkerError,
)


class Response:
    def __init__(self, payload):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass

    def read(self, n):
        return self.payload


class TelegramDeliveryTest(unittest.TestCase):
    def client(self, payload=None, error=None):
        calls = []

        def opener(request, timeout):
            calls.append(request)
            if error:
                raise error
            return Response(payload)

        return TelegramApiClient("synthetic-bot", opener=opener), calls

    def test_ack_requires_real_message_id_and_preserves_plaintext_default(self):
        c, calls = self.client(b'{"ok":true,"result":{"message_id":42}}')
        self.assertEqual(c.send_message("100", "Synthetic"), 42)
        sent = json.loads(calls[0].data)
        self.assertNotIn("parse_mode", sent)
        self.assertEqual(sent["chat_id"], "100")

    def test_digest_html_buttons_preserved(self):
        c, calls = self.client(b'{"ok":true,"result":{"message_id":42}}')
        c.send_message(
            "100", "<b>Synthetic</b>", {"inline_keyboard": []}, parse_mode="HTML"
        )
        sent = json.loads(calls[0].data)
        self.assertEqual(sent["parse_mode"], "HTML")
        self.assertEqual(sent["reply_markup"], {"inline_keyboard": []})

    def test_explicit_rate_limit_is_definitely_not_sent_retry(self):
        payload = b'{"ok":false,"error_code":429,"parameters":{"retry_after":123},"description":"private ignored response"}'
        error = urllib.error.HTTPError(
            "https://invalid", 429, "private message", {}, io.BytesIO(payload)
        )
        c, _ = self.client(error=error)
        with self.assertRaises(TelegramDeliveryError) as ctx:
            c.send_message("100", "Synthetic")
        self.assertEqual(
            (ctx.exception.outcome, ctx.exception.retry_after_seconds), ("retry", 123)
        )
        self.assertNotIn("private", str(ctx.exception))

    def test_explicit_4xx_rejection_is_terminal(self):
        for code in (400, 401, 403, 404):
            error = urllib.error.HTTPError(
                "https://invalid",
                code,
                "raw",
                {},
                io.BytesIO(json.dumps({"ok": False, "error_code": code}).encode()),
            )
            c, _ = self.client(error=error)
            with self.assertRaises(TelegramDeliveryError) as ctx:
                c.send_message("100", "Synthetic")
            self.assertEqual(ctx.exception.outcome, "permanent")

    def test_http_success_with_explicit_rejection_is_not_acknowledgement(self):
        c, _ = self.client(b'{"ok":false,"error_code":429}')
        with self.assertRaises(TelegramDeliveryError) as ctx:
            c.send_message("100", "Synthetic")
        self.assertEqual(ctx.exception.outcome, "retry")

    def test_transport_and_5xx_are_unknown_not_blindly_retried(self):
        errors = [
            TimeoutError("private Bearer token"),
            urllib.error.URLError("private medical record"),
            urllib.error.HTTPError(
                "https://invalid",
                500,
                "raw",
                {},
                io.BytesIO(b'{"ok":false,"error_code":500}'),
            ),
        ]
        for error in errors:
            c, _ = self.client(error=error)
            with self.assertRaises(TelegramDeliveryError) as ctx:
                c.send_message("100", "Synthetic")
            self.assertEqual(ctx.exception.outcome, "unknown")
            self.assertNotIn("private", str(ctx.exception))

    def test_unverified_4xx_response_does_not_prove_non_delivery(self):
        for body in [
            b"gateway rawprivate",
            b'{"ok":true}',
            b'{"ok":false,"error_code":403}',
        ]:
            c, _ = self.client(
                error=urllib.error.HTTPError(
                    "https://invalid", 429, "raw", {}, io.BytesIO(body)
                )
            )
            with self.assertRaises(TelegramDeliveryError) as ctx:
                c.send_message("100", "Synthetic")
            self.assertEqual(ctx.exception.outcome, "unknown")

    def test_malformed_and_missing_acknowledgements_unknown(self):
        for payload in [
            b"invalid private response",
            b"[]",
            b"null",
            b'{"ok":true}',
            b'{"ok":true,"result":{"message_id":true}}',
            b'{"ok":true,"result":{"message_id":0}}',
        ]:
            c, _ = self.client(payload)
            with self.assertRaises(TelegramDeliveryError) as ctx:
                c.send_message("100", "Synthetic")
            self.assertEqual(ctx.exception.outcome, "unknown")
            self.assertNotIn("private", str(ctx.exception))

    def test_redirect_cannot_resend_private_body_to_different_origin(self):
        # The configured handler refuses redirects, so urllib surfaces a 3xx as
        # an unverified outcome instead of silently performing another request.
        from common.notification_delivery import _NoRedirect

        self.assertIsNone(
            _NoRedirect().redirect_request(
                None, None, 302, "", {}, "https://evil.invalid"
            )
        )


class StoreTest(unittest.TestCase):
    def test_transitions_carry_owner_id_and_claim_token(self):
        class Client(DeliveryStore):
            def request(self, *args, **kwargs):
                self.body = kwargs["body"]
                return True

        c = Client()
        claim = {"id": "id", "user_id": "owner", "claim_token": "nonce"}
        self.assertTrue(
            c.finish_delivery("reminder", claim, "retry", "preparation_failed")
        )
        self.assertEqual(c.body["p_user_id"], "owner")
        self.assertEqual(c.body["p_id"], "id")
        self.assertEqual(c.body["p_claim_token"], "nonce")

    def test_begin_requires_a_verified_numeric_recipient(self):
        class Client(DeliveryStore):
            def request(self, *args, **kwargs):
                return self.value

        c = Client()
        claim = {"id": "id", "user_id": "owner", "claim_token": "nonce"}
        for value in [True, 0, "other-chat", {"chat_id": 100}]:
            c.value = value
            with self.assertRaises(WorkerError):
                c.begin_delivery("reminder", claim)
        c.value = 100
        self.assertEqual(c.begin_delivery("reminder", claim), "100")

    def test_missing_fence_never_calls_database(self):
        class Client(DeliveryStore):
            def request(self, *args, **kwargs):
                raise AssertionError("must not call")

        with self.assertRaises(WorkerError):
            Client().begin_delivery("reminder", {"id": "id", "user_id": "owner"})

    def test_database_diagnostics_never_propagate_to_worker_logs(self):
        class Client(DeliveryStore):
            def request(self, *args, **kwargs):
                raise OSError(
                    "private reminder content Authorization: Bearer credential"
                )

        with self.assertRaises(WorkerError) as ctx:
            Client().recover_deliveries("reminder")
        self.assertEqual(str(ctx.exception), "notification_state_unavailable")


if __name__ == "__main__":
    unittest.main()

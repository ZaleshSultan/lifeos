from __future__ import annotations

import base64
import json
import unittest
from datetime import datetime, timezone

from common.lms_sessions import LmsSessionError, decrypt_lms_session, decrypt_secret, load_encryption_key, validate_cookie

KEY = bytes(range(32))
ENV = {"ENCRYPTION_KEY": KEY.hex()}
NOW = datetime(2026, 10, 10, 12, tzinfo=timezone.utc)
FUTURE = "2026-10-11T12:00:00Z"
# Produced by Node crypto.createCipheriv with the repository's five-part layout.
NODE_CIPHERTEXT = "enc:v1:AAECAwQFBgcICQoL:h5cwWjQkIjf7vvK2DOBO4w:PCCgfreWq3TjY626ncsNHuakzlDSQX0JSwKXqHxLLJBxfM-Iya5g9VaeXYzh811ngzYP6TazgfYd9EV2c4qQzMoesh-gpQsCczvBB4qieIlU_6xACw"


def encrypted(value: object, *, packed: bool = False) -> str:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    iv = bytes(range(12))
    plain = value if isinstance(value, str) else json.dumps(value)
    payload = AESGCM(KEY).encrypt(iv, plain.encode(), None)
    if packed:
        return "enc:v1:" + base64.b64encode(iv + payload).decode()
    encode = lambda b: base64.urlsafe_b64encode(b).decode().rstrip("=")
    return ":".join(("enc:v1", encode(iv), encode(payload[-16:]), encode(payload[:-16])))


class LmsSessionsTest(unittest.TestCase):
    def session(self, value: str = NODE_CIPHERTEXT, **kwargs) -> str:
        return decrypt_lms_session(value, kwargs.pop("user_id", "user-a"), kwargs.pop("platform_type", "aitu_moodle"),
                                   expires_at=kwargs.pop("expires_at", FUTURE), now=NOW, environ=kwargs.pop("environ", ENV), **kwargs)

    def test_decrypts_actual_node_ciphertext_and_checks_owner(self):
        self.assertEqual(self.session(), "test-cookie-value")
        for owner, platform in (("user-b", "aitu_moodle"), ("user-a", "platonus")):
            with self.assertRaises(LmsSessionError) as caught:
                self.session(user_id=owner, platform_type=platform)
            self.assertEqual(caught.exception.category, "invalid_session")

    def test_valid_key_conventions_and_alias_precedence_match_backend(self):
        self.assertEqual(load_encryption_key(ENV), KEY)
        self.assertEqual(load_encryption_key({"ENCRYPTION_KEY": base64.b64encode(KEY).decode()}), KEY)
        self.assertEqual(load_encryption_key({"LIFEOS_ENCRYPTION_KEY": "x" * 32}), b"x" * 32)
        self.assertEqual(load_encryption_key({"LIFEOS_OAUTH_TOKEN_ENCRYPTION_KEY": KEY.hex()}), KEY)
        self.assertEqual(load_encryption_key({"OAUTH_TOKEN_ENCRYPTION_KEY": KEY.hex()}), KEY)
        with self.assertRaises(LmsSessionError):
            load_encryption_key({"ENCRYPTION_KEY": "", "LIFEOS_ENCRYPTION_KEY": KEY.hex()})

    def test_missing_or_invalid_key_fails_closed_without_secret_errors(self):
        for env in ({}, {"ENCRYPTION_KEY": "private-invalid-key"}, {"ENCRYPTION_KEY": "a" * 63}):
            with self.subTest(env=bool(env)):
                with self.assertRaises(LmsSessionError) as caught:
                    self.session(environ=env)
                self.assertEqual(caught.exception.category, "encryption_unavailable")
                self.assertEqual(caught.exception.state, "error")
                self.assertNotIn("private", str(caught.exception))

    def test_plaintext_malformed_tampered_or_unauthenticated_fields_are_rejected(self):
        values = ["secret-cookie", "enc:v1:bad", NODE_CIPHERTEXT + "!", NODE_CIPHERTEXT.replace("h5cw", "i5cw"),
                  encrypted("not-json"), encrypted({"version": True, "userId": "user-a", "platform": "aitu_moodle", "cookie": "secret"}),
                  encrypted({"version": 1, "userId": "user-a", "platform": "aitu_moodle", "cookie": "secret", "extra": "field"})]
        for value in values:
            with self.subTest(shape=value[:8]):
                with self.assertRaises(LmsSessionError) as caught:
                    self.session(value)
                self.assertEqual(caught.exception.category, "invalid_session")
                self.assertNotIn("secret", str(caught.exception))

    def test_expired_missing_or_naive_expiry_rejects_before_decryption(self):
        for expiry in (None, "bad-date", "2026-10-10T11:59:59Z", "2026-10-10T12:00:00Z", "2026-10-11T12:00:00"):
            with self.subTest(expiry=expiry):
                with self.assertRaises(LmsSessionError) as caught:
                    self.session(expires_at=expiry, environ={})
                self.assertEqual(caught.exception.category, "session_expired")
                self.assertEqual(caught.exception.state, "session_expired")

    def test_password_migration_compatibility_stays_authenticated_and_not_allowed_for_sessions(self):
        value = encrypted("historic-password", packed=True)
        self.assertEqual(decrypt_secret(value, ENV), "historic-password")
        with self.assertRaises(LmsSessionError):
            self.session(value)
        with self.assertRaises(LmsSessionError):
            decrypt_secret("plaintext-password", ENV)

    def test_cookie_values_reject_header_injection_and_excessive_retention_payloads(self):
        self.assertEqual(validate_cookie("safe.base64+url/token=="), "safe.base64+url/token==")
        for value in ("", "has space", "secret\r\nHost: attacker", "first; second", '"quoted"', "bad\\escape", "comma,value", "é", "a" * 16385, "ESTSAUTHPERSISTENT=secret"):
            with self.subTest(length=len(value)):
                with self.assertRaises(LmsSessionError):
                    validate_cookie(value)


if __name__ == "__main__":
    unittest.main()

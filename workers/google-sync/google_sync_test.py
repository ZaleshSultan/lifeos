from __future__ import annotations

import importlib.util
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch


MODULE_PATH = Path(__file__).with_name("google_sync.py")
SPEC = importlib.util.spec_from_file_location("google_sync", MODULE_PATH)
assert SPEC and SPEC.loader
google_sync = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = google_sync
SPEC.loader.exec_module(google_sync)


class GoogleSyncLegacyGuardTest(unittest.TestCase):
    def test_load_settings_requires_legacy_single_user_opt_in(self) -> None:
        with patch.dict(
            os.environ,
            {
                "SUPABASE_URL": "https://example.supabase.co",
                "SUPABASE_SERVICE_ROLE_KEY": "service-role",
                "LIFEOS_DEFAULT_USER_ID": "user-1",
                "GOOGLE_CLIENT_SECRETS_FILE": "secrets/client_secret.json",
                "GOOGLE_TOKEN_FILE": "secrets/token.json",
            },
            clear=True,
        ), patch.object(google_sync, "load_dotenv", lambda _path: None):
            with self.assertRaises(google_sync.SyncError) as context:
                google_sync.load_settings()

        self.assertIn(
            "LIFEOS_ENABLE_LEGACY_SINGLE_USER_GOOGLE_SYNC",
            str(context.exception),
        )

    def test_multi_user_mode_does_not_fall_back_to_default_user(self) -> None:
        with patch.dict(
            os.environ,
            {
                "SUPABASE_URL": "https://example.supabase.co",
                "SUPABASE_SERVICE_ROLE_KEY": "service-role",
                "LIFEOS_DEFAULT_USER_ID": "legacy-user-id",
                "GOOGLE_CLIENT_SECRETS_FILE": "secrets/client_secret.json",
                "GOOGLE_TOKEN_FILE": "secrets/token.json",
            },
            clear=True,
        ), patch.object(google_sync, "load_dotenv", lambda _path: None):
            with self.assertRaises(google_sync.SyncError) as context:
                google_sync.load_settings()

        message = str(context.exception)
        self.assertIn("legacy single-user mode", message)
        self.assertIn("LIFEOS_ENABLE_LEGACY_SINGLE_USER_GOOGLE_SYNC", message)


if __name__ == "__main__":
    unittest.main()

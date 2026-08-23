from __future__ import annotations

import importlib.util
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch, MagicMock

MODULE_PATH = Path(__file__).with_name("platonus_sync.py")
SPEC = importlib.util.spec_from_file_location("platonus_sync", MODULE_PATH)
assert SPEC and SPEC.loader
platonus_sync = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = platonus_sync
SPEC.loader.exec_module(platonus_sync)


class PlatonusSyncLegacyGuardTest(unittest.TestCase):
    def test_load_settings_requires_legacy_single_user_opt_in(self) -> None:
        with patch.dict(
            os.environ,
            {
                "SUPABASE_URL": "https://example.supabase.co",
                "SUPABASE_SERVICE_ROLE_KEY": "service-role",
                "LIFEOS_DEFAULT_USER_ID": "user-1",
                "PLATONUS_USERNAME": "testuser",
                "PLATONUS_PASSWORD": "testpassword",
            },
            clear=True,
        ), patch.object(platonus_sync, "load_dotenv", lambda _path: None):
            with self.assertRaises(platonus_sync.SyncError) as context:
                platonus_sync.load_settings()

        self.assertIn(
            "LIFEOS_ENABLE_LEGACY_SINGLE_USER_PLATONUS_SYNC",
            str(context.exception),
        )

    def test_mock_fallback_on_auth_failure(self) -> None:
        with patch.dict(
            os.environ,
            {
                "SUPABASE_URL": "https://example.supabase.co",
                "SUPABASE_SERVICE_ROLE_KEY": "service-role",
                "LIFEOS_DEFAULT_USER_ID": "user-1",
                "LIFEOS_ENABLE_LEGACY_SINGLE_USER_PLATONUS_SYNC": "true",
                "PLATONUS_USERNAME": "testuser",
                "PLATONUS_PASSWORD": "testpassword",
                "PLATONUS_SYNC_MOCK_MODE": "true",
            },
            clear=True,
        ), patch.object(platonus_sync, "load_dotenv", lambda _path: None):
            settings = platonus_sync.load_settings()
            client = platonus_sync.PlatonusClient(settings)

            # Simulate network failure or dynamic security blocking on login
            with patch.object(client, "_request", side_effect=Exception("Blocked")):
                client.authenticate()
                self.assertTrue(client.is_mocked)
                grades = client.fetch_grades()
                self.assertTrue(len(grades) > 0)
                self.assertEqual(grades[0]["course_title"], "Crop Production")

    def test_refuses_mock_fallback_without_explicit_opt_in(self) -> None:
        with patch.dict(
            os.environ,
            {
                "SUPABASE_URL": "https://example.supabase.co",
                "SUPABASE_SERVICE_ROLE_KEY": "service-role",
                "LIFEOS_DEFAULT_USER_ID": "user-1",
                "LIFEOS_ENABLE_LEGACY_SINGLE_USER_PLATONUS_SYNC": "true",
                "PLATONUS_USERNAME": "testuser",
                "PLATONUS_PASSWORD": "testpassword",
            },
            clear=True,
        ), patch.object(platonus_sync, "load_dotenv", lambda _path: None):
            settings = platonus_sync.load_settings()
            client = platonus_sync.PlatonusClient(settings)

            with patch.object(client, "_request", side_effect=Exception("Blocked")):
                with self.assertRaises(platonus_sync.SyncError) as ctx:
                    client.authenticate()

            self.assertIn("PLATONUS_SYNC_MOCK_MODE", str(ctx.exception))
            self.assertFalse(client.is_mocked)


if __name__ == "__main__":
    unittest.main()

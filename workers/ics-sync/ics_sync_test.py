from __future__ import annotations

import importlib.util
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch


MODULE_PATH = Path(__file__).with_name("ics_sync.py")
SPEC = importlib.util.spec_from_file_location("ics_sync", MODULE_PATH)
assert SPEC and SPEC.loader
ics_sync = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = ics_sync
SPEC.loader.exec_module(ics_sync)


class IcsSyncLegacyGuardTest(unittest.TestCase):
    def test_load_settings_requires_legacy_single_user_opt_in(self) -> None:
        with patch.dict(
            os.environ,
            {
                "SUPABASE_URL": "https://example.supabase.co",
                "SUPABASE_SERVICE_ROLE_KEY": "service-role",
                "LIFEOS_DEFAULT_USER_ID": "user-1",
            },
            clear=True,
        ), patch.object(ics_sync, "load_dotenv", lambda _path: None):
            with self.assertRaises(ics_sync.SyncError) as context:
                ics_sync.load_settings()

        self.assertIn(
            "LIFEOS_ENABLE_LEGACY_SINGLE_USER_ICS_SYNC",
            str(context.exception),
        )


if __name__ == "__main__":
    unittest.main()

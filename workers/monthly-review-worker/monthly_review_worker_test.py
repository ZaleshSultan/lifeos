from __future__ import annotations

import importlib.util
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch


MODULE_PATH = Path(__file__).with_name("monthly_review_worker.py")
SPEC = importlib.util.spec_from_file_location("monthly_review_worker", MODULE_PATH)
assert SPEC and SPEC.loader
monthly_review_worker = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = monthly_review_worker
SPEC.loader.exec_module(monthly_review_worker)


class MonthlyReviewLegacyGuardTest(unittest.TestCase):
    def test_load_settings_requires_legacy_single_user_opt_in(self) -> None:
        with patch.dict(
            os.environ,
            {
                "SUPABASE_URL": "https://example.supabase.co",
                "SUPABASE_SERVICE_ROLE_KEY": "service-role",
                "LIFEOS_DEFAULT_USER_ID": "user-1",
            },
            clear=True,
        ), patch.object(monthly_review_worker, "load_dotenv", lambda _path: None):
            with self.assertRaises(monthly_review_worker.WorkerError) as context:
                monthly_review_worker.load_settings()

        self.assertIn(
            "LIFEOS_ENABLE_LEGACY_SINGLE_USER_MONTHLY_REVIEW",
            str(context.exception),
        )

    def test_load_settings_allows_explicit_legacy_single_user_opt_in(self) -> None:
        with patch.dict(
            os.environ,
            {
                "SUPABASE_URL": "https://example.supabase.co/",
                "SUPABASE_SERVICE_ROLE_KEY": "service-role",
                "LIFEOS_DEFAULT_USER_ID": "user-1",
                "LIFEOS_ENABLE_LEGACY_SINGLE_USER_MONTHLY_REVIEW": "true",
            },
            clear=True,
        ), patch.object(monthly_review_worker, "load_dotenv", lambda _path: None):
            settings = monthly_review_worker.load_settings()

        self.assertEqual(settings.supabase_url, "https://example.supabase.co")
        self.assertEqual(settings.user_id, "user-1")
        self.assertIsNone(settings.obsidian_vault_path)


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

import importlib.util
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


MODULE_PATH = Path(__file__).with_name("obsidian_mirror.py")
SPEC = importlib.util.spec_from_file_location("obsidian_mirror", MODULE_PATH)
assert SPEC and SPEC.loader
obsidian_mirror = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = obsidian_mirror
SPEC.loader.exec_module(obsidian_mirror)


class ObsidianMirrorLegacyGuardTest(unittest.TestCase):
    def test_load_settings_requires_legacy_single_user_opt_in(self) -> None:
        with tempfile.TemporaryDirectory() as vault:
            with patch.dict(
                os.environ,
                {
                    "SUPABASE_URL": "https://example.supabase.co",
                    "SUPABASE_SERVICE_ROLE_KEY": "service-role",
                    "OBSIDIAN_VAULT_PATH": vault,
                },
                clear=True,
            ), patch.object(obsidian_mirror, "load_dotenv", lambda _path: None):
                with self.assertRaises(obsidian_mirror.WorkerError) as context:
                    obsidian_mirror.load_settings()

        self.assertIn(
            "LIFEOS_ENABLE_LEGACY_SINGLE_USER_OBSIDIAN",
            str(context.exception),
        )

    def test_load_settings_allows_explicit_legacy_single_user_opt_in(self) -> None:
        with tempfile.TemporaryDirectory() as vault:
            with patch.dict(
                os.environ,
                {
                    "SUPABASE_URL": "https://example.supabase.co/",
                    "SUPABASE_SERVICE_ROLE_KEY": "service-role",
                    "OBSIDIAN_VAULT_PATH": vault,
                    "LIFEOS_ENABLE_LEGACY_SINGLE_USER_OBSIDIAN": "true",
                },
                clear=True,
            ), patch.object(obsidian_mirror, "load_dotenv", lambda _path: None):
                settings = obsidian_mirror.load_settings()

            self.assertEqual(settings.supabase_url, "https://example.supabase.co")
            self.assertEqual(settings.vault_path, Path(vault).resolve())


if __name__ == "__main__":
    unittest.main()

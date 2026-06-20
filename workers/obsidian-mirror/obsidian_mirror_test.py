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
    def test_load_settings_ignores_legacy_vault_without_opt_in(self) -> None:
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
                settings = obsidian_mirror.load_settings()

        self.assertIsNone(settings.legacy_vault_path)

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
            self.assertEqual(settings.legacy_vault_path, Path(vault).resolve())


def sample_job(user_id: str, life_entity_id: str = "entity-1") -> dict[str, object]:
    return {
        "id": f"job-{user_id}",
        "user_id": user_id,
        "life_entity_id": life_entity_id,
        "status": "pending",
        "attempts": 0,
        "target_path": f"Captures/{user_id}.md",
    }


def sample_entity(user_id: str, entity_id: str = "entity-1") -> dict[str, object]:
    return {
        "id": entity_id,
        "user_id": user_id,
        "entity_type": "capture",
        "title": f"{user_id} capture",
        "body": "private note",
        "source": "test",
        "source_command": "test",
        "created_at": "2026-06-15T10:00:00Z",
        "updated_at": "2026-06-15T10:00:00Z",
        "metadata": {},
    }


class FakeClient:
    def __init__(
        self,
        settings_by_user: dict[str, dict[str, object] | None],
        entities_by_id: dict[str, dict[str, object]],
    ) -> None:
        self.settings_by_user = settings_by_user
        self.entities_by_id = entities_by_id
        self.completed: list[str] = []
        self.deferred: list[tuple[str, str]] = []
        self.failed: list[tuple[str, str]] = []
        self.fetches: list[tuple[str, str, str | None]] = []

    def claim_job(self, job: dict[str, object]) -> dict[str, object] | None:
        return {**job, "status": "processing"}

    def complete_job(self, job_id: str) -> None:
        self.completed.append(job_id)

    def defer_job(
        self,
        job_id: str,
        error: str,
        delay_seconds: int = 3600,
    ) -> None:
        self.deferred.append((job_id, error))

    def fail_job(self, job_id: str, error: str) -> None:
        self.failed.append((job_id, error))

    def get_user_obsidian_settings(self, user_id: str) -> dict[str, object] | None:
        return self.settings_by_user.get(user_id)

    def fetch_one(
        self,
        table: str,
        row_id: str,
        user_id: str | None = None,
    ) -> dict[str, object] | None:
        self.fetches.append((table, row_id, user_id))
        if table != "life_entities":
            return None
        row = self.entities_by_id.get(row_id)
        if row is None or row.get("user_id") != user_id:
            return None
        return row


class ObsidianMirrorRoutingTest(unittest.TestCase):
    def settings(self, legacy_vault_path: Path | None = None) -> object:
        return obsidian_mirror.Settings(
            supabase_url="https://example.supabase.co",
            service_role_key="service-role",
            batch_size=10,
            interval_seconds=30,
            dashboard_dir="Dashboards",
            legacy_vault_path=legacy_vault_path,
        )

    def connected_settings(self, user_id: str, root: Path) -> dict[str, object]:
        return {
            "user_id": user_id,
            "enabled": True,
            "is_active": True,
            "mode": "syncthing",
            "vault_path": str((root / user_id).resolve()),
            "status": "connected",
            "syncthing_folder_id": f"lifeos-{user_id.replace('-', '')}",
        }

    def test_user_a_queue_item_uses_user_a_vault_path(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            root_path = Path(root).resolve()
            client = FakeClient(
                {"user-a": self.connected_settings("user-a", root_path)},
                {"entity-a": sample_entity("user-a", "entity-a")},
            )

            with patch.object(obsidian_mirror, "MULTITENANT_VAULT_ROOT", root_path):
                processed = obsidian_mirror.process_job(
                    self.settings(),
                    client,
                    sample_job("user-a", "entity-a"),
                )

            self.assertTrue(processed)
            self.assertTrue((root_path / "user-a" / "Captures" / "user-a.md").exists())
            self.assertFalse((root_path / "user-b" / "Captures" / "user-a.md").exists())
            self.assertEqual(client.completed, ["job-user-a"])
            self.assertIn(("life_entities", "entity-a", "user-a"), client.fetches)

    def test_user_b_queue_item_uses_user_b_vault_path(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            root_path = Path(root).resolve()
            client = FakeClient(
                {
                    "user-a": self.connected_settings("user-a", root_path),
                    "user-b": self.connected_settings("user-b", root_path),
                },
                {"entity-b": sample_entity("user-b", "entity-b")},
            )

            with patch.object(obsidian_mirror, "MULTITENANT_VAULT_ROOT", root_path):
                processed = obsidian_mirror.process_job(
                    self.settings(),
                    client,
                    sample_job("user-b", "entity-b"),
                )

            self.assertTrue(processed)
            self.assertTrue((root_path / "user-b" / "Captures" / "user-b.md").exists())
            self.assertFalse((root_path / "user-a" / "Captures" / "user-b.md").exists())
            self.assertEqual(client.completed, ["job-user-b"])

    def test_disabled_or_missing_settings_do_not_write_to_any_vault(self) -> None:
        with tempfile.TemporaryDirectory() as vault:
            client = FakeClient(
                {
                    "disabled": {
                        **self.connected_settings("disabled", Path(vault).resolve()),
                        "enabled": False,
                    },
                },
                {"entity-1": sample_entity("disabled")},
            )

            processed = obsidian_mirror.process_job(
                self.settings(),
                client,
                sample_job("disabled"),
            )

            self.assertFalse(processed)
            self.assertFalse((Path(vault) / "Captures" / "disabled.md").exists())
            self.assertEqual(client.deferred[0][0], "job-disabled")

            missing_client = FakeClient({}, {"entity-1": sample_entity("missing")})
            missing_processed = obsidian_mirror.process_job(
                self.settings(),
                missing_client,
                sample_job("missing"),
            )

            self.assertFalse(missing_processed)
            self.assertEqual(missing_client.deferred[0][0], "job-missing")

    def test_legacy_vault_path_only_writes_when_legacy_flag_loaded(self) -> None:
        with tempfile.TemporaryDirectory() as vault:
            no_legacy_client = FakeClient({}, {"entity-1": sample_entity("user-a")})

            processed = obsidian_mirror.process_job(
                self.settings(),
                no_legacy_client,
                sample_job("user-a"),
            )

            self.assertFalse(processed)
            self.assertFalse((Path(vault) / "Captures" / "user-a.md").exists())

            legacy_client = FakeClient({}, {"entity-1": sample_entity("user-a")})
            legacy_processed = obsidian_mirror.process_job(
                self.settings(Path(vault)),
                legacy_client,
                sample_job("user-a"),
            )

            self.assertTrue(legacy_processed)
            self.assertTrue((Path(vault) / "Captures" / "user-a.md").exists())

    def test_queue_target_path_cannot_escape_vault_directory(self) -> None:
        with tempfile.TemporaryDirectory() as vault:
            client = FakeClient(
                {"user-a": self.connected_settings("user-a", Path(vault).resolve())},
                {"entity-1": sample_entity("user-a")},
            )
            job = sample_job("user-a")
            job["target_path"] = "../outside.md"

            with patch.object(obsidian_mirror, "MULTITENANT_VAULT_ROOT", Path(vault).resolve()):
                processed = obsidian_mirror.process_job(self.settings(), client, job)

            self.assertFalse(processed)
            self.assertFalse((Path(vault).parent / "outside.md").exists())
            self.assertEqual(client.failed[0][0], "job-user-a")


if __name__ == "__main__":
    unittest.main()

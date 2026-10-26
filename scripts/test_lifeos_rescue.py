"""No external database or Docker required; private-data-safe rescue tool tests."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import lifeos_rescue as rescue


def fixture(directory: Path, *, complete: bool = True) -> None:
    (directory / "schema.sql").write_text(
        '-- pg_dump synthetic fixture\nCREATE TABLE "public"."profiles" (user_id uuid);\n',
        encoding="utf-8",
    )
    inserts = [
        'INSERT INTO "auth"."users" (id) VALUES (NULL);',
        'INSERT INTO "auth"."identities" (id) VALUES (NULL);',
        'INSERT INTO "public"."profiles" (user_id) VALUES (NULL);',
        'INSERT INTO "public"."life_entities" (id) VALUES (NULL);',
        'INSERT INTO "public"."tasks" (id) VALUES (NULL);',
    ]
    footer = "\n-- PostgreSQL database dump complete\n" if complete else ""
    (directory / "data.sql").write_text("\n".join(inserts) + footer, encoding="utf-8")


class InventoryTests(unittest.TestCase):
    def test_synthetic_dump_is_recognized_without_printing_values(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root)
            fixture(directory)
            report = rescue.inventory(directory)
            self.assertTrue(report["data_complete"])
            self.assertEqual(report["insert_statement_count"], 5)
            self.assertEqual(report["missing_required_insert_tables"], [])
            self.assertEqual(len(report["data_sha256"]), 64)
            self.assertTrue(all("VALUES" not in name for name in report["insert_table_names"]))

    def test_unfinished_dump_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root)
            fixture(directory, complete=False)
            with self.assertRaisesRegex(rescue.RescueError, "completion marker"):
                rescue.inventory(directory)

    def test_missing_auth_identity_is_reported(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root)
            fixture(directory)
            data = directory / "data.sql"
            data.write_text(
                data.read_text(encoding="utf-8").replace(
                    'INSERT INTO "auth"."identities" (id) VALUES (NULL);\n', ""
                ),
                encoding="utf-8",
            )
            report = rescue.inventory(directory)
            self.assertIn('"auth"."identities"', report["missing_required_insert_tables"])

    def test_symlinked_input_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root)
            fixture(directory)
            (directory / "linked.sql").symlink_to(directory / "schema.sql")
            with self.assertRaises(rescue.RescueError):
                rescue.backup_file(directory, "linked.sql")

    def test_empty_file_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            directory = Path(root)
            (directory / "data.sql").touch()
            with self.assertRaises(rescue.RescueError):
                rescue.backup_file(directory, "data.sql")


class LocalSafetyTests(unittest.TestCase):
    def test_container_name_is_fixed(self) -> None:
        self.assertEqual(rescue.LOCAL_CONTAINER, "supabase_db_lifeos_rescue_rehearsal")

    def test_rehearsal_refuses_missing_system_tables(self) -> None:
        with patch.object(rescue, "check_local_container"), patch.object(
            rescue, "query", return_value="postgres|f|f|f"
        ):
            with self.assertRaisesRegex(rescue.RescueError, "pristine"):
                rescue.assert_pristine_local()

    def test_rehearsal_refuses_existing_lifeos_schema(self) -> None:
        with patch.object(rescue, "check_local_container"), patch.object(
            rescue, "query", return_value="postgres|t|t|t"
        ):
            with self.assertRaisesRegex(rescue.RescueError, "pristine"):
                rescue.assert_pristine_local()

    def test_rehearsal_refuses_existing_users(self) -> None:
        with patch.object(rescue, "check_local_container"), patch.object(
            rescue, "query", side_effect=["postgres|t|t|f", "1"]
        ):
            with self.assertRaisesRegex(rescue.RescueError, "not empty"):
                rescue.assert_pristine_local()

    def test_parse_counts(self) -> None:
        self.assertEqual(
            rescue.parse_verification("auth.users|2\norphan public.profiles|0"),
            {"auth.users": 2, "orphan public.profiles": 0},
        )

    def test_detects_orphans(self) -> None:
        with patch.object(rescue, "check_local_container"), patch.object(
            rescue, "query", return_value="auth.users|1\norphan public.profiles|1"
        ):
            with self.assertRaisesRegex(rescue.RescueError, "Orphan"):
                rescue.verify()


if __name__ == "__main__":
    unittest.main()

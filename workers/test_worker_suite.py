from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent
TEST_FILES = (
    ROOT / "common" / "lifeos_sync_test.py",
    ROOT / "reminder-worker" / "reminder_worker_test.py",
    ROOT / "google-sync" / "google_sync_test.py",
    ROOT / "ics-sync" / "ics_sync_test.py",
    ROOT / "monthly-review-worker" / "monthly_review_worker_test.py",
    ROOT / "obsidian-mirror" / "obsidian_mirror_test.py",
)


def load_module(path: Path):
    module_name = f"worker_{path.parent.name.replace('-', '_')}_{path.stem}"
    spec = importlib.util.spec_from_file_location(module_name, path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot load test module: {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


def load_tests(
    loader: unittest.TestLoader,
    _tests: unittest.TestSuite,
    _pattern: str | None,
) -> unittest.TestSuite:
    suite = unittest.TestSuite()
    for path in TEST_FILES:
        suite.addTests(loader.loadTestsFromModule(load_module(path)))
    return suite

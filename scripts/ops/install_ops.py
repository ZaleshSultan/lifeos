#!/usr/bin/env python3
"""Install only LifeOS-owned user units after backup/restore verification."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re

from ops_common import OpsError, atomic_json, command, load_config, private_dir, read_json, utcstamp

NAMES = ("lifeos-backup", "lifeos-monitor", "lifeos-restore-drill")


def render(template: str, *, root: Path, python: Path, config: Path) -> str:
    for path in [root, python, config]:
        if not path.is_absolute() or re.search(r"[\s%\x00-\x1f]", str(path)):
            raise OpsError("unit_paths_must_be_absolute_and_unambiguous")
    text = template.replace("@REPO_ROOT@", str(root)).replace("@PYTHON@", str(python)).replace("@CONFIG@", str(config))
    if re.search(r"@[A-Z_]+@", text):
        raise OpsError("unresolved_unit_placeholder")
    return text


def install(root: Path, python: Path, config_path: Path, *, apply=False) -> dict:
    config = load_config(config_path)
    if not python.is_file() or not (root / "scripts/ops/lifeos_backup.py").is_file():
        raise OpsError("ops_release_or_python_missing")
    if command(["loginctl", "show-user", str(os.getuid()), "-p", "Linger", "--value"], timeout=10).strip() != b"yes":
        raise OpsError("durable_user_startup_not_enabled")
    state = Path(config["state_dir"])
    success = read_json(state / "last-success.json", {})
    drill = read_json(state / "last-restore-success.json", {})
    if not success.get("verified") or not drill.get("success"):
        raise OpsError("backup_and_actual_restore_required_before_scheduling")
    directory = private_dir(Path.home() / ".config/systemd/user")
    rendered = {}
    for name in NAMES:
        for kind in ["service", "timer"]:
            filename = name + "." + kind
            destination = directory / filename
            if destination.is_symlink() or (destination.exists() and not destination.read_text().startswith("# Managed by LifeOS operations v1.")):
                raise OpsError("refusing_to_replace_unowned_unit")
            template = root / "deploy/systemd/user" / (filename + ".in")
            rendered[destination] = render(template.read_text(), root=root, python=python, config=config_path)
    result = {"at_utc": utcstamp(), "units": [path.name for path in rendered], "applied": apply}
    if apply:
        for path, contents in rendered.items():
            # Unit text is nonsecret; restrictive mode also protects local paths.
            temp = path.with_suffix(path.suffix + ".lifeos-new")
            if temp.exists() or temp.is_symlink():
                raise OpsError("unit_staging_path_exists")
            with temp.open("x") as stream:
                stream.write(contents)
            temp.chmod(0o600)
            os.replace(temp, path)
        command(["systemctl", "--user", "daemon-reload"], timeout=20)
        command(["systemctl", "--user", "enable", "--now", *[name + ".timer" for name in NAMES]], timeout=30)
        result["enabled_and_active"] = all(command(["systemctl", "--user", "is-enabled", name + ".timer"], timeout=10).strip() == b"enabled" and
                                            command(["systemctl", "--user", "is-active", name + ".timer"], timeout=10).strip() == b"active" for name in NAMES)
        atomic_json(state / "timer-installation.json", result)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--python", type=Path, required=True)
    parser.add_argument("--config", type=Path, default=Path.home() / ".config/lifeos/ops.json")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    os.umask(0o077)
    try:
        print(json.dumps(install(args.repo_root, args.python, args.config, apply=args.apply), sort_keys=True))
    except Exception as error:
        print(json.dumps({"status": "failed", "error": str(error) if isinstance(error, OpsError) else "unit_installation_failed"}))
        raise SystemExit(1)


if __name__ == "__main__":
    main()

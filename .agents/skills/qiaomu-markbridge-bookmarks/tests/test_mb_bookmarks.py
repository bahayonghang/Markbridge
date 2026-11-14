#!/usr/bin/env python3
"""Unit and integration tests for `scripts/mb_bookmarks.py`."""

from __future__ import annotations

import importlib.util
import io
import json
import os
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path


SKILL_ROOT = Path(__file__).resolve().parents[1]
SCRIPT_PATH = SKILL_ROOT / "scripts" / "mb_bookmarks.py"

SPEC = importlib.util.spec_from_file_location("mb_bookmarks", SCRIPT_PATH)
if SPEC is None or SPEC.loader is None:  # pragma: no cover
    raise RuntimeError("Unable to load scripts/mb_bookmarks.py")
MB = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MB)


class MbBookmarksTests(unittest.TestCase):
    def run_wrapper(self, args: list[str], env_overrides: dict[str, str] | None = None) -> tuple[int, dict]:
        saved_env = dict(os.environ)
        try:
            if env_overrides:
                os.environ.update(env_overrides)
            buf = io.StringIO()
            with redirect_stdout(buf):
                code = MB.main(args)
            raw = buf.getvalue().strip()
            self.assertTrue(raw, f"Expected JSON stdout for args={args!r}")
            return code, json.loads(raw)
        finally:
            os.environ.clear()
            os.environ.update(saved_env)

    def test_main_configures_legacy_streams_as_utf8(self) -> None:
        stdout_bytes, stderr_bytes = io.BytesIO(), io.BytesIO()
        with io.TextIOWrapper(stdout_bytes, encoding="cp1252") as stdout, io.TextIOWrapper(
            stderr_bytes, encoding="cp1252", errors="backslashreplace"
        ) as stderr:
            with redirect_stdout(stdout), redirect_stderr(stderr):
                self.assertEqual(MB.main(["--wrapper-help"]), 0)
                self.assertEqual(stdout.encoding, "utf-8")
                self.assertEqual(stderr.encoding, "utf-8")
                self.assertEqual(stdout.errors, "strict")
                self.assertEqual(stderr.errors, "backslashreplace")
                stdout.write("\u4e2d\u6587\U0001f430")
                stderr.write("\u4e2d\u6587\U0001f430")
                stdout.flush()
                stderr.flush()
                self.assertTrue(stdout_bytes.getvalue().decode("utf-8").endswith("\u4e2d\u6587\U0001f430"))
                self.assertEqual(stderr_bytes.getvalue().decode("utf-8"), "\u4e2d\u6587\U0001f430")

    def test_workspace_and_binary_resolution(self) -> None:
        workspace = MB.find_workspace_root(SKILL_ROOT)
        self.assertIsNotNone(workspace)
        assert workspace is not None
        self.assertTrue((workspace / "crates" / "skill-cli" / "Cargo.toml").is_file())

        code, payload = self.run_wrapper(["--print-bin"])
        self.assertEqual(code, 0)
        self.assertTrue(payload["ok"])
        self.assertTrue(payload["exists"])

    def test_missing_override_binary_fails_closed_without_leaking_path(self) -> None:
        missing_bin = str(SKILL_ROOT / "nonexistent-dir" / "markbridge-skill.exe")
        code, payload = self.run_wrapper(
            ["status"],
            env_overrides={"MARKBRIDGE_SKILL_BIN": missing_bin},
        )
        self.assertEqual(code, 2)
        self.assertFalse(payload["ok"])
        self.assertEqual(payload["errorCode"], "PATH_UNAVAILABLE")
        self.assertNotIn("nonexistent-dir", json.dumps(payload))

    def test_daily_database_write_gate_blocks_without_explicit_flag(self) -> None:
        with tempfile.TemporaryDirectory(prefix="mb-unit-daily-") as tmp:
            fake_daily = Path(tmp).resolve() / "com.markbridge.desktop"
            # Read-only status succeeds without creating the SQLite file
            read_code, read_payload = self.run_wrapper(["--app-data", str(fake_daily), "status"])
            self.assertEqual(read_code, 0)
            self.assertTrue(read_payload["ok"])
            self.assertFalse(read_payload["status"]["initialized"])
            self.assertFalse((fake_daily / "markbridge.sqlite").exists())

            # Write command without --allow-daily-db is rejected with READ_ONLY (exit 2)
            write_code, write_payload = self.run_wrapper(["--app-data", str(fake_daily), "init"])
            self.assertEqual(write_code, 2)
            self.assertFalse(write_payload["ok"])
            self.assertEqual(write_payload["errorCode"], "READ_ONLY")
            self.assertFalse((fake_daily / "markbridge.sqlite").exists())

            # Explicit --allow-daily-db permits initialization inside the isolated fake daily folder
            allow_code, allow_payload = self.run_wrapper(
                ["--app-data", str(fake_daily), "--allow-daily-db", "init"]
            )
            self.assertEqual(allow_code, 0)
            self.assertTrue(allow_payload["ok"])
            self.assertTrue(allow_payload["status"]["initialized"])

    def test_wrong_profile_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory(prefix="mb-unit-profile-") as tmp:
            app_data = Path(tmp).resolve() / "app-data"
            code, payload = self.run_wrapper(
                ["--app-data", str(app_data), "--profile", "chrome-prof-1", "status"]
            )
            self.assertEqual(code, 2)
            self.assertFalse(payload["ok"])
            self.assertEqual(payload["errorCode"], "WRONG_PROFILE")

    def test_self_test_full_lifecycle(self) -> None:
        code, payload = self.run_wrapper(["--self-test"])
        self.assertEqual(code, 0)
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["command"], "self-test")
        self.assertEqual(payload["profileId"], "local-skills")
        self.assertTrue(payload["tempCleaned"])
        self.assertGreaterEqual(payload["stepsPassed"], 17)


if __name__ == "__main__":
    unittest.main()

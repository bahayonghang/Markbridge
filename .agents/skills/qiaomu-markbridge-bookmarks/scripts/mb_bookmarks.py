#!/usr/bin/env python3
"""Deterministic wrapper for Markbridge's isolated `local-skills` bookmark CLI (`markbridge-skill`).

Copyright (c) 向阳乔木
X: https://x.com/vista8
GitHub: https://github.com/joeseesun/
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any


CRATE_NAME = "markbridge-skill-cli"
BIN_STEM = "markbridge-skill"


def binary_filename() -> str:
    return f"{BIN_STEM}.exe" if os.name == "nt" else BIN_STEM


def emit_error(error_code: str, message: str, exit_code: int = 2) -> int:
    payload = {
        "ok": False,
        "errorCode": error_code,
        "message": message,
    }
    sys.stdout.write(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
    return exit_code


def find_workspace_root(start: Path | None = None) -> Path | None:
    anchors = []
    if start is not None:
        anchors.append(start.resolve())
    anchors.append(Path(__file__).resolve().parent)
    anchors.append(Path.cwd().resolve())

    visited: set[Path] = set()
    for anchor in anchors:
        current = anchor if anchor.is_dir() else anchor.parent
        for candidate in (current, *current.parents):
            if candidate in visited:
                continue
            visited.add(candidate)
            if (candidate / "Cargo.toml").is_file() and (
                candidate / "crates" / "skill-cli" / "Cargo.toml"
            ).is_file():
                return candidate
    return None


def latest_source_mtime(workspace_root: Path) -> float:
    watched = [
        workspace_root / "Cargo.toml",
        workspace_root / "crates" / "skill-cli" / "Cargo.toml",
        workspace_root / "crates" / "core" / "Cargo.toml",
        workspace_root / "crates" / "protocol" / "Cargo.toml",
    ]
    source_dirs = [
        workspace_root / "crates" / "skill-cli" / "src",
        workspace_root / "crates" / "core" / "src",
        workspace_root / "crates" / "protocol" / "src",
    ]
    newest = 0.0
    for item in watched:
        if item.is_file():
            newest = max(newest, item.stat().st_mtime)
    for src_dir in source_dirs:
        if not src_dir.is_dir():
            continue
        for rs_file in src_dir.rglob("*.rs"):
            newest = max(newest, rs_file.stat().st_mtime)
        for sql_file in src_dir.rglob("*.sql"):
            newest = max(newest, sql_file.stat().st_mtime)
    return newest


def target_base_dir(workspace_root: Path, env: dict[str, str] | None = None) -> Path:
    active_env = env if env is not None else os.environ
    override = active_env.get("CARGO_TARGET_DIR", "").strip()
    if override:
        path = Path(override)
        return path if path.is_absolute() else (workspace_root / path).resolve()
    return workspace_root / "target"


def resolve_binary(
    workspace_root: Path | None = None,
    env: dict[str, str] | None = None,
    auto_build: bool = True,
) -> tuple[Path | None, tuple[str, str, int] | None]:
    active_env = dict(os.environ if env is None else env)
    override_bin = active_env.get("MARKBRIDGE_SKILL_BIN", "").strip()
    if override_bin:
        override_path = Path(override_bin)
        if override_path.is_file():
            return override_path.resolve(), None
        return None, (
            "PATH_UNAVAILABLE",
            "Configured MARKBRIDGE_SKILL_BIN executable does not exist",
            2,
        )

    root = workspace_root or find_workspace_root()
    if root is None:
        return None, (
            "PATH_UNAVAILABLE",
            "Unable to locate Markbridge workspace root containing crates/skill-cli",
            2,
        )

    src_mtime = latest_source_mtime(root)
    target_dir = target_base_dir(root, active_env)
    exe_name = binary_filename()
    candidates = [
        target_dir / "release" / exe_name,
        target_dir / "debug" / exe_name,
    ]
    for candidate in candidates:
        if candidate.is_file() and candidate.stat().st_mtime >= src_mtime:
            return candidate.resolve(), None

    if not auto_build:
        return None, (
            "PATH_UNAVAILABLE",
            "Prebuilt markbridge-skill binary is missing or stale and auto-build is disabled",
            2,
        )

    build_proc = subprocess.run(
        [
            "cargo",
            "build",
            "--quiet",
            "-p",
            CRATE_NAME,
            "--bin",
            BIN_STEM,
        ],
        cwd=root,
        env=active_env,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )
    debug_bin = target_dir / "debug" / exe_name
    if build_proc.returncode != 0 or not debug_bin.is_file():
        return None, (
            "STORAGE_ERROR",
            "Failed to build markbridge-skill binary via cargo",
            1,
        )
    return debug_bin.resolve(), None


def invoke_cli(
    binary: Path,
    cli_args: list[str],
    env: dict[str, str] | None = None,
) -> subprocess.CompletedProcess[str]:
    active_env = dict(os.environ if env is None else env)
    return subprocess.run(
        [str(binary), *cli_args],
        env=active_env,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )


def parse_json_output(proc: subprocess.CompletedProcess[str]) -> dict[str, Any]:
    raw = proc.stdout.strip()
    if not raw:
        raise AssertionError(
            f"Expected JSON stdout from CLI (exit={proc.returncode}), got empty output"
        )
    payload = json.loads(raw)
    if not isinstance(payload, dict):
        raise AssertionError("CLI stdout must be a JSON object")
    return payload


def run_self_test(binary: Path) -> int:
    steps_passed = 0
    with tempfile.TemporaryDirectory(prefix="mb-skill-selftest-") as tmp:
        temp_root = Path(tmp).resolve()
        app_data = temp_root / "isolated-app-data"
        clean_env = dict(os.environ)
        clean_env.pop("MARKBRIDGE_APP_DATA", None)

        def call(args: list[str], expect_code: int = 0) -> dict[str, Any]:
            nonlocal steps_passed
            proc = invoke_cli(binary, ["--app-data", str(app_data), *args], env=clean_env)
            data = parse_json_output(proc)
            if proc.returncode != expect_code:
                raise AssertionError(
                    f"Command {args!r} exited {proc.returncode}, expected {expect_code}: {data.get('errorCode')}"
                )
            steps_passed += 1
            return data

        # 1. status on uninitialized isolated DB
        st0 = call(["status"])
        assert st0["ok"] is True and st0["status"]["initialized"] is False

        # 2. init
        init_res = call(["init"])
        assert init_res["status"]["initialized"] is True
        assert init_res["status"]["profileId"] == "local-skills"
        assert init_res["status"]["rootId"] == "skills-root"

        # 3. mkdir top-level folder
        mkdir_top = call(["mkdir", "--title", "工程文档"])
        folder_id = mkdir_top["result"]["node"]["chromeId"]

        # 4. mkdir nested folder
        mkdir_sub = call(["mkdir", "--parent", folder_id, "--title", "Rust 生态"])
        sub_id = mkdir_sub["result"]["node"]["chromeId"]

        # 5. add bookmark with tags, note, and summary
        added = call(
            [
                "add",
                "--parent",
                sub_id,
                "--title",
                "Tokio Async Runtime",
                "--url",
                "https://tokio.rs/tokio/tutorial",
                "--tags",
                "rust,async",
                "--note",
                "并发读写与异步任务调度笔记",
                "--summary",
                "Tokio 官方异步运行时教程与架构概览",
            ]
        )
        bm_id = added["result"]["node"]["chromeId"]

        # 6. get bookmark detail
        got = call(["get", "--id", bm_id])
        assert got["detail"]["node"]["title"] == "Tokio Async Runtime"
        assert len(got["detail"]["tags"]) == 2

        # 7. tag add
        tagged = call(["tag", "add", "--id", bm_id, "--name", "production"])
        assert len(tagged["catalog"]["tags"]) == 3

        # 8. note update
        noted = call(["note", "--id", bm_id, "--text", "已验证 WAL 并发读写与触发器同步"])
        assert "WAL 并发读写" in noted["detail"]["note"]

        # 9. summary update
        summarized = call(
            ["summary", "--id", bm_id, "--text", "涵盖 Tokio 异步调度与通道模型"]
        )
        assert "异步调度" in summarized["detail"]["summary"]

        # 10. search via FTS5 trigram + tag filter
        searched = call(["search", "--query", "并发读写", "--tags", "rust,production"])
        assert searched["page"]["total"] == 1
        assert searched["page"]["items"][0]["chromeId"] == bm_id

        # 11. tree & list
        tree_res = call(["tree"])
        assert len(tree_res["items"]) == 1
        assert tree_res["items"][0]["node"]["chromeId"] == "skills-root"
        assert len(tree_res["items"][0]["children"]) == 1
        list_res = call(["list", "--folder", sub_id])
        assert list_res["page"]["total"] == 1

        # 12. move bookmark to parent folder
        moved = call(["move", "--id", bm_id, "--parent", folder_id])
        assert moved["result"]["node"]["parentId"] == folder_id

        # 13. online SQLite backup
        backup_file = temp_root / "online-backup.sqlite"
        backed = call(["backup", "--output", str(backup_file)])
        assert backed["ok"] is True and backup_file.is_file() and backup_file.stat().st_size > 0

        # 14. export Netscape HTML & sidecar JSON
        html_file = temp_root / "export.html"
        json_file = temp_root / "export.json"
        exp_html = call(["export", "--format", "html", "--output", str(html_file)])
        exp_json = call(["export", "--format", "json", "--output", str(json_file)])
        assert exp_html["bytes"] > 0 and html_file.is_file()
        assert exp_json["bytes"] > 0 and json_file.is_file()

        # 15. protected root refusal & unsafe URL refusal
        refused_root = call(["delete", "--id", "skills-root", "--recursive"], expect_code=2)
        assert refused_root["ok"] is False and refused_root["errorCode"] == "PROTECTED_NODE"

        refused_url = call(
            ["add", "--title", "Unsafe", "--url", "javascript:alert(1)"],
            expect_code=2,
        )
        assert refused_url["ok"] is False and refused_url["errorCode"] == "INVALID_MESSAGE"

        # 16. daily DB write protection gate (simulated bundle directory inside temp_root)
        fake_daily = temp_root / "com.markbridge.desktop"
        daily_proc = invoke_cli(binary, ["--app-data", str(fake_daily), "init"], env=clean_env)
        daily_json = parse_json_output(daily_proc)
        assert daily_proc.returncode == 2 and daily_json["errorCode"] == "READ_ONLY"
        assert not (fake_daily / "markbridge.sqlite").exists()
        steps_passed += 1

        # 17. recursive folder delete with pre-delete online backup
        pre_del_backup = temp_root / "pre-delete.sqlite"
        deleted = call(
            [
                "delete",
                "--id",
                folder_id,
                "--recursive",
                "--backup",
                str(pre_del_backup),
            ]
        )
        assert deleted["result"]["deletedCount"] >= 3 and pre_del_backup.is_file()

    if temp_root.exists():
        return emit_error("STORAGE_ERROR", "Temporary self-test directory was not cleaned up", 1)

    receipt = {
        "ok": True,
        "command": "self-test",
        "profileId": "local-skills",
        "rootId": "skills-root",
        "stepsPassed": steps_passed,
        "tempCleaned": True,
    }
    sys.stdout.write(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="mb_bookmarks.py",
        description=(
            "Deterministic Python entrypoint for operating Markbridge's isolated "
            "`local-skills` SQLite bookmark library via the Rust `markbridge-skill` CLI."
        ),
        add_help=False,
    )
    parser.add_argument(
        "--wrapper-help",
        action="store_true",
        help="Show wrapper-specific options and exit.",
    )
    parser.add_argument(
        "--self-test",
        action="store_true",
        help="Run end-to-end isolated CRUD, FTS5 search, backup, and safety-gate self-test in a temp directory.",
    )
    parser.add_argument(
        "--print-bin",
        action="store_true",
        help="Resolve (and build if needed) the markbridge-skill executable and print JSON metadata.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    # CLI JSON is UTF-8, including when Windows redirects stdout to a pipe.
    # StringIO used by embedded callers has no encoding to configure.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors=stream.errors)
    raw_args = list(sys.argv[1:] if argv is None else argv)
    parser = build_parser()
    known, forwarded = parser.parse_known_args(raw_args)

    if known.wrapper_help or (not raw_args) or (raw_args in (["-h"], ["--help"])):
        if known.wrapper_help:
            parser.print_help(sys.stdout)
            return 0
        if not raw_args or raw_args in (["-h"], ["--help"]):
            binary, err = resolve_binary()
            if err is not None or binary is None:
                code, msg, status = err or ("PATH_UNAVAILABLE", "Binary unavailable", 2)
                return emit_error(code, msg, status)
            proc = invoke_cli(binary, ["--help"])
            if proc.stdout:
                sys.stdout.write(proc.stdout)
            return proc.returncode

    binary, err = resolve_binary()
    if err is not None or binary is None:
        code, msg, status = err or ("PATH_UNAVAILABLE", "Binary unavailable", 2)
        return emit_error(code, msg, status)

    if known.print_bin:
        payload = {
            "ok": True,
            "command": "print-bin",
            "binaryName": binary.name,
            "exists": binary.is_file(),
        }
        sys.stdout.write(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
        return 0

    if known.self_test:
        try:
            return run_self_test(binary)
        except Exception as exc:  # pragma: no cover - defensive redacted failure
            return emit_error(
                "STORAGE_ERROR",
                f"Self-test assertion failed ({type(exc).__name__})",
                1,
            )

    proc = invoke_cli(binary, forwarded)
    if proc.stdout:
        sys.stdout.write(proc.stdout)
    elif proc.stderr:
        return emit_error("STORAGE_ERROR", "Underlying CLI failed without JSON output", 1)
    return proc.returncode


if __name__ == "__main__":
    raise SystemExit(main())

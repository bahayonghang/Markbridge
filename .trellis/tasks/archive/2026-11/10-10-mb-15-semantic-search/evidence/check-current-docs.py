"""Validate local links in this session's changed/new Markdown, without following prose instructions."""
import json
import re
import subprocess
from pathlib import Path
from urllib.parse import unquote

root = Path(__file__).resolve().parents[4]
names = set()
for arguments in (["diff", "--name-only", "--diff-filter=AM", "-z"], ["ls-files", "--others", "--exclude-standard", "-z"]):
    result = subprocess.run(["git", *arguments], cwd=root, capture_output=True, check=True)
    names.update(value.decode("utf-8") for value in result.stdout.split(b"\0") if value)
files = sorted(name for name in names if name.endswith(".md") and "error-context" not in name)
errors, links = [], 0
for name in files:
    document = root / name
    content = document.read_text(encoding="utf-8-sig")
    content = re.sub(r"```[\s\S]*?```", "", content)
    for match in re.finditer(r"\[[^\]\n]+\]\((?:<([^>]+)>|([^\s()]+))(?:\s+\"[^\"]*\")?\)", content):
        target = match[1] or match[2]
        if target.startswith("#") or re.match(r"^[A-Za-z][A-Za-z0-9+.-]*:", target):
            continue
        target = unquote(target.split("#", 1)[0].split("?", 1)[0])
        if not target:
            continue
        links += 1
        if not (document.parent / target).exists():
            errors.append({"file": name, "target": target})
receipt = {"status": "PASS" if not errors else "FAIL", "files": files, "fileCount": len(files), "localLinks": links, "errors": errors}
Path(__file__).with_name("current-doc-links.json").write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps({key: value for key, value in receipt.items() if key != "files"}, ensure_ascii=False))
raise SystemExit(bool(errors))

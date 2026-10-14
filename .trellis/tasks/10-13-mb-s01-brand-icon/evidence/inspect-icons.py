"""Inspect actual assets, alpha, multi-size ICO frames and manifest mappings."""
from pathlib import Path
import hashlib
import json
from PIL import Image

REPO = next(parent for parent in Path(__file__).resolve().parents
            if (parent / "pnpm-workspace.yaml").is_file())
EVIDENCE = Path(__file__).parent
paths = [
    "assets/brand/markbridge-master.png",
    "apps/desktop/src/assets/markbridge.png",
    "apps/desktop/src-tauri/icons/icon.png",
    "apps/desktop/src-tauri/icons/icon.ico",
    *[f"apps/extension/public/icons/{size}.png" for size in (16, 32, 48, 128)],
    *[f"{EVIDENCE.parent.relative_to(REPO).as_posix()}/assets/{name}.png"
      for name in ("candidate-a", "candidate-b", "selected-a")],
]
report = []
for relative in paths:
    path = REPO / relative
    data = path.read_bytes()
    with Image.open(path) as image:
        entry = {"path": relative, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(),
                 "format": image.format, "mode": image.mode, "size": list(image.size)}
        if image.format == "ICO":
            entry["frames"] = sorted([list(size) for size in image.ico.sizes()])
            assert {(16, 16), (32, 32), (48, 48), (256, 256)}.issubset(image.ico.sizes())
        else:
            assert image.mode == "RGBA"
            alpha = image.getchannel("A")
            entry["alphaRange"] = list(alpha.getextrema())
            entry["nontransparentBounds"] = list(alpha.getbbox())
            edge = [alpha.getpixel((x, y)) for x in range(image.width) for y in (0, image.height - 1)]
            edge += [alpha.getpixel((x, y)) for y in range(image.height) for x in (0, image.width - 1)]
            entry["edgeAlphaMax"] = max(edge)
            entry["cornerAlpha"] = [alpha.getpixel(point) for point in
                                    ((0, 0), (image.width - 1, 0), (0, image.height - 1), (image.width - 1, image.height - 1))]
            # Low-alpha antialiasing can reach an edge in a 16px resize.
            assert entry["alphaRange"] == [0, 255] and entry["edgeAlphaMax"] <= 8 and entry["cornerAlpha"] == [0, 0, 0, 0]
            if "/icons/" in relative and "/extension/" in relative:
                assert image.size == (int(path.stem), int(path.stem))
        report.append(entry)
manifest = json.loads((REPO / "apps/extension/public/manifest.json").read_text(encoding="utf-8"))
expected = {str(size): f"icons/{size}.png" for size in (16, 32, 48, 128)}
assert manifest["icons"] == expected and manifest["action"]["default_icon"] == expected
assert manifest["permissions"] == ["bookmarks", "storage", "alarms", "scripting", "activeTab"]
assert "host_permissions" not in manifest
assert (REPO / "assets/brand/markbridge-master.png").read_bytes() == (REPO / ".trellis/tasks/10-13-mb-s01-brand-icon/assets/selected-a.png").read_bytes()
(EVIDENCE / "asset-inspection.json").write_text(json.dumps({"status": "PASS", "assets": report}, indent=2) + "\n", encoding="utf-8")
print("PASS: RGBA dimensions/transparency, ICO frames, same master, manifest mappings and unchanged permissions.")

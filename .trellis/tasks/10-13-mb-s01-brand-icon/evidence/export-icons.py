"""Re-export format/size derivatives only; the generated master is never redrawn."""
from pathlib import Path
import shutil
import subprocess
import tempfile

from PIL import Image

REPO = next(parent for parent in Path(__file__).resolve().parents
            if (parent / "pnpm-workspace.yaml").is_file())
MASTER = REPO / "assets/brand/markbridge-master.png"


def export():
    with tempfile.TemporaryDirectory(prefix=".icons-", dir=Path(__file__).parent) as directory:
        subprocess.run(
            ["node", str(REPO / "apps/desktop/node_modules/@tauri-apps/cli/tauri.js"),
             "icon", str(MASTER), "--output", directory],
            cwd=REPO, check=True,
        )
        for name in ("icon.png", "icon.ico"):
            shutil.copyfile(Path(directory) / name, REPO / "apps/desktop/src-tauri/icons" / name)
    with Image.open(MASTER) as image:
        assert image.mode == "RGBA" and image.width == image.height
        for size in (16, 32, 48, 128):
            target = REPO / f"apps/extension/public/icons/{size}.png"
            target.parent.mkdir(parents=True, exist_ok=True)
            image.resize((size, size), Image.Resampling.LANCZOS).save(target)
        target = REPO / "apps/desktop/src/assets/markbridge.png"
        target.parent.mkdir(parents=True, exist_ok=True)
        image.resize((128, 128), Image.Resampling.LANCZOS).save(target)


if __name__ == "__main__":
    export()

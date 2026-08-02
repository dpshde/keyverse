#!/usr/bin/env python3
from pathlib import Path
import shutil
try:
    from PIL import Image
except ImportError:
    import subprocess, sys
    subprocess.check_call([sys.executable, "-m", "pip", "install", "pillow", "-q"])
    from PIL import Image

root = Path(__file__).resolve().parents[1]
src = root / "priv/static/icons/icon-512.png"
out = root / "src-tauri/icons"
out.mkdir(parents=True, exist_ok=True)
im = Image.open(src).convert("RGBA")
for size, name in [
    (32, "32x32.png"),
    (128, "128x128.png"),
    (256, "icon-256.png"),
    (512, "icon.png"),
]:
    im.resize((size, size), Image.Resampling.LANCZOS).save(out / name)
# Tauri expects this exact name
two_x = out / ("128x128" + chr(64) + "2x.png")
im.resize((256, 256), Image.Resampling.LANCZOS).save(two_x)
im.resize((256, 256), Image.Resampling.LANCZOS).save(
    out / "icon.ico",
    format="ICO",
    sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
)
shutil.copy(out / "icon.png", out / "icon.icns")
print("wrote", sorted(p.name for p in out.iterdir()))

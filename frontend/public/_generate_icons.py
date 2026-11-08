"""Generate PWA icon PNGs from the Warkop Babba logo.

Run from the repo root:
    .venv/Scripts/python.exe frontend/public/_generate_icons.py
"""
from pathlib import Path

from PIL import Image

PUBLIC = Path(__file__).resolve().parent
SOURCE = PUBLIC / "LOGO WARKOP.ico"

# Sizes required by the web app manifest + Apple touch icon.
TARGETS = {
    "logo192.png": 192,
    "logo512.png": 512,
    "apple-touch-icon.png": 180,
    "favicon-32x32.png": 32,
}


def main() -> None:
    src = Image.open(SOURCE).convert("RGBA")

    # Trim fully transparent borders so the artwork fills the icon canvas.
    bbox = src.getbbox()
    if bbox:
        src = src.crop(bbox)

    for filename, size in TARGETS.items():
        # Fit the artwork inside the target square, preserving aspect ratio.
        canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        scale = min(size / src.width, size / src.height)
        new_size = (max(1, round(src.width * scale)), max(1, round(src.height * scale)))
        resized = src.resize(new_size, Image.LANCZOS)
        offset = ((size - new_size[0]) // 2, (size - new_size[1]) // 2)
        canvas.paste(resized, offset, resized)
        canvas.save(PUBLIC / filename, format="PNG", optimize=True)
        print(f"wrote {filename} ({size}x{size})")


if __name__ == "__main__":
    main()

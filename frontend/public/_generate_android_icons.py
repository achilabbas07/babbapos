from pathlib import Path
import os

from PIL import Image, ImageOps

# --- Configuration ---
# Resolve the repository root from this script's location
# (frontend/public/_generate_android_icons.py -> repo root is 3 levels up).
REPO_ROOT = Path(__file__).resolve().parents[2]

# Directory containing the raw logo asset (e.g., a high-resolution PNG or ICO).
SOURCE_LOGO_PATH = REPO_ROOT / "frontend/public/logo512.png"

# Main Android resources directory.
ANDROID_RES_DIR = REPO_ROOT / "frontend/android/app/src/main/res"

# Output directory for mipmap icons. Relative to ANDROID_RES_DIR.
MIPMAP_SIZES = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}

# Adaptive icon colors
BACKGROUND_COLOR = "#FFFFFF"

# --- Script Logic ---
def generate_launcher_icons(source_path: Path, output_dir: Path):
    """Generates all required launcher icon sizes and adaptive icon XMLs."""
    if not source_path.exists():
        print(f"Error: Source logo not found at {source_path}")
        return

    try:
        logo = Image.open(source_path).convert('RGBA')
    except Exception as e:
        print(f"Error opening source image: {e}")
        return

    # Trim transparent borders to ensure artwork fills the canvas
    bbox = logo.getbbox()
    if bbox:
        logo = logo.crop(bbox)

    # Generate standard mipmap icons
    for mipmap_folder_name, size in MIPMAP_SIZES.items():
        mipmap_path = output_dir / mipmap_folder_name
        mipmap_path.mkdir(parents=True, exist_ok=True)

        fitted_logo = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        scale = min(size / logo.width, size / logo.height)
        new_size = (int(logo.width * scale), int(logo.height * scale))
        resized_logo = logo.resize(new_size, Image.Resampling.LANCZOS)
        offset = ((size - new_size[0]) // 2, (size - new_size[1]) // 2)
        fitted_logo.paste(resized_logo, offset, resized_logo)

        icon_name = "ic_launcher"
        fitted_logo.save(mipmap_path / f"{icon_name}.png", format='PNG')
        fitted_logo.save(mipmap_path / f"{icon_name}_round.png", format='PNG')
        # For foreground, we use the same as the main icon for simplicity, 
        # but in a real app you might have a different design.
        fitted_logo.save(mipmap_path / f"{icon_name}_foreground.png", format='PNG')
        
        print(f"Generated {mipmap_folder_name}/{icon_name}.png ({size}x{size})")

    # Generate adaptive icon XMLs
    adaptive_icon_root_path = output_dir / "mipmap-anydpi-v26"
    adaptive_icon_root_path.mkdir(parents=True, exist_ok=True)

    # Create background color resource file
    values_folder = output_dir / "values"
    values_folder.mkdir(parents=True, exist_ok=True)
    background_color_file = values_folder / "ic_launcher_background.xml"
    if not background_color_file.exists():
        background_color_content = f"""<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<resources>\n    <color name=\"ic_launcher_background\">{BACKGROUND_COLOR}</color>\n</resources>"""
        with open(background_color_file, 'w') as f:
            f.write(background_color_content)
        print(f"Created background color resource: {background_color_file}")

    # Create adaptive icon XMLs
    adaptive_icon_xml_content = f"""<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<adaptive-icon xmlns:android=\"http://schemas.android.com/apk/res/android\">\n    <background android:drawable=\"@color/ic_launcher_background\"/>\n    <foreground android:drawable=\"@mipmap/ic_launcher_foreground\"/>\n</adaptive-icon>"""
    
    adaptive_icon_foreground_file = adaptive_icon_root_path / "ic_launcher.xml"
    with open(adaptive_icon_foreground_file, 'w') as f:
        f.write(adaptive_icon_xml_content)
    print(f"Created adaptive icon XML: {adaptive_icon_foreground_file}")

    adaptive_icon_round_res_file = adaptive_icon_root_path / "ic_launcher_round.xml"
    with open(adaptive_icon_round_res_file, 'w') as f:
        f.write(adaptive_icon_xml_content)
    print(f"Created adaptive icon XML: {adaptive_icon_round_res_file}")


def main():
    # Clean up existing icons before generating new ones
    # Delete existing files in mipmap-* folders
    for mipmap_folder_name in MIPMAP_SIZES:
        mipmap_path = ANDROID_RES_DIR / mipmap_folder_name
        if mipmap_path.exists():
            for item in mipmap_path.glob('ic_launcher*.*'):
                try:
                    item.unlink()
                    print(f"Removed existing icon: {item}")
                except OSError as e:
                    print(f"Error removing existing icon {item}: {e}")

    # Delete existing adaptive icon XMLs
    adaptive_icon_root_path = ANDROID_RES_DIR / "mipmap-anydpi-v26"
    if adaptive_icon_root_path.exists():
        for item in adaptive_icon_root_path.glob('ic_launcher*.xml'):
            try:
                item.unlink()
                print(f"Removed existing adaptive icon XML: {item}")
            except OSError as e:
                print(f"Error removing existing adaptive icon XML {item}: {e}")

    generate_launcher_icons(SOURCE_LOGO_PATH, ANDROID_RES_DIR)

if __name__ == "__main__":
    main()
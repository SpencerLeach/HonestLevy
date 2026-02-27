#!/usr/bin/env python3
"""
Generate PNG icons for the Chrome extension.
Run this script once to create the icon files.

Requires: pip install Pillow
"""

from PIL import Image, ImageDraw, ImageFont
import os

# Icon sizes
SIZES = [16, 48, 128]

# Colors (gradient approximation - using end color)
BG_COLOR = (106, 90, 205)  # Slate blue/purple mix
TEXT_COLOR = (255, 255, 255)

def create_icon(size):
    """Create a single icon at the given size."""
    # Create image with gradient-like background
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Draw rounded rectangle background
    radius = size // 5
    draw.rounded_rectangle(
        [(0, 0), (size - 1, size - 1)],
        radius=radius,
        fill=BG_COLOR
    )

    # Draw "G" letter
    font_size = int(size * 0.6)
    try:
        # Try to use a system font
        font = ImageFont.truetype("arial.ttf", font_size)
    except (OSError, IOError):
        try:
            font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", font_size)
        except (OSError, IOError):
            # Fall back to default font
            font = ImageFont.load_default()

    text = "G"
    bbox = draw.textbbox((0, 0), text, font=font)
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]

    x = (size - text_width) // 2
    y = (size - text_height) // 2 - bbox[1]

    draw.text((x, y), text, fill=TEXT_COLOR, font=font)

    return img


def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))

    for size in SIZES:
        img = create_icon(size)
        filename = f"icon{size}.png"
        filepath = os.path.join(script_dir, filename)
        img.save(filepath, "PNG")
        print(f"Created {filename}")

    print("Done! Icons generated.")


if __name__ == "__main__":
    main()

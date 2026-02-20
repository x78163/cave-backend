"""
Hand-drawn cave map image processing.

Converts scanned/photographed cave survey maps into transparent overlays
suitable for display on Leaflet surface maps.

Pipeline:
  1. Strip white/light background → transparent
  2. Recolor remaining ink to a chosen color (default cyan)
  3. Preserve ink density as alpha (darker = more opaque)
"""
import io
import numpy as np
from PIL import Image


def process_hand_drawn_map(
    image_file,
    color=(0, 229, 255),
    bg_threshold=230,
    output_format='PNG',
):
    """
    Process a hand-drawn cave map image:
      - Make white/light background transparent
      - Recolor ink lines to `color` with alpha derived from original darkness

    Args:
        image_file: file-like object or path to image
        color: (R, G, B) tuple for recoloring lines
        bg_threshold: pixels with all channels above this become transparent
        output_format: output image format

    Returns:
        bytes of processed PNG image
    """
    img = Image.open(image_file).convert('RGBA')
    data = np.array(img)

    # Identify background pixels (white-ish)
    bg_mask = (
        (data[:, :, 0] > bg_threshold) &
        (data[:, :, 1] > bg_threshold) &
        (data[:, :, 2] > bg_threshold)
    )

    # Make background transparent
    data[bg_mask, 3] = 0

    # Recolor foreground pixels
    fg_mask = ~bg_mask

    # Use original darkness as alpha (darker ink = higher alpha)
    # Pixels with very low darkness (near-white) are forced fully transparent
    # to avoid a faint wash over the map
    min_darkness = 40
    if fg_mask.any():
        brightness = np.mean(data[fg_mask, :3].astype(np.float32), axis=1)
        darkness = (255.0 - brightness).clip(0, 255)

        # Kill near-white foreground pixels — they're just noise
        visible = darkness >= min_darkness
        fg_indices = np.where(fg_mask)
        faint_rows = fg_indices[0][~visible]
        faint_cols = fg_indices[1][~visible]
        data[faint_rows, faint_cols, 3] = 0

        vis_rows = fg_indices[0][visible]
        vis_cols = fg_indices[1][visible]
        data[vis_rows, vis_cols, 0] = color[0]
        data[vis_rows, vis_cols, 1] = color[1]
        data[vis_rows, vis_cols, 2] = color[2]
        data[vis_rows, vis_cols, 3] = darkness[visible].astype(np.uint8)

    result = Image.fromarray(data)

    buf = io.BytesIO()
    result.save(buf, format=output_format)
    buf.seek(0)
    return buf.read()


def generate_demo_cave_map(width=600, height=500):
    """
    Generate a synthetic hand-drawn cave map for demo/testing.
    Mimics a typical survey map with passage outlines, station markers,
    scale bar, and north arrow.

    Returns:
        PIL.Image in RGBA format
    """
    from PIL import ImageDraw, ImageFont

    img = Image.new('RGB', (width, height), 'white')
    draw = ImageDraw.Draw(img)

    # Try to get a font, fall back to default
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 14)
        font_sm = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 10)
    except (IOError, OSError):
        font = ImageFont.load_default()
        font_sm = font

    # Draw cave passage (double lines like a survey map)
    # Main passage — roughly matches the user's example map shape
    passage_outer = [
        (100, 420), (120, 380), (110, 340), (130, 300),
        (160, 280), (200, 260), (250, 240), (280, 200),
        (320, 180), (360, 200), (400, 220), (420, 260),
        (400, 300), (350, 320), (300, 300), (280, 280),
        (260, 300), (260, 340), (300, 360), (350, 380),
        (400, 360), (450, 340), (500, 350), (520, 320),
    ]

    passage_inner = [
        (130, 410), (145, 375), (140, 340), (155, 305),
        (180, 285), (215, 268), (260, 250), (290, 215),
        (325, 195), (358, 210), (390, 228), (405, 258),
        (388, 292), (345, 308), (305, 292), (292, 278),
        (275, 292), (275, 335), (308, 352), (352, 368),
        (395, 350), (440, 335), (490, 342), (508, 315),
    ]

    # Draw passage walls
    draw.line(passage_outer, fill='black', width=2)
    draw.line(passage_inner, fill='black', width=2)

    # Side passage branching off
    side_outer = [(200, 260), (180, 220), (160, 180), (170, 140), (200, 120)]
    side_inner = [(215, 268), (198, 228), (182, 190), (188, 150), (210, 132)]
    draw.line(side_outer, fill='black', width=2)
    draw.line(side_inner, fill='black', width=2)

    # Station markers (circled numbers)
    stations = [
        (115, 400, '1'), (140, 310, '2'), (200, 260, '3'),
        (290, 195, '4'), (400, 240, '5'), (350, 340, '6'),
        (470, 345, '7'), (180, 180, '8'),
    ]

    for sx, sy, label in stations:
        draw.ellipse([sx - 8, sy - 8, sx + 8, sy + 8], outline='black', width=1)
        draw.text((sx - 4, sy - 7), label, fill='black', font=font_sm)

    # Entrance labels
    draw.text((60, 430), 'Main Entrance', fill='black', font=font)
    draw.text((510, 300), 'East\nEntrance', fill='black', font=font_sm)

    # North arrow
    draw.line([(50, 80), (50, 30)], fill='black', width=2)
    draw.polygon([(50, 25), (45, 40), (55, 40)], fill='black')
    draw.text((44, 10), 'N', fill='black', font=font)

    # Scale bar
    bar_y = 470
    bar_x = 350
    bar_len = 150  # pixels
    draw.line([(bar_x, bar_y), (bar_x + bar_len, bar_y)], fill='black', width=2)
    draw.line([(bar_x, bar_y - 5), (bar_x, bar_y + 5)], fill='black', width=1)
    draw.line([(bar_x + bar_len // 2, bar_y - 5), (bar_x + bar_len // 2, bar_y + 5)],
              fill='black', width=1)
    draw.line([(bar_x + bar_len, bar_y - 5), (bar_x + bar_len, bar_y + 5)],
              fill='black', width=1)
    draw.text((bar_x - 3, bar_y + 5), '0', fill='black', font=font_sm)
    draw.text((bar_x + bar_len // 2 - 5, bar_y + 5), '50', fill='black', font=font_sm)
    draw.text((bar_x + bar_len - 8, bar_y + 5), '100', fill='black', font=font_sm)
    draw.text((bar_x + bar_len + 5, bar_y + 2), 'Feet', fill='black', font=font_sm)

    # Title
    draw.text((200, 15), 'Cave Dragon Show Cave', fill='black', font=font)
    draw.text((200, 32), 'Survey Map (Demo)', fill='black', font=font_sm)

    return img

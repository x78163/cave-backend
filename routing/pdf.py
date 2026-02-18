"""PDF export for cave route itineraries using ReportLab."""

import io
import logging
from datetime import datetime

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Image as RLImage,
    Table, TableStyle, PageBreak,
)

from .visuals import generate_route_visuals

logger = logging.getLogger(__name__)

# Cyberpunk theme colors
CYBER_BG = colors.HexColor('#0a0a12')
CYBER_SURFACE = colors.HexColor('#12121e')
CYBER_CYAN = colors.HexColor('#00e5ff')
CYBER_MAGENTA = colors.HexColor('#ff00c8')
CYBER_TEXT = colors.HexColor('#e0e0e8')
CYBER_MUTED = colors.HexColor('#8888a0')


def _pil_to_rl_image(pil_img, width_mm, height_mm):
    """Convert a PIL Image to a ReportLab Image flowable."""
    buf = io.BytesIO()
    pil_img.save(buf, 'PNG')
    buf.seek(0)
    return RLImage(buf, width=width_mm * mm, height=height_mm * mm)


def generate_route_pdf(route, cave, map_data, map_mode='heatmap',
                       spawn_data=None, cave_media_dir=None,
                       heatmap_data=None):
    """Generate a PDF for a saved route.

    Args:
        route: CaveRoute model instance.
        cave: Cave model instance.
        map_data: dict loaded from the user's selected map mode JSON.
        map_mode: which map layer to render ('heatmap', 'standard', etc.)
        spawn_data: dict from spawn.json (for 3D snapshots).
        cave_media_dir: path to cave's media directory.
        heatmap_data: dict from heatmap JSON (for density background when
                      map_mode is not 'heatmap'). None if map_mode is 'heatmap'.

    Returns:
        bytes — the PDF content.
    """
    buf = io.BytesIO()

    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        topMargin=15 * mm,
        bottomMargin=15 * mm,
        leftMargin=15 * mm,
        rightMargin=15 * mm,
    )

    styles = getSampleStyleSheet()

    # Custom styles
    styles.add(ParagraphStyle(
        'CaveTitle',
        parent=styles['Title'],
        fontSize=24,
        textColor=CYBER_CYAN,
        spaceAfter=6,
    ))
    styles.add(ParagraphStyle(
        'CaveSubtitle',
        parent=styles['Heading2'],
        fontSize=14,
        textColor=CYBER_MUTED,
        spaceAfter=12,
    ))
    styles.add(ParagraphStyle(
        'InstructionText',
        parent=styles['Normal'],
        fontSize=11,
        textColor=colors.black,
        spaceAfter=4,
    ))
    styles.add(ParagraphStyle(
        'StatsText',
        parent=styles['Normal'],
        fontSize=10,
        textColor=colors.gray,
    ))
    styles.add(ParagraphStyle(
        'LevelHeader',
        parent=styles['Heading2'],
        fontSize=16,
        textColor=CYBER_CYAN,
        spaceAfter=8,
    ))

    computed = route.computed_route or {}
    instructions = computed.get('instructions', [])
    path = computed.get('path', [])
    waypoints = route.waypoints or []
    levels_used = computed.get('levels_used', [])

    # Generate all visual assets
    visuals = None
    if map_data and path:
        try:
            visuals = generate_route_visuals(
                map_data, instructions, path, waypoints,
                cave_media_dir=cave_media_dir or '/tmp',
                map_mode=map_mode,
                spawn_data=spawn_data,
                heatmap_data=heatmap_data,
            )
        except Exception:
            logger.exception('Failed to generate route visuals')

    story = []

    # --- Page 1: Title + Stats ---
    story.append(Paragraph(f'Cave Route: {route.name}', styles['CaveTitle']))
    story.append(Paragraph(f'{cave.name}', styles['CaveSubtitle']))

    # Stats table
    total_dist = computed.get('total_distance_m', 0)
    total_time = computed.get('total_time_s', 0)

    stats_data = [
        ['Distance', f'{total_dist:.1f} m'],
        ['Est. Time', f'{int(total_time // 60)} min {int(total_time % 60)} sec'],
        ['Speed', f'{route.speed_kmh} km/h'],
        ['Levels', ', '.join(f'Level {l + 1}' for l in levels_used)],
        ['Waypoints', str(len(waypoints))],
        ['Instructions', str(len(instructions))],
        ['Map Mode', map_mode.replace('_', ' ').title()],
    ]

    stats_table = Table(stats_data, colWidths=[80, 200])
    stats_table.setStyle(TableStyle([
        ('TEXTCOLOR', (0, 0), (0, -1), colors.gray),
        ('TEXTCOLOR', (1, 0), (1, -1), colors.black),
        ('FONTSIZE', (0, 0), (-1, -1), 10),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
    ]))
    story.append(stats_table)
    story.append(Spacer(1, 8 * mm))

    # --- Per-level overview maps ---
    if visuals and visuals.get('overview_images'):
        for lv_idx in sorted(visuals['overview_images'].keys()):
            overview_img = visuals['overview_images'][lv_idx]
            if overview_img:
                if len(levels_used) > 1:
                    # Find level name
                    lv_name = f'Level {lv_idx + 1}'
                    for lv in map_data.get('levels', []):
                        if lv['index'] == lv_idx:
                            lv_name = lv.get('name', lv_name)
                            break
                    story.append(Paragraph(
                        f'Overview — {lv_name}', styles['LevelHeader'],
                    ))
                story.append(_pil_to_rl_image(overview_img, 170, 170))
                story.append(Spacer(1, 5 * mm))

    story.append(Paragraph(
        f'Generated {datetime.now().strftime("%Y-%m-%d %H:%M")}',
        styles['StatsText'],
    ))

    # --- Turn-by-turn instructions ---
    story.append(PageBreak())
    story.append(Paragraph('Turn-by-Turn Directions', styles['Heading1']))
    story.append(Spacer(1, 5 * mm))

    for inst in instructions:
        idx = inst.get('index', 0)
        inst_type = inst.get('type', '')
        text = inst.get('text', '')
        dist = inst.get('cumulative_distance_m', 0)
        time_s = inst.get('cumulative_time_s', 0)
        heading = inst.get('compass_name', '')

        icon_map = {
            'start': '>>',
            'end': '[]',
            'junction': '->',
            'transition': '<>',
            'poi': '*',
        }
        icon = icon_map.get(inst_type, '-')

        # Instruction text
        story.append(Paragraph(
            f'<b>{icon} {text}</b>',
            styles['InstructionText'],
        ))

        # Stats line
        time_min = int(time_s // 60)
        time_sec = int(time_s % 60)
        meta = f'{dist:.1f}m total'
        if time_min > 0:
            meta += f' &middot; {time_min}:{time_sec:02d} elapsed'
        if heading:
            meta += f' &middot; {heading}'
        story.append(Paragraph(meta, styles['StatsText']))

        # 3D snapshot (if available)
        if visuals and visuals.get('snapshot_images'):
            snapshot = visuals['snapshot_images'].get(idx)
            if snapshot is not None:
                story.append(Spacer(1, 2 * mm))
                story.append(_pil_to_rl_image(snapshot, 140, 79))

        # 2D map crop
        if visuals and visuals.get('crop_images'):
            crop = visuals['crop_images'].get(idx)
            if crop is not None:
                story.append(Spacer(1, 2 * mm))
                story.append(_pil_to_rl_image(crop, 80, 80))

        story.append(Spacer(1, 6 * mm))

    # --- Final page: Summary table ---
    story.append(PageBreak())
    story.append(Paragraph('Route Summary', styles['Heading1']))
    story.append(Spacer(1, 5 * mm))

    summary_data = [['#', 'Type', 'Direction', 'Distance', 'Time']]
    for inst in instructions:
        idx = inst.get('index', 0)
        itype = inst.get('type', '')
        direction = inst.get('relative_text', inst.get('text', ''))[:40]
        dist = f'{inst.get("cumulative_distance_m", 0):.1f}m'
        time_s = inst.get('cumulative_time_s', 0)
        time_str = f'{int(time_s // 60)}:{int(time_s % 60):02d}'
        summary_data.append([str(idx + 1), itype, direction, dist, time_str])

    summary_table = Table(summary_data, colWidths=[30, 60, 180, 50, 50])
    summary_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#2a2a3e')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTSIZE', (0, 0), (-1, -1), 9),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#3a3a4e')),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('ALIGN', (0, 0), (0, -1), 'CENTER'),
        ('ALIGN', (3, 0), (-1, -1), 'RIGHT'),
    ]))
    story.append(summary_table)

    doc.build(story)
    return buf.getvalue()

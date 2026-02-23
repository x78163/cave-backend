"""
GOT-OCR 2.0 integration for extracting survey shot data from handwritten sheets.

Uses stepfun-ai/GOT-OCR-2.0-hf (580M params, Apache 2.0) to read tabular
survey data (From, To, Distance, Azimuth, Inclination, LRUD) from photographed
or scanned paper forms.

Model is lazy-loaded on first call and cached in memory.
"""

import re
from io import BytesIO
from PIL import Image

# Lazy-loaded model singletons
_model = None
_processor = None
_device = None


def _load_model():
    """Load GOT-OCR 2.0 model and processor (lazy singleton)."""
    global _model, _processor, _device
    if _model is not None:
        return _model, _processor

    import torch
    from transformers import AutoModelForImageTextToText, AutoProcessor

    _device = 'cuda' if torch.cuda.is_available() else 'cpu'
    _model = AutoModelForImageTextToText.from_pretrained(
        'stepfun-ai/GOT-OCR-2.0-hf',
        device_map=_device,
        low_cpu_mem_usage=True,
    )
    _processor = AutoProcessor.from_pretrained(
        'stepfun-ai/GOT-OCR-2.0-hf',
        use_fast=True,
    )
    return _model, _processor


# Column header aliases → canonical field names
HEADER_ALIASES = {
    'from': 'from_station', 'from_station': 'from_station', 'from station': 'from_station',
    'fr': 'from_station', 'sta': 'from_station', 'station': 'from_station',
    'to': 'to_station', 'to_station': 'to_station', 'to station': 'to_station',
    'dist': 'distance', 'distance': 'distance', 'len': 'distance', 'length': 'distance',
    'tape': 'distance', 'd': 'distance',
    'az': 'azimuth', 'azimuth': 'azimuth', 'bearing': 'azimuth', 'compass': 'azimuth',
    'bear': 'azimuth', 'comp': 'azimuth', 'vaz': 'azimuth',
    'inc': 'inclination', 'inclination': 'inclination', 'vert': 'inclination',
    'vertical': 'inclination', 'clino': 'inclination', 'clinometer': 'inclination',
    'v': 'inclination', 'enc': 'inclination',
    'l': 'left', 'left': 'left', 'lt': 'left',
    'r': 'right', 'right': 'right', 'rt': 'right',
    'u': 'up', 'up': 'up', 'ceil': 'up', 'ceiling': 'up',
    'd': 'down', 'down': 'down', 'dn': 'down', 'floor': 'down',
    'note': 'comment', 'notes': 'comment', 'comment': 'comment',
    'comments': 'comment', 'remarks': 'comment',
}

# Fields that must be numeric
NUMERIC_FIELDS = {'distance', 'azimuth', 'inclination', 'left', 'right', 'up', 'down'}
REQUIRED_FIELDS = {'from_station', 'to_station', 'distance', 'azimuth'}


def _match_header(header_text):
    """Fuzzy-match a column header to a canonical field name."""
    cleaned = header_text.strip().lower().rstrip(':').rstrip('#')
    # Direct match
    if cleaned in HEADER_ALIASES:
        return HEADER_ALIASES[cleaned]
    # Substring match
    for alias, field in HEADER_ALIASES.items():
        if alias in cleaned or cleaned in alias:
            return field
    return None


def _parse_number(text):
    """Try to parse a string as a float, handling common OCR errors."""
    if not text:
        return None
    cleaned = text.strip()
    if not cleaned or cleaned in ('-', '--', '—', '/', '.', ''):
        return None
    # Single-char substitutions: D/O/Q → 0 when the entire value is just that letter
    if cleaned in ('D', 'O', 'Q', 'o'):
        return 0.0
    # Common OCR substitutions: O→0, l→1, I→1
    cleaned = cleaned.replace('O', '0').replace('o', '0')
    cleaned = cleaned.replace('Q', '0')
    cleaned = cleaned.replace('l', '1').replace('I', '1')
    cleaned = cleaned.replace(',', '.')  # European decimal comma
    # Remove any non-numeric chars except .- at start
    cleaned = re.sub(r'[^\d.\-]', '', cleaned)
    try:
        return float(cleaned)
    except (ValueError, TypeError):
        return None


def _parse_markdown_table(text):
    """
    Parse a markdown table from OCR output into rows of dicts.
    Returns (column_mapping, rows, warnings).
    """
    lines = text.strip().split('\n')
    warnings = []
    rows = []

    # Find table lines (contain |)
    table_lines = [l for l in lines if '|' in l]
    if len(table_lines) < 2:
        return None, [], ['No table detected in OCR output']

    # First line with | is the header
    header_line = table_lines[0]
    cells = [c.strip() for c in header_line.split('|')]
    cells = [c for c in cells if c]  # Remove empty from leading/trailing |

    # Map headers to fields
    col_map = []
    for i, cell in enumerate(cells):
        field = _match_header(cell)
        col_map.append(field)
        if field is None:
            warnings.append(f'Column {i + 1} "{cell}" not recognized — will be ignored')

    # Check we have the minimum required columns
    mapped_fields = set(f for f in col_map if f)
    if not REQUIRED_FIELDS.issubset(mapped_fields):
        missing = REQUIRED_FIELDS - mapped_fields
        warnings.append(f'Missing required columns: {", ".join(missing)}')

    # Skip separator line (---|---|---)
    data_start = 1
    if data_start < len(table_lines) and re.match(r'^[\s|:\-]+$', table_lines[data_start]):
        data_start = 2

    # Parse data rows
    for row_idx, line in enumerate(table_lines[data_start:], start=1):
        cells = [c.strip() for c in line.split('|')]
        cells = [c for c in cells if c or True]  # Keep empty cells
        # Re-split more carefully
        cells = line.split('|')
        if cells and not cells[0].strip():
            cells = cells[1:]
        if cells and not cells[-1].strip():
            cells = cells[:-1]
        cells = [c.strip() for c in cells]

        row = {}
        row_warnings = []
        for i, cell in enumerate(cells):
            if i >= len(col_map) or col_map[i] is None:
                continue
            field = col_map[i]
            if field in NUMERIC_FIELDS:
                val = _parse_number(cell)
                if val is None and cell.strip():
                    row_warnings.append(f'could not parse {field} "{cell}"')
                row[field] = val
            else:
                row[field] = cell.strip()

        # Validate row has minimum data
        if not row.get('from_station') and not row.get('to_station'):
            continue  # Skip empty rows

        # Apply defaults
        row.setdefault('inclination', 0)
        row.setdefault('left', None)
        row.setdefault('right', None)
        row.setdefault('up', None)
        row.setdefault('down', None)
        row.setdefault('comment', '')

        if row_warnings:
            row['_warnings'] = row_warnings
            for w in row_warnings:
                warnings.append(f'Row {row_idx}: {w}')

        rows.append(row)

    return col_map, rows, warnings


STANDARD_COLUMNS = [
    'from_station', 'to_station', 'azimuth', 'distance',
    'inclination', 'left', 'right', 'up', 'down',
]


def _parse_plain_text(text):
    """
    Fallback parser for OCR output without markdown table formatting.
    Handles values output as one-per-line or space-separated.
    Groups values into rows using the standard 9-column survey order.
    """
    lines = [l.strip() for l in text.strip().split('\n') if l.strip()]
    if not lines:
        return None, [], ['Empty OCR output']

    warnings = []

    # Detect header line (first line with 2+ recognized header words)
    header_line = lines[0]
    header_tokens = re.split(r'\s+', header_line.lower())
    recognized = sum(1 for w in header_tokens if _match_header(w) is not None)

    if recognized >= 2:
        data_lines = lines[1:]
    else:
        data_lines = lines

    # Filter out separator-like lines
    data_lines = [l for l in data_lines if not re.match(r'^[\s\-|:=]+$', l)]

    # Collect all individual values — some lines may have multiple space-separated values
    values = []
    for line in data_lines:
        # If line has multiple space-separated tokens, split them
        tokens = re.split(r'\s{2,}|\t', line)  # Split on 2+ spaces or tab
        if len(tokens) > 1:
            values.extend(t.strip() for t in tokens if t.strip())
        else:
            values.append(line.strip())

    num_cols = len(STANDARD_COLUMNS)  # 9

    # Detect if there's a comment/notes column (10th value per row).
    # Heuristic: if the 10th value in a group is clearly text (contains letters
    # and doesn't look like a station name), it's a comment.
    def _is_text_value(val):
        """Check if a value is clearly text (not a number or station name)."""
        if not val:
            return False
        # If it's purely digits/dots/minus, it's numeric
        if re.match(r'^[\d.\-]+$', val):
            return False
        # Short alphanumeric like A1, B2 look like station names, not comments
        if re.match(r'^[A-Za-z]\d{1,3}$', val):
            return False
        # Contains letters beyond typical OCR misreads → likely text
        return bool(re.search(r'[a-zA-Z]{2,}', val))

    has_comments = False
    if len(values) >= 10:
        tenth = values[9] if len(values) > 9 else ''
        if _is_text_value(tenth):
            has_comments = True

    stride = num_cols + 1 if has_comments else num_cols

    # Group values into rows
    rows = []
    i = 0
    while i < len(values):
        chunk = values[i:i + stride]

        if has_comments and len(chunk) >= num_cols:
            if len(chunk) > num_cols:
                maybe_comment = chunk[num_cols]
                # If the 10th value looks like a station name or number,
                # this row has no comment — don't consume it
                if not _is_text_value(maybe_comment):
                    chunk = chunk[:num_cols]
                    i += num_cols
                else:
                    i += stride
            else:
                i += len(chunk)
        else:
            i += num_cols

        if len(chunk) < 4:  # Need at least From, To, Az, Dist
            if chunk:
                warnings.append(f'Trailing values not forming a complete row: {chunk}')
            break

        row = {}
        row_warnings = []
        for j, field in enumerate(STANDARD_COLUMNS):
            if j < len(chunk):
                val = chunk[j]
                if field in NUMERIC_FIELDS:
                    parsed = _parse_number(val)
                    if parsed is None and val:
                        row_warnings.append(f'could not parse {field} "{val}"')
                    row[field] = parsed
                else:
                    row[field] = val
            else:
                row[field] = None if field in NUMERIC_FIELDS else ''

        # If there's an extra value, treat it as a comment
        if len(chunk) > num_cols:
            row['comment'] = chunk[num_cols]

        # Validate minimum fields
        if not row.get('from_station') and not row.get('to_station'):
            continue

        row.setdefault('inclination', 0)
        row.setdefault('comment', '')

        if row_warnings:
            row['_warnings'] = row_warnings
            for w in row_warnings:
                warnings.append(f'Row {len(rows) + 1}: {w}')

        rows.append(row)

    if not rows:
        warnings.append('Could not group values into survey rows')

    return STANDARD_COLUMNS, rows, warnings


def _strip_latex(text):
    """
    Strip LaTeX formatting artifacts from GOT-OCR output.
    The model sometimes wraps values in math mode or array environments.
    """
    # Remove \begin{array}...\end{array} — extract cell contents
    # Pattern: \begin{array}{ll} 350 & 7 \end{array} → 350 7
    text = re.sub(
        r'\\begin\{array\}\{[^}]*\}(.*?)\\end\{array\}',
        lambda m: re.sub(r'\\\\|&', ' ', m.group(1)),
        text,
        flags=re.DOTALL,
    )
    # Remove inline math delimiters \( and \)
    text = text.replace('\\(', ' ').replace('\\)', ' ')
    # Remove \quad, \qquad (spacing)
    text = re.sub(r'\\q?quad\b', ' ', text)
    # Remove \text{...}, \mathrm{...}, \mathbf{...} — keep contents
    text = re.sub(r'\\(?:text|mathrm|mathbf|textbf|textit)\{([^}]*)\}', r'\1', text)
    # Remove \hline, \cline, \toprule, \midrule, \bottomrule
    text = re.sub(r'\\(?:hline|cline\{[^}]*\}|toprule|midrule|bottomrule)', '', text)
    # Remove \\ (LaTeX line breaks) → newline
    text = text.replace('\\\\', '\n')
    # Remove & (LaTeX cell separators) → space
    text = text.replace('&', ' ')
    # Remove remaining backslash commands like \, \; \! (thin spaces)
    text = re.sub(r'\\[,;!]', ' ', text)
    # Collapse multiple spaces
    text = re.sub(r'  +', ' ', text)
    # Clean up lines
    lines = [l.strip() for l in text.split('\n')]
    return '\n'.join(l for l in lines if l)


def _trim_repetition(text, threshold=3):
    """
    Detect and trim repetitive output from the model.
    If the same line (or short sequence of lines) repeats more than `threshold`
    times consecutively, truncate at the start of the repetition.
    """
    lines = text.split('\n')
    if len(lines) < threshold * 2:
        return text

    # Check for single-line repetition
    seen_count = 0
    prev = None
    cut_at = None
    for i, line in enumerate(lines):
        stripped = line.strip()
        if not stripped:
            continue
        if stripped == prev:
            seen_count += 1
            if seen_count >= threshold:
                cut_at = i - threshold + 1
                break
        else:
            seen_count = 1
            prev = stripped

    if cut_at is not None:
        return '\n'.join(lines[:cut_at])

    # Check for multi-line pattern repetition (2-3 line blocks)
    for block_size in (2, 3):
        for start in range(len(lines) - block_size * threshold):
            block = tuple(lines[start:start + block_size])
            repeats = 1
            pos = start + block_size
            while pos + block_size <= len(lines):
                if tuple(lines[pos:pos + block_size]) == block:
                    repeats += 1
                    pos += block_size
                else:
                    break
            if repeats >= threshold:
                return '\n'.join(lines[:start + block_size])

    return text


def extract_shots_from_image(image_file, expected_rows=None):
    """
    Run GOT-OCR 2.0 on an image and extract survey shot data.

    Args:
        image_file: File-like object or path to image
        expected_rows: Optional hint for how many data rows to expect.
            Used to cap max_new_tokens and prevent runaway generation.

    Returns:
        dict with keys:
            shots: list of shot dicts matching SurveyShotBulkItemSerializer schema
            raw_text: raw OCR output string
            warnings: list of warning strings
    """
    model, processor = _load_model()

    # Scale max tokens based on expected rows (~30 tokens per row + header overhead)
    if expected_rows and expected_rows > 0:
        max_tokens = min(2048, 100 + expected_rows * 40)
    else:
        max_tokens = 2048

    # Load image
    if isinstance(image_file, (str, bytes)):
        image = Image.open(image_file)
    elif hasattr(image_file, 'read'):
        image = Image.open(BytesIO(image_file.read()))
    else:
        image = image_file

    image = image.convert('RGB')

    # Run OCR with formatted output (requests markdown tables)
    inputs = processor(image, return_tensors='pt', format=True).to(_device)
    generate_ids = model.generate(
        **inputs,
        do_sample=False,
        tokenizer=processor.tokenizer,
        stop_strings='<|im_end|>',
        max_new_tokens=max_tokens,
    )
    raw_text = processor.decode(
        generate_ids[0, inputs['input_ids'].shape[1]:],
        skip_special_tokens=True,
    )

    # Trim repetitive output — detect when lines start looping
    raw_text = _trim_repetition(raw_text)

    # Strip LaTeX artifacts (model sometimes outputs math mode on blurry images)
    cleaned_text = _strip_latex(raw_text)

    # Try markdown table first, fall back to plain text grouping
    _col_map, rows, warnings = _parse_markdown_table(cleaned_text)
    if not rows:
        _col_map, rows, warnings = _parse_plain_text(cleaned_text)

    # Clean up rows for API response
    shots = []
    for row in rows:
        row_warnings = row.pop('_warnings', [])
        shot = {
            'from_station': row.get('from_station', ''),
            'to_station': row.get('to_station', ''),
            'distance': row.get('distance'),
            'azimuth': row.get('azimuth'),
            'inclination': row.get('inclination', 0),
            'left': row.get('left'),
            'right': row.get('right'),
            'up': row.get('up'),
            'down': row.get('down'),
            'comment': row.get('comment', ''),
        }
        # Flag incomplete shots
        if row_warnings:
            shot['_warnings'] = row_warnings
        shots.append(shot)

    return {
        'shots': shots,
        'raw_text': raw_text,
        'warnings': warnings,
    }

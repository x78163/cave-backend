"""Excel (.xlsx) import utilities for caves."""

import io
import openpyxl


def parse_excel_file(file_bytes):
    """Parse an Excel file into normalized row dicts (same format as CSV rows).

    Reads the first (active) sheet. First row = headers, normalized to
    lowercase with spaces replaced by underscores. Subsequent rows become
    dicts mapping header keys to string values.
    """
    wb = openpyxl.load_workbook(io.BytesIO(file_bytes), read_only=True, data_only=True)
    ws = wb.active

    rows_iter = ws.iter_rows(values_only=True)

    # First row = headers
    try:
        header_row = next(rows_iter)
    except StopIteration:
        wb.close()
        return []

    headers = []
    for h in header_row:
        if h is None:
            headers.append('')
        else:
            headers.append(str(h).strip().lower().replace(' ', '_'))

    rows = []
    for row_values in rows_iter:
        row = {}
        for i, val in enumerate(row_values):
            if i >= len(headers) or not headers[i]:
                continue
            if val is None:
                row[headers[i]] = ''
            else:
                s = str(val).strip()
                # Strip trailing .0 from integer-like floats
                if isinstance(val, float) and val == int(val):
                    s = str(int(val))
                row[headers[i]] = s
        # Skip entirely empty rows
        if any(v for v in row.values()):
            rows.append(row)

    wb.close()
    return rows

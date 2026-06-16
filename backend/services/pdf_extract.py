"""Extract text/data from an uploaded report PDF (e.g. a Looker Studio dashboard).

Uses pdfplumber's layout mode, which preserves the spatial arrangement of KPI
tiles and tables — so the AI receives the numbers in a readable, structured form
without needing a vision model. Chart-only values (bars with no printed label)
are not captured; the tables and KPI figures are.
"""
from __future__ import annotations

from io import BytesIO


def extract_pdf_text(pdf_bytes: bytes) -> str:
    """Return layout-preserving text for every page, one '--- PAGE n ---' block each."""
    import pdfplumber

    blocks = []
    with pdfplumber.open(BytesIO(pdf_bytes)) as pdf:
        for i, page in enumerate(pdf.pages, 1):
            try:
                txt = page.extract_text(layout=True) or ""
            except Exception:
                txt = page.extract_text() or ""
            blocks.append(f"--- PAGE {i} ---\n{txt.rstrip()}")
    return "\n\n".join(blocks).strip()

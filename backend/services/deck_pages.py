"""Turn a proposal-deck PDF into page images.

The agency's Canva exports run 19-87MB. Embedding one in a published page would blow past
Cloudflare's 25MB per-file limit and be unusable on a phone. Rasterising to ~1600px JPEGs costs
about a tenth of that and, more importantly, renders as actual slides rather than a PDF viewer
bolted into the page.

PyMuPDF does the rendering: it is a pip wheel with no system packages behind it, so this needs no
root on the host (poppler would have).
"""
import io
import logging
from typing import List, Tuple

logger = logging.getLogger(__name__)

TARGET_WIDTH = 1600      # wide enough for a laptop; a deck is read, not zoomed into
JPEG_QUALITY = 82
MAX_PAGES = 80           # a proposal deck is tens of pages; anything more is a mistaken upload


def rasterise(pdf_bytes: bytes) -> List[Tuple[int, bytes]]:
    """[(page_no, jpeg_bytes)] for every page, 1-based. Raises ValueError on an unreadable PDF."""
    try:
        import pymupdf
    except ImportError:                                   # pragma: no cover
        try:
            import fitz as pymupdf                        # older installs expose the old name
        except ImportError:
            raise ValueError("PDF rendering is not available on this server (pymupdf missing).")

    try:
        doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    except Exception as e:
        raise ValueError(f"That file could not be read as a PDF: {str(e)[:120]}")

    if doc.page_count == 0:
        raise ValueError("That PDF has no pages.")
    if doc.page_count > MAX_PAGES:
        raise ValueError(f"That PDF has {doc.page_count} pages — the limit is {MAX_PAGES}.")

    out: List[Tuple[int, bytes]] = []
    for i, page in enumerate(doc, start=1):
        # Scale from the page's own width so every deck lands at the same pixel width regardless
        # of the slide size Canva exported at.
        zoom = TARGET_WIDTH / max(page.rect.width, 1)
        pix = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=False)
        out.append((i, pix.tobytes("jpeg", jpg_quality=JPEG_QUALITY)))
    doc.close()
    logger.info("rasterised %d deck pages, %d KB total",
                len(out), sum(len(b) for _, b in out) // 1024)
    return out


def pages_html(count: int, url_for) -> str:
    """The deck as stacked slide images. `url_for(page_no)` supplies each image's src."""
    if not count:
        return ""
    imgs = "".join(
        f'<img class="deck-page" src="{url_for(n)}" alt="Slide {n}" '
        f'loading="{"eager" if n <= 2 else "lazy"}" decoding="async">'
        for n in range(1, count + 1))
    return f'<div class="deck-pages">{imgs}</div>'

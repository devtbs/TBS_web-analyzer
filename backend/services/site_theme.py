"""Detect a website's brand accent colour so each AI deck is themed to the actual site
instead of always defaulting to the same palette.

Priority: a <meta name="theme-color"> → the dominant vivid colour of the site's
apple-touch-icon/favicon → a deterministic hue derived from the domain (stable, never
all-orange). Everything is best-effort: any failure falls back so a deck never blocks.
"""
from __future__ import annotations

import colorsys
import hashlib
import logging
import re
from typing import Dict, Optional, Tuple

logger = logging.getLogger(__name__)

_CACHE: Dict[str, Dict[str, str]] = {}
_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
       "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")


def _clamp(v: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, v))


def _hex_to_rgb(h: str) -> Optional[Tuple[int, int, int]]:
    h = (h or "").strip()
    m = re.fullmatch(r"#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})", h)
    if not m:
        return None
    s = m.group(1)
    if len(s) == 3:
        s = "".join(c * 2 for c in s)
    return int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16)


def _rgb_to_hex(rgb: Tuple[int, int, int]) -> str:
    return "#%02X%02X%02X" % tuple(int(_clamp(c, 0, 255)) for c in rgb)


def _is_vivid(rgb: Tuple[int, int, int]) -> bool:
    """Reject near-white/near-black/near-grey so we don't theme on a neutral swatch."""
    r, g, b = (c / 255 for c in rgb)
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    return 0.12 <= l <= 0.88 and s >= 0.22


def _darker(rgb: Tuple[int, int, int], by: float = 0.18) -> Tuple[int, int, int]:
    """A darker shade of the same hue — used for the cohesive secondary accent."""
    r, g, b = (c / 255 for c in rgb)
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    r, g, b = colorsys.hls_to_rgb(h, _clamp(l - by), s)
    return round(r * 255), round(g * 255), round(b * 255)


def _fallback_accent(domain: str) -> Tuple[int, int, int]:
    """Deterministic, non-neutral colour from the domain — stable per site, varied across sites."""
    digest = hashlib.sha1(domain.encode("utf-8")).digest()
    hue = digest[0] / 255.0                      # 0..1 around the wheel
    r, g, b = colorsys.hls_to_rgb(hue, 0.42, 0.62)
    return round(r * 255), round(g * 255), round(b * 255)


def _accents(rgb: Tuple[int, int, int]) -> Dict[str, str]:
    return {"accent": _rgb_to_hex(rgb), "accent2": _rgb_to_hex(_darker(rgb))}


def _dominant_icon_color(img_bytes: bytes) -> Optional[Tuple[int, int, int]]:
    """Most common vivid colour in an icon (favicon/apple-touch-icon)."""
    from io import BytesIO
    from PIL import Image

    im = Image.open(BytesIO(img_bytes)).convert("RGBA")
    im.thumbnail((64, 64))
    counts: Dict[Tuple[int, int, int], int] = {}
    for r, g, b, a in im.getdata():
        if a < 128:
            continue
        if _is_vivid((r, g, b)):
            key = (r // 16 * 16, g // 16 * 16, b // 16 * 16)  # quantise
            counts[key] = counts.get(key, 0) + 1
    if not counts:
        return None
    return max(counts, key=counts.get)


async def detect_site_accent(domain: str) -> Dict[str, str]:
    """Return {'accent': '#hex', 'accent2': '#hex'} for a domain. Best-effort, cached."""
    domain = (domain or "").strip().lower().replace("https://", "").replace("http://", "").strip("/")
    if not domain:
        return _accents(_fallback_accent("default"))
    if domain in _CACHE:
        return _CACHE[domain]

    accent_rgb: Optional[Tuple[int, int, int]] = None
    try:
        import httpx
        from bs4 import BeautifulSoup
        from urllib.parse import urljoin

        async with httpx.AsyncClient(follow_redirects=True, timeout=6.0,
                                     headers={"User-Agent": _UA}) as client:
            base = f"https://{domain}"
            resp = await client.get(base)
            soup = BeautifulSoup(resp.text, "html.parser")

            # 1) <meta name="theme-color">
            meta = soup.find("meta", attrs={"name": re.compile("^theme-color$", re.I)})
            if meta and meta.get("content"):
                rgb = _hex_to_rgb(meta["content"])
                if rgb and _is_vivid(rgb):
                    accent_rgb = rgb

            # 2) apple-touch-icon / icon → dominant vivid colour
            if accent_rgb is None:
                icon_href = None
                for rel in ("apple-touch-icon", "icon", "shortcut icon"):
                    link = soup.find("link", rel=re.compile(rel, re.I), href=True)
                    if link:
                        icon_href = urljoin(base + "/", link["href"])
                        break
                if icon_href is None:
                    icon_href = urljoin(base + "/", "/favicon.ico")
                try:
                    ir = await client.get(icon_href)
                    if ir.status_code == 200 and ir.content:
                        accent_rgb = _dominant_icon_color(ir.content)
                except Exception:
                    pass
    except Exception as e:
        logger.info("site_theme: detection failed for %s (%s) — using fallback", domain, e)

    if accent_rgb is None or not _is_vivid(accent_rgb):
        accent_rgb = _fallback_accent(domain)

    result = _accents(accent_rgb)
    _CACHE[domain] = result
    return result

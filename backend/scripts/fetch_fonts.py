"""One-off: download the THEME_PRESETS Google Fonts into backend/assets/fonts/ and
build a self-contained assets/fonts.css so decks render with the correct typography
offline (a VPS that can't reach fonts.googleapis.com would otherwise fall back to
Times/Arial). Re-run to refresh. Requires network. Usage: python scripts/fetch_fonts.py
"""
from __future__ import annotations

import hashlib
import re
import urllib.request
from pathlib import Path

ASSETS = Path(__file__).resolve().parent.parent / "assets"
FONTS_DIR = ASSETS / "fonts"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/120.0 Safari/537.36")

# family -> css2 axis spec. Serif display faces include italics (the design mixes an
# italic serif accent word into sans headlines).
FAMILIES = {
    "Inter": "wght@400;500;600;700;800",
    "Fraunces": "ital,wght@0,400;0,500;0,600;0,700;0,900;1,400;1,600",
    "Space Grotesk": "wght@400;500;600;700",
    "Archivo": "wght@400;600;700;800",
    "Playfair Display": "ital,wght@0,400;0,500;0,700;0,800;0,900;1,400;1,700",
    "Source Sans 3": "wght@400;600;700",
    "Bricolage Grotesque": "wght@400;600;700;800",
    "Syne": "wght@400;600;700;800",
    "Instrument Serif": "ital,wght@0,400;1,400",
    "Libre Caslon Display": "wght@400",
}

_URL_RE = re.compile(r"url\((https://fonts\.gstatic\.com/[^)]+\.woff2)\)")


def _get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def main() -> None:
    FONTS_DIR.mkdir(parents=True, exist_ok=True)
    css_parts: list[str] = []
    for fam, axis in FAMILIES.items():
        api = (f"https://fonts.googleapis.com/css2?family="
               f"{fam.replace(' ', '+')}:{axis}&display=swap")
        css = _get(api).decode("utf-8")
        for m in set(_URL_RE.findall(css)):
            fname = hashlib.sha1(m.encode()).hexdigest()[:16] + ".woff2"
            (FONTS_DIR / fname).write_bytes(_get(m))
            # Reference via a placeholder the renderer rewrites to an absolute file URI.
            css = css.replace(m, "{FONTS_DIR}/" + fname)
        css_parts.append(f"/* {fam} */\n{css}")
        print(f"  {fam}: done")
    (ASSETS / "fonts.css").write_text("\n".join(css_parts), encoding="utf-8")
    n = len(list(FONTS_DIR.glob("*.woff2")))
    print(f"Wrote assets/fonts.css and {n} woff2 files.")


if __name__ == "__main__":
    main()

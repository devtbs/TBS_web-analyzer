"""Automated deck QA: the checks that were being done by eye.

WHY THIS EXISTS
---------------
Every layout defect this project has shipped was found the same way — someone opened the PDF,
noticed a sliced title or a chart printed over a band, and reported it. That is a terrible feedback
loop: the client is as likely to find it as we are, and a regression can sit in production for days.

Worse, the numeric checks written along the way kept passing while the picture was visibly broken.
A table whose last row was sliced in half still fitted "inside the canvas". A card row orphaned
under a callout row was still on-page. Checking geometry in the abstract is not the same as
checking what the reader sees.

So these run against the REAL rendered page, inside the browser pass that already happens on every
generation (services.ai_deck_service.render_slide_images). No second Chromium launch, no extra
cost. The result is stored on the Document so a bad deck is flagged before anyone opens it.

Findings are split by severity because the response differs:
  errors   — the deck is broken and someone must look (a blank slide, a chart that never drew).
  warnings — probably wrong, occasionally deliberate (a very sparse slide; low-contrast text).

QA never blocks a deck. A deck with issues is still better than no deck, and a crash in a checker
must never cost a client their report — every failure path here degrades to "no QA result".
"""
from __future__ import annotations

import logging
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)

# Below this many visible words, with no chart/table/image, a slide is chrome over a blank page.
_MIN_WORDS = 5
# A few px of sub-pixel spill is normal at scale; only flag real overflow.
_TOLERANCE = 3


# The probe runs inside the loaded page, AFTER Plotly has drawn and fonts have settled, so it sees
# exactly what the screenshot will capture.
QA_PROBE_JS = r"""
() => {
  const TOL = %(tol)d, MIN_WORDS = %(min_words)d;
  const out = {slides: 0, errors: [], warnings: []};
  const rect = el => el.getBoundingClientRect();
  const visible = el => {
    const s = getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden' && parseFloat(s.opacity || '1') > 0.05;
  };

  document.querySelectorAll('section.slide, .slide').forEach((slide, i) => {
    out.slides++;
    const n = i + 1;
    const sb = rect(slide);
    const kids = [...slide.children].filter(c =>
      !['SCRIPT', 'STYLE'].includes(c.tagName) && visible(c));

    // 1a. CLIPPED CONTENT — the one that actually matters. Measuring bounding boxes is NOT enough:
    //     a flex child taller than the canvas gets SHRUNK by flexbox, so its box never exceeds the
    //     slide even though its contents are cut off. scrollHeight vs clientHeight is what reveals
    //     that text/rows were lost. Checked on the slide and on every clipping box inside it.
    const clippers = [slide, ...slide.querySelectorAll('*')].filter(el => {
      if (!visible(el)) return false;
      const o = getComputedStyle(el).overflowY;
      return o === 'hidden' || o === 'auto' || o === 'scroll';
    });
    clippers.forEach(el => {
      const lost = el.scrollHeight - el.clientHeight;
      if (lost > TOL && el.clientHeight > 40) {
        const cls = (el === slide ? 'the slide' : (el.className || el.tagName).toString().slice(0, 40));
        out.errors.push(`slide ${n}: ${lost}px of content is clipped and unreadable in ${cls}`);
      }
    });

    // 1b. OUT OF BOUNDS — a positioned child pushed past the canvas edge. Flexbox cannot shrink
    //     these, so the bounding box is the right measure here.
    kids.forEach(c => {
      const cb = rect(c);
      const over = Math.round(cb.bottom - sb.bottom);
      const right = Math.round(cb.right - sb.right);
      const left = Math.round(sb.left - cb.left);
      const cls = (c.className || c.tagName).toString().slice(0, 40);
      if (over > TOL) out.errors.push(`slide ${n}: ${cls} runs ${over}px past the bottom edge`);
      if (right > TOL) out.errors.push(`slide ${n}: ${cls} runs ${right}px past the right edge`);
      if (left > TOL) out.errors.push(`slide ${n}: ${cls} runs ${left}px past the left edge`);
    });

    // 2. OVERLAP — a band printed over the content above it. This is the defect that kept
    //    passing the "does anything exceed 1080px?" check while looking obviously wrong.
    const bands = kids.filter(c => c.classList.contains('callout-row') ||
                                   c.classList.contains('takeaway'));
    const body = kids.filter(c => !bands.includes(c));
    bands.forEach(b => body.forEach(c => {
      const bb = rect(b), cb = rect(c);
      if (bb.top < cb.bottom - 1 && bb.bottom > cb.top + 1) {
        const cls = (c.className || c.tagName).toString().slice(0, 40);
        out.errors.push(`slide ${n}: a band overlaps ${cls}`);
      }
    }));

    // 3. BLANK SLIDE — chrome over an empty page. Ships whenever a section's data was filtered
    //    away, or a chart failed and took the slide's only content with it.
    const chrome = ['.slide-header', '.footer', '.pageno', '.sectionpill', '.eyebrow', '.rule'];
    const clone = slide.cloneNode(true);
    clone.querySelectorAll(chrome.join(',') + ',script,style').forEach(e => e.remove());
    const words = (clone.textContent || '').trim().split(/\s+/).filter(Boolean).length;
    const hasVisual = slide.querySelector('table, img, svg, canvas, .js-plotly-plot');
    if (!hasVisual && words < MIN_WORDS) {
      out.errors.push(`slide ${n}: blank — chrome with no content (${words} words)`);
    }

    // 4. TABLE SLICED — a row cut through the middle by the clip. The slide claims "Top 15",
    //    shows 8 and a half, and the reader cannot tell rows were lost.
    slide.querySelectorAll('table').forEach(t => {
      const rows = [...t.querySelectorAll('tbody tr')].filter(visible);
      if (!rows.length) return;
      const last = rect(rows[rows.length - 1]);
      let box = t.parentElement, clip = null;
      while (box && box !== slide) {
        const o = getComputedStyle(box).overflowY;
        if (o === 'hidden' || o === 'auto' || o === 'scroll') { clip = box; break; }
        box = box.parentElement;
      }
      const limit = clip ? rect(clip).bottom : sb.bottom;
      if (last.bottom > limit + TOL && last.top < limit - TOL) {
        out.errors.push(`slide ${n}: a table row is sliced in half by the clip`);
      }
    });
  });

  // 5. CHARTS THAT NEVER DREW — a spec that failed to mount leaves an empty box, or a blank
  //    slide. Compare specs declared against plots actually rendered.
  const specs = document.querySelectorAll('script.plotly-spec').length;
  const drawn = [...document.querySelectorAll('.js-plotly-plot')]
    .filter(p => p.querySelector('.main-svg')).length;
  if (specs > drawn) {
    out.errors.push(`${specs - drawn} chart(s) declared a spec but never rendered`);
  }
  document.querySelectorAll('[id^="chart"]').forEach(d => {
    if (visible(d) && !d.querySelector('svg, canvas') && rect(d).height > 40) {
      out.errors.push(`empty chart container #${d.id}`);
    }
  });

  // 6. STRAY MARKDOWN — a code fence that leaked into the rendered page as literal text.
  if ((document.body.innerText || '').includes('```')) {
    out.errors.push('a literal ``` markdown fence is visible on a slide');
  }

  // 7. LOW-CONTRAST TEXT — the closing slide once shipped dark ink over a near-black scrim,
  //    perfectly laid out and completely unreadable. Warning, not error: measuring the effective
  //    background behind stacked/absolute elements is approximate.
  const lum = c => {
    c = c || '';
    const m = c.match(/[\d.]+/g);
    if (!m || m.length < 3) return null;
    // Chromium reports two forms and they use DIFFERENT scales: rgb()/rgba() are 0-255, while
    // color(srgb r g b) — which is what color-mix() returns, and the whole deck-kit palette is
    // built with color-mix — is 0-1. Dividing the latter by 255 made every kit tint read as
    // near-black and flagged perfectly legible table text as unreadable.
    const scale = c.startsWith('color(') ? 1 : 255;
    const [r, g, b] = m.slice(0, 3).map(v => {
      v = parseFloat(v) / scale;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  document.querySelectorAll('h1, h2, h3, p, td, li, span').forEach(el => {
    if (!visible(el) || !(el.textContent || '').trim()) return;
    const r = rect(el);
    if (r.width < 40 || r.height < 10) return;
    let bg = null, node = el;
    while (node && node !== document.body) {
      const c = getComputedStyle(node).backgroundColor;
      if (c && !c.includes('rgba(0, 0, 0, 0)') && c !== 'transparent') { bg = c; break; }
      node = node.parentElement;
    }
    if (!bg) return;
    const lf = lum(getComputedStyle(el).color), lb = lum(bg);
    if (lf === null || lb === null) return;
    const ratio = (Math.max(lf, lb) + 0.05) / (Math.min(lf, lb) + 0.05);
    // 1.6 not 2.0: an .idx chip (white on a light accent) lands near 1.8 by design, and warning
    // about deliberate palette choices trains the reader to ignore the list. Below 1.6 is the
    // genuinely unreadable range — the closing slide that shipped dark ink on a dark scrim was 1.1.
    if (ratio < 1.6) {
      out.warnings.push(`low-contrast text (${ratio.toFixed(1)}:1): "${
        (el.textContent || '').trim().slice(0, 40)}"`);
    }
  });

  return out;
}
"""


def _probe_js() -> str:
    return QA_PROBE_JS % {"tol": _TOLERANCE, "min_words": _MIN_WORDS}


def summarise(raw: Optional[Dict], *, expected_min_slides: int = 4) -> Dict:
    """Shape the raw probe output into the record stored on the Document.

    Split out from the browser call so it can be tested without Playwright — the dedup and the
    slide-count rule are the parts most likely to be got wrong.
    """
    if not raw:
        return {"ok": None, "slides": 0, "errors": [], "warnings": [],
                "note": "QA did not run"}
    errors: List[str] = list(dict.fromkeys(raw.get("errors") or []))
    warnings: List[str] = list(dict.fromkeys(raw.get("warnings") or []))
    slides = int(raw.get("slides") or 0)

    if slides == 0:
        errors.insert(0, "the deck rendered no slides at all")
    elif slides < expected_min_slides:
        warnings.insert(0, f"only {slides} slides — a client deck is usually 10+")

    # A page full of low-contrast text is one broken slide, not forty findings.
    if len(warnings) > 8:
        warnings = warnings[:8] + [f"…and {len(warnings) - 8} more"]
    if len(errors) > 12:
        errors = errors[:12] + [f"…and {len(errors) - 12} more"]

    return {"ok": not errors, "slides": slides, "errors": errors, "warnings": warnings}


async def probe_page(page, *, expected_min_slides: int = 4) -> Dict:
    """Run the checks against an already-loaded, already-settled Playwright page.

    Must be called AFTER Plotly has drawn and fonts have loaded, or it reports charts and layout
    that were merely not ready yet.
    """
    try:
        raw = await page.evaluate(_probe_js())
    except Exception:
        logger.exception("deck QA probe failed — continuing without a QA result")
        raw = None
    return summarise(raw, expected_min_slides=expected_min_slides)


def format_issues(qa: Optional[Dict], *, limit: int = 3) -> str:
    """One short line for a progress message / log. Empty when the deck is clean."""
    if not qa or qa.get("ok") is None:
        return ""
    errs, warns = qa.get("errors") or [], qa.get("warnings") or []
    if not errs and not warns:
        return f"QA passed — {qa.get('slides', 0)} slides, no issues."
    bits = []
    if errs:
        bits.append(f"{len(errs)} issue(s): " + "; ".join(errs[:limit]))
    if warns and not errs:
        bits.append(f"{len(warns)} warning(s): " + "; ".join(warns[:limit]))
    return "QA — " + " | ".join(bits)

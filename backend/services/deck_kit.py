"""The deck component kit: measured CSS for the components the prompt asks the model to compose.

WHY THIS EXISTS
---------------
DESIGN_SYSTEM used to spend ~180 lines *describing* these components in English — "a WHITE block
on the tinted page ground, border 1px all four sides, radius 16px, padding 32px 28px, an .idx chip,
a bold ~30px title, then 2-4 lines at ~22px in --muted". The model then re-derived that stylesheet
from scratch on every generation and guessed every number, slightly differently each time. Nobody
can hit 30px padding and a 29px card title from a paragraph of prose, which is precisely why our
decks never matched the reference: not because the model composed badly, but because the parts it
composed with were re-invented each run.

So the kit ships the CSS and the prompt stops describing it. The division of labour:

    the kit  owns the PARTS   — what a card, a callout, a table row, a KPI tile looks like.
    the model owns the WHOLE  — which parts a slide uses, how many, in what grid, in what order.

This is deliberately NOT the rendered pipeline we removed. That one owned entire slides, so every
deck was the same nine shapes forever. Here the model still writes all the HTML and picks every
composition; it just stops re-deriving the primitives. Variety is unbounded; the pixels inside each
part are ones a human measured.

TOKENS
------
The kit reads the model's theme tokens (THEME_PRESETS binds --accent, --ink, --bg …) but never
declares them. Everything is namespaced --k-* and resolves through var(--model-token, <fallback>),
so injection order cannot clash: the kit's :root and the model's :root set disjoint names. Tints,
lines and semantic backgrounds are derived from the accent with color-mix (Chromium 148 on the
render host), so any of the twelve presets produces a coherent kit without the model computing
a single hex value.

SPECIFICITY
-----------
The kit is injected at the END of <head>, so for any selector it shares with the model it wins on
source order. Base rules are `.slide`; archetype rules are `.slide.layout-cover` (0,2,0) so they
also beat a model-authored `.layout-cover` (0,1,0). The model can still extend anything it likes —
it just cannot accidentally under-specify a card into looking cheap.
"""
from __future__ import annotations

DECK_KIT_CSS = """
/* ══ deck-kit ══ measured components. Injected last; the model composes with these classes. ══ */

:root{
  /* Namespaced so the model's :root and this one can never collide. Each reads the model's
     token when the chosen preset defined it, and falls back otherwise. */
  --k-bg: var(--bg, #F8FAFC);
  --k-surface: var(--surface, #FFFFFF);
  --k-ink: var(--ink, #0F172A);
  --k-muted: var(--muted, #64748B);
  --k-accent: var(--accent, #2563EB);
  --k-accent2: var(--accent-2, var(--accent2, #0EA5E9));
  --k-line: var(--line, color-mix(in srgb, var(--k-ink) 14%, transparent));
  --k-dark: var(--dark, color-mix(in srgb, var(--k-ink) 94%, #000));
  /* Derived tints — the whole kit's ground tone comes from the accent, so every preset
     lands coherent without the model inventing a palette of its own. */
  --k-tint: var(--tint, color-mix(in srgb, var(--k-accent) 12%, #fff));
  --k-tint2: var(--tint-2, var(--tint2, color-mix(in srgb, var(--k-accent) 6%, #fff)));
  /* Semantics are FIXED, not themed: green means a win in every deck we ship. */
  --k-good: var(--good, #2E7D32);
  --k-bad: var(--bad, #C0392B);
  --k-warn: var(--warn, #8A6D1F);
  --k-good-bg: color-mix(in srgb, #2E7D32 12%, #fff);
  --k-bad-bg: color-mix(in srgb, #C0392B 11%, #fff);
  --k-warn-bg: color-mix(in srgb, #8A6D1F 14%, #fff);
}

*{margin:0;padding:0;box-sizing:border-box}
html,body{background:var(--k-bg);color:var(--k-ink);
  font-family:var(--font-body),system-ui,sans-serif;-webkit-font-smoothing:antialiased}

/* ── the slide skeleton ─────────────────────────────────────────────────────────
   Header, then a body that TAKES THE SLACK, then the bands — as ordinary flow children in that
   order. This is why a takeaway can never print over a chart: it is not positioned, it sits on
   the floor and the body above it shrinks. */
.slide{position:relative;width:1920px;height:1080px;overflow:hidden;background:var(--k-bg);
  display:flex;flex-direction:column;padding:80px 104px;page-break-after:always}
.slide + .slide{margin-top:32px}

.slide-header{flex:0 0 auto;margin-bottom:36px}
.slide-header h2{font-family:var(--font-display),sans-serif;font-size:62px;line-height:1.06;
  font-weight:700;letter-spacing:-.02em;color:var(--k-ink)}
.slide-header .subtitle{margin-top:14px;font-size:26px;color:var(--k-muted);line-height:1.35}
.rule{margin-top:26px;height:2px;background:var(--k-accent);opacity:.85}
.eyebrow,.sectionpill{display:inline-flex;align-items:center;background:var(--k-tint);
  color:var(--k-accent);font-size:19px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;
  padding:9px 22px;border-radius:999px;margin-bottom:20px}

/* The body shrinks (flex:1;min-height:0) rather than pushing the bands off the canvas, and
   overflow:hidden is the hard backstop: if content ever exceeds the box it clips instead of
   printing across the callouts below. We shipped a measured 322px overlap without this, and the
   "does anything exceed 1080px?" check passed it happily — the orphaned row was still on-canvas. */
.slide-body,.slide-main{flex:1 1 auto;min-height:0;overflow:hidden;
  display:flex;flex-direction:column;justify-content:flex-start}

.callout-row{flex:0 0 auto;display:grid;grid-template-columns:repeat(3,1fr);gap:22px;margin-top:28px}
.takeaway{flex:0 0 auto;display:flex;align-items:flex-start;gap:26px;background:var(--k-dark);
  color:#fff;border-radius:14px;padding:24px 30px;margin-top:26px}
.takeaway-label{flex:0 0 auto;font-size:17px;font-weight:700;letter-spacing:.14em;
  text-transform:uppercase;color:var(--k-accent);padding-top:3px}
.takeaway p{font-size:24px;line-height:1.4}
/* NO per-slide footer. It repeated the client name and the reporting period on all fourteen
   slides — both already on the cover — and spent ~40px of every slide's height saying nothing.
   Hidden rather than merely dropped from the prompt: the model emits one from habit (it is in
   every deck exemplar it has ever seen), and a rule here is deterministic where a prompt is not. */
.footer{display:none !important}
.pageno{position:absolute;right:64px;bottom:36px;font-size:17px;color:var(--k-muted);
  letter-spacing:.08em}

/* ── cards — the primary content device ─────────────────────────────────────────
   How many cards, over how many rows, is the model's composition to make — it sets
   grid-template-columns and that wins. But the DEFAULT must be sane: a CSS grid with no columns
   is a ONE-column grid, so an omitted grid-template-columns stacked three cards full-width, blew
   past the canvas and collided with the callouts. auto-fit means the cards spread across the row
   on their own, and the model's own column count still overrides this. */
.card-grid{display:grid;gap:24px;align-items:stretch;min-height:0;
  grid-template-columns:repeat(auto-fit,minmax(300px,1fr))}
.card{background:var(--k-surface);border:1px solid var(--k-line);border-radius:16px;
  padding:30px 28px;display:flex;flex-direction:column;align-items:flex-start;min-width:0}
.card .idx{display:inline-flex;align-items:center;justify-content:center;min-width:44px;height:44px;
  border-radius:12px;background:var(--k-accent);color:#fff;font-weight:700;font-size:20px;
  padding:0 12px;margin-bottom:18px}
.card .idx.alt{background:var(--k-accent2)}
.card .idx.dark{background:var(--k-dark)}
.card h3{font-family:var(--font-display),sans-serif;font-size:29px;line-height:1.2;font-weight:700;
  margin-bottom:10px;color:var(--k-ink)}
.card p{font-size:21px;line-height:1.45;color:var(--k-muted)}
.card ul,.card ol{margin-left:20px} .card li{font-size:21px;line-height:1.45;color:var(--k-muted)}

/* ── callouts — the signature trio ──────────────────────────────────────────────── */
.callout{border-radius:14px;padding:20px 24px;background:var(--k-tint);min-width:0}
.callout .k{display:block;font-size:16px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;
  margin-bottom:8px;color:var(--k-accent)}
.callout p{font-size:20px;line-height:1.4;color:var(--k-ink)}
.callout.see{background:var(--k-tint)} .callout.see .k{color:var(--k-accent)}
.callout.opportunity{background:var(--k-warn-bg)} .callout.opportunity .k{color:var(--k-warn)}
.callout.recommendation{background:var(--k-good-bg)} .callout.recommendation .k{color:var(--k-good)}

/* ── panels ─────────────────────────────────────────────────────────────────────── */
.panel{background:var(--k-tint2);border-radius:16px;padding:30px 32px;min-width:0}
.panel.panel-dark{background:var(--k-dark);color:#fff}
.panel.panel-dark p,.panel.panel-dark li{color:rgba(255,255,255,.74)}
.panel h3{font-family:var(--font-display),sans-serif;font-size:28px;margin-bottom:14px}
.panel p,.panel li{font-size:21px;line-height:1.45;color:var(--k-muted)}
.panel ul,.panel ol{margin-left:20px}
.stat-big{font-family:var(--font-display),sans-serif;font-size:84px;font-weight:700;line-height:1;
  letter-spacing:-.02em;color:var(--k-accent);display:block}
.stat-big + .l,.stat-big ~ .l{font-size:20px;color:var(--k-muted)}

/* ── kpi tiles ──────────────────────────────────────────────────────────────────── */
.kpi-row{display:grid;gap:22px;grid-auto-flow:column;grid-auto-columns:1fr}
.kpi-tile,.kpi{background:var(--k-tint2);border:1px solid var(--k-line);border-radius:16px;
  padding:24px 26px;min-width:0}
.kpi-tile .l,.kpi .l{font-size:18px;color:var(--k-muted);letter-spacing:.06em;text-transform:uppercase}
.kpi-tile .v,.kpi .v{font-family:var(--font-display),sans-serif;font-size:64px;font-weight:700;
  line-height:1.05;margin:8px 0;color:var(--k-ink)}
.kpi-tile.tile-dark{background:var(--k-dark);border-color:transparent}
.kpi-tile.tile-dark .v{color:#fff} .kpi-tile.tile-dark .l{color:rgba(255,255,255,.66)}
.kpi-tile.tile-accent{background:var(--k-accent);border-color:transparent}
.kpi-tile.tile-accent .v{color:#fff} .kpi-tile.tile-accent .l{color:rgba(255,255,255,.78)}

/* Semantics again: a decline is red wherever it appears — pill, delta chip or table cell. */
.pill,.delta,.chip{display:inline-block;font-size:16px;font-weight:600;padding:5px 12px;
  border-radius:999px;background:var(--k-tint2);color:var(--k-muted)}
.pill.good,.delta.delta-good,.good{background:var(--k-good-bg);color:var(--k-good)}
.pill.bad,.delta.delta-bad,.bad{background:var(--k-bad-bg);color:var(--k-bad)}
.pill.warn,.delta.delta-warn,.warn{background:var(--k-warn-bg);color:var(--k-warn)}
td.good,td.bad,td.warn{background:transparent}

/* ── tables ─────────────────────────────────────────────────────────────────────── */
table{width:100%;border-collapse:collapse;font-size:21px;table-layout:fixed}
thead th{background:var(--k-dark);color:#fff;font-weight:700;font-size:18px;letter-spacing:.04em;
  text-align:right;padding:16px 18px}
thead th:first-child{text-align:left;border-radius:10px 0 0 0}
thead th:last-child{border-radius:0 10px 0 0}
tbody td{padding:14px 18px;text-align:right;color:var(--k-ink);border-bottom:1px solid var(--k-line);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
tbody td:first-child{text-align:left}
tbody tr:nth-child(even){background:var(--k-tint2)}
tbody tr.total{background:var(--k-dark)} tbody tr.total td{color:#fff;font-weight:700}
/* "+N more" — added by the table-fit pass when rows had to be dropped. Quiet, but present: the
   reader must be able to tell the table was truncated rather than silently shortened. */
tbody tr.more{background:transparent}
tbody tr.more td{text-align:left;font-size:18px;font-style:italic;color:var(--k-muted);
  border-bottom:0;padding-top:12px}

/* ── charts ─────────────────────────────────────────────────────────────────────── */
.chart{flex:1 1 auto;min-height:0;width:100%}

/* ── movers ─────────────────────────────────────────────────────────────────────── */
.movers{display:grid;grid-template-columns:1fr 1fr;gap:28px;min-height:0}
.mover-col{border-radius:16px;padding:26px 28px;min-width:0}
.mover-col.up{background:var(--k-good-bg)} .mover-col.down{background:var(--k-bad-bg)}
.mover-col h3{font-family:var(--font-display),sans-serif;font-size:26px;margin-bottom:16px}
.mover-col.up h3{color:var(--k-good)} .mover-col.down h3{color:var(--k-bad)}
.mover{display:flex;justify-content:space-between;align-items:center;gap:16px;
  padding:11px 0;border-bottom:1px solid rgba(0,0,0,.06);font-size:21px}
.mover:last-child{border-bottom:0}
.mover .lbl{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--k-ink)}

/* ── priority rows ──────────────────────────────────────────────────────────────── */
.prio{display:flex;align-items:center;gap:28px;border:1px solid var(--k-line);border-radius:16px;
  padding:22px 26px;background:var(--k-surface);min-width:0}
.prio + .prio{margin-top:18px}
.prio.top{background:var(--k-tint)}
.prio .rank{flex:0 0 auto;background:var(--k-accent);color:#fff;border-radius:999px;padding:8px 18px;
  font-size:17px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
.prio .mid{flex:1 1 auto;min-width:0}
.prio .mid h3{font-family:var(--font-display),sans-serif;font-size:26px;margin-bottom:6px}
.prio .mid p{font-size:20px;color:var(--k-muted);line-height:1.4}
.prio .impact{flex:0 0 auto;border:1px solid var(--k-line);border-radius:12px;padding:14px 20px;
  text-align:center;background:var(--k-surface)}
.prio .impact .v{font-family:var(--font-display),sans-serif;font-size:30px;font-weight:700;
  color:var(--k-accent)}
.prio .impact .l{font-size:15px;color:var(--k-muted);text-transform:uppercase;letter-spacing:.08em}

/* ── phased roadmap ─────────────────────────────────────────────────────────────── */
.phases{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;min-height:0}
.phase{background:var(--k-surface);border:1px solid var(--k-line);border-radius:16px;overflow:hidden;
  display:flex;flex-direction:column;min-width:0}
.phase .cap{padding:18px 24px;color:#fff;background:var(--k-accent)}
.phase:nth-child(2) .cap{background:var(--k-accent2)}
.phase:nth-child(3) .cap{background:var(--k-dark)}
.phase .cap .m{font-size:16px;letter-spacing:.1em;text-transform:uppercase;opacity:.9}
.phase .cap h3{font-family:var(--font-display),sans-serif;font-size:30px;margin-top:4px}
.phase .bd{padding:22px 24px;flex:1 1 auto}
.phase li{list-style:none;font-size:20px;line-height:1.4;color:var(--k-muted);margin-bottom:12px;
  padding-left:20px;position:relative}
.phase li:before{content:"";position:absolute;left:0;top:9px;width:8px;height:8px;border-radius:50%;
  background:var(--k-accent)}
.phase .out{margin:0 24px 22px;background:var(--k-tint);border-radius:10px;padding:14px 16px;
  font-size:19px;color:var(--k-ink)}

/* ══ archetypes ══ .slide.layout-* (0,2,0) so these also beat a model-authored .layout-* ══ */

/* dark-split — the change of pace that stops a card deck feeling repetitive. */
.slide.layout-dark-split,.slide.dark-split{flex-direction:row;padding:0}
.dark-panel{flex:0 0 38%;background:var(--k-dark);color:#fff;padding:80px 64px;
  display:flex;flex-direction:column;justify-content:center;min-width:0}
.dark-panel .sectionpill,.dark-panel .eyebrow{background:rgba(255,255,255,.14);color:#fff;
  align-self:flex-start}
.dark-panel h2{font-family:var(--font-display),sans-serif;font-size:58px;line-height:1.08;
  font-weight:700;letter-spacing:-.02em}
.dark-panel .accent-rule{width:88px;height:4px;background:var(--k-accent);margin:26px 0}
.dark-panel p{font-size:23px;line-height:1.45;color:rgba(255,255,255,.72)}
.split-body{flex:1 1 auto;min-width:0;padding:80px 72px;display:flex;flex-direction:column}

/* cover — flex-basis on the columns, NOT flex:1, so the photo column keeps its width. */
.slide.layout-cover,.slide.cover{padding:0;flex-direction:row}
.cover-left{flex:0 0 52%;display:flex;flex-direction:column;justify-content:center;padding:0 96px;
  min-width:0}
.brandmark{display:flex;align-items:baseline;gap:14px;margin-bottom:26px}
.brandmark strong{font-family:var(--font-display),sans-serif;font-size:34px;color:var(--k-accent);
  letter-spacing:.04em}
.brandmark span{font-size:19px;letter-spacing:.2em;text-transform:uppercase;color:var(--k-muted)}
.cover-left h1{font-family:var(--font-display),sans-serif;font-size:92px;line-height:1.02;
  font-weight:700;letter-spacing:-.03em;margin:22px 0;color:var(--k-ink)}
.cover-left .subtitle{font-size:27px;color:var(--k-ink)}
.cover-left .meta{margin-top:12px;font-size:20px;color:var(--k-muted)}
.cover-right{flex:1 1 0;position:relative;min-width:0}
.cover-right img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.cover-card{position:absolute;left:44px;right:44px;bottom:52px;background:var(--k-surface);
  border:1px solid var(--k-line);border-radius:18px;padding:30px 32px;
  box-shadow:0 10px 34px rgba(15,27,45,.14)}
.cover-card .k{font-size:16px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;
  color:var(--k-accent)}
.cover-card h3{font-family:var(--font-display),sans-serif;font-size:34px;margin:6px 0 4px}
.cover-card .d{font-size:19px;color:var(--k-muted)}
.cover-stats{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:20px}
.cover-stats .v{font-family:var(--font-display),sans-serif;font-size:40px;font-weight:700;
  color:var(--k-accent);line-height:1}
.cover-stats .l{font-size:17px;color:var(--k-muted)}

/* closing — mirrors the cover so the deck opens and closes on an image.
   Everything here is defensive: one deck's closing slide used NO .closing-in, NO .scrim and a bare
   <img> with no .ai-img, so every rule below missed and the headline rendered in dark ink over a
   dark photo — unreadable. So: any direct <img> goes full-bleed, and all text defaults to white
   via :where() (zero specificity, so .closing-stats .v and friends still win). */
.slide.layout-closing :where(h1,h2,h3,h4,p,span,div,li){color:#fff}
.slide.layout-closing > img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;
  z-index:0}
.slide.layout-closing,.slide.closing{padding:0;align-items:center;justify-content:center}
.slide.layout-closing img.ai-img,.slide.closing img{position:absolute;inset:0;width:100%;height:100%;
  object-fit:cover;z-index:0}
.slide.layout-closing .scrim,.slide.closing .scrim{position:absolute;inset:0;
  background:rgba(15,27,45,.74);z-index:1}
.closing-in{position:relative;z-index:2;text-align:center;max-width:1180px;padding:0 80px}
.closing-in h1{font-family:var(--font-display),sans-serif;font-size:86px;line-height:1.05;
  font-weight:700;color:#fff;letter-spacing:-.02em}
.closing-in .subtitle{margin-top:22px;font-size:28px;color:rgba(255,255,255,.82);line-height:1.4}
.closing-stats{display:flex;justify-content:center;gap:56px;margin-top:40px}
.closing-stats .v{font-family:var(--font-display),sans-serif;font-size:48px;font-weight:700;
  color:var(--k-accent)}
.closing-stats .l{font-size:18px;color:rgba(255,255,255,.7)}


/* section divider + quote */
.slide.layout-section{background:var(--k-dark);justify-content:center}
.slide.layout-section .num{font-family:var(--font-display),sans-serif;font-size:180px;
  font-weight:700;color:var(--k-accent);line-height:1}
.slide.layout-section h1{font-family:var(--font-display),sans-serif;font-size:78px;font-weight:700;
  color:#fff;letter-spacing:-.02em;margin-top:10px}
.slide.layout-quote .slide-body,.slide.quote .slide-body{justify-content:center}
.quote-in h1{font-family:var(--font-display),sans-serif;font-size:76px;line-height:1.1;
  font-weight:700;letter-spacing:-.02em;max-width:1500px;color:var(--k-ink)}
.quote-in .subtitle{margin-top:26px;font-size:28px;color:var(--k-muted);max-width:1300px}
"""


def kit_style_tag() -> str:
    """The kit as a <style> tag, ready to inject at the end of <head> (so it wins on source order)."""
    return "<style>/* deck-kit */\n" + DECK_KIT_CSS + "</style>"


def inject_kit(html: str) -> str:
    """Inject the kit into a model-authored deck. Last in <head>, before any model <style> is
    outranked only by !important — which the model is told not to use."""
    if "deck-kit" in html:
        return html
    tag = kit_style_tag()
    if "</head>" in html:
        return html.replace("</head>", tag + "\n</head>", 1)
    if "<body" in html:
        return html.replace("<body", tag + "\n<body", 1)
    return tag + html

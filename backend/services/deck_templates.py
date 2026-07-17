"""The renderer: ONE hand-written stylesheet + one Python function per slide template.

No model writes CSS or HTML here. Every rule in DECK_CSS was written and measured by a human
against the 1920x1080 canvas, so the geometry is a constant rather than something re-invented
(and re-broken) on every generation.

The structure of every content slide is fixed and identical:

    .slide  (1920x1080, flex column, padding)
      .slide-header   header: section pill + title + subtitle + rule
      .slide-body     the template's content — takes the slack (flex:1, min-height:0)
      .callout-row    optional trio
      .takeaway       optional dark band
      .footer         always last

Because the body takes the slack and the bands are ordinary flow children at the end, the
takeaway can never print over a chart and the footer can never float mid-slide — the two defects
we shipped repeatedly. Combined with deck_schema's capacity limits (content is truncated to fit
before it gets here) nothing can overflow the canvas either.
"""
from __future__ import annotations

import html as _html
import json
from typing import Dict, List, Optional

SLIDE_W_PX, SLIDE_H_PX = 1920, 1080


def _e(s) -> str:
    return _html.escape(str(s if s is not None else ""), quote=True)


# ── the stylesheet ────────────────────────────────────────────────────────────────────────────
DECK_CSS = """
*{margin:0;padding:0;box-sizing:border-box}
html,body{background:var(--bg);color:var(--ink);font-family:var(--font-body),system-ui,sans-serif;
  -webkit-font-smoothing:antialiased}
.slide{position:relative;width:1920px;height:1080px;overflow:hidden;background:var(--bg);
  display:flex;flex-direction:column;padding:80px 104px;page-break-after:always}
.slide + .slide{margin-top:32px}

/* ── header ─────────────────────────────────────────────────────────────────── */
.slide-header{flex:0 0 auto;margin-bottom:36px}
.sectionpill{display:inline-flex;align-items:center;background:var(--tint);color:var(--accent);
  font-size:19px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;
  padding:9px 22px;border-radius:999px;margin-bottom:20px}
.slide-header h2{font-family:var(--font-display),sans-serif;font-size:62px;line-height:1.06;
  font-weight:700;letter-spacing:-.02em;color:var(--ink)}
.slide-header .subtitle{margin-top:14px;font-size:26px;color:var(--muted);line-height:1.35}
.rule{margin-top:26px;height:2px;background:var(--accent);opacity:.85}

/* ── body takes the slack; bands sit on the floor ───────────────────────────── */
/* overflow:hidden is the hard backstop. The body box shrinks (flex:1;min-height:0), and without
   this a grid taller than the box renders straight over the callouts/takeaway below it — a
   measured 322px overlap, which the "does anything exceed 1080px?" check happily passed because
   the orphaned row was still inside the canvas. Capacity limits stop this happening; clipping
   here guarantees that if one ever slips, it stays contained instead of printing over a band. */
.slide-body{flex:1 1 auto;min-height:0;overflow:hidden;
  display:flex;flex-direction:column;justify-content:flex-start}
.callout-row{flex:0 0 auto;display:grid;grid-template-columns:repeat(3,1fr);gap:22px;margin-top:28px}
.takeaway{flex:0 0 auto;display:flex;align-items:flex-start;gap:26px;background:var(--dark);
  color:#fff;border-radius:14px;padding:24px 30px;margin-top:26px}
.takeaway-label{flex:0 0 auto;font-size:17px;font-weight:700;letter-spacing:.14em;
  text-transform:uppercase;color:var(--accent);padding-top:3px}
.takeaway p{font-size:24px;line-height:1.4}
.footer{flex:0 0 auto;display:flex;justify-content:space-between;align-items:center;
  margin-top:24px;font-size:17px;color:var(--muted)}

/* ── cards ──────────────────────────────────────────────────────────────────── */
.card-grid{display:grid;gap:24px;align-items:stretch}
.card{background:var(--surface);border:1px solid var(--line);border-radius:16px;
  padding:30px 28px;display:flex;flex-direction:column;align-items:flex-start;min-width:0}
.card .idx{display:inline-flex;align-items:center;justify-content:center;min-width:44px;height:44px;
  border-radius:12px;color:#fff;font-weight:700;font-size:20px;padding:0 12px;margin-bottom:18px}
.card h3{font-family:var(--font-display),sans-serif;font-size:29px;line-height:1.2;font-weight:700;
  margin-bottom:10px;color:var(--ink)}
.card p{font-size:21px;line-height:1.45;color:var(--muted)}

/* ── callouts ───────────────────────────────────────────────────────────────── */
.callout{border-radius:14px;padding:20px 24px}
.callout .k{display:block;font-size:16px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;
  margin-bottom:8px}
.callout p{font-size:20px;line-height:1.4;color:var(--ink)}
.callout.see{background:var(--tint)} .callout.see .k{color:var(--accent)}
.callout.opportunity{background:#FDF6E3} .callout.opportunity .k{color:#8A6D1F}
.callout.recommendation{background:#EDF7E9} .callout.recommendation .k{color:#4A7A2B}

/* ── table ──────────────────────────────────────────────────────────────────── */
table{width:100%;border-collapse:collapse;font-size:21px;table-layout:fixed}
thead th{background:var(--dark);color:#fff;font-weight:700;font-size:18px;letter-spacing:.04em;
  text-align:right;padding:16px 18px}
thead th:first-child{text-align:left;border-radius:10px 0 0 0}
thead th:last-child{border-radius:0 10px 0 0}
tbody td{padding:14px 18px;text-align:right;color:var(--ink);border-bottom:1px solid var(--line);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
tbody td:first-child{text-align:left;color:var(--ink)}
tbody tr:nth-child(even){background:var(--tint2)}

/* ── kpi ────────────────────────────────────────────────────────────────────── */
.kpi-row{display:grid;gap:22px;margin-bottom:28px}
.kpi{background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:24px 26px}
.kpi .l{font-size:18px;color:var(--muted);letter-spacing:.06em;text-transform:uppercase}
.kpi .v{font-family:var(--font-display),sans-serif;font-size:58px;font-weight:700;line-height:1.05;
  margin:8px 0;color:var(--ink)}
.pill{display:inline-block;font-size:16px;font-weight:600;padding:5px 12px;border-radius:999px;
  background:var(--tint2);color:var(--muted)}
.pill.good{background:#EDF7E9;color:#4A7A2B}
.pill.bad{background:#FBEAE6;color:var(--bad)}
.pill.warn{background:#FDF6E3;color:#8A6D1F}
.chart{flex:1 1 auto;min-height:0;width:100%}

/* ── movers ─────────────────────────────────────────────────────────────────── */
.movers{display:grid;grid-template-columns:1fr 1fr;gap:28px;min-height:0}
.mover-col{border-radius:16px;padding:26px 28px;min-width:0}
.mover-col.up{background:#EDF7E9} .mover-col.down{background:#FBEAE6}
.mover-col h3{font-family:var(--font-display),sans-serif;font-size:26px;margin-bottom:16px}
.mover-col.up h3{color:#4A7A2B} .mover-col.down h3{color:var(--bad)}
.mover{display:flex;justify-content:space-between;align-items:center;gap:16px;
  padding:11px 0;border-bottom:1px solid rgba(0,0,0,.06);font-size:21px}
.mover:last-child{border-bottom:0}
.mover .lbl{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--ink)}

/* ── roadmap ────────────────────────────────────────────────────────────────── */
.phases{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;min-height:0}
.phase{background:var(--surface);border:1px solid var(--line);border-radius:16px;overflow:hidden;
  display:flex;flex-direction:column}
.phase .cap{padding:18px 24px;color:#fff}
.phase .cap .m{font-size:16px;letter-spacing:.1em;text-transform:uppercase;opacity:.9}
.phase .cap h3{font-family:var(--font-display),sans-serif;font-size:30px;margin-top:4px}
.phase .bd{padding:22px 24px;flex:1 1 auto}
.phase li{list-style:none;font-size:20px;line-height:1.4;color:var(--muted);margin-bottom:12px;
  padding-left:20px;position:relative}
.phase li:before{content:"";position:absolute;left:0;top:9px;width:8px;height:8px;border-radius:50%;
  background:var(--accent)}
.phase .out{margin:0 24px 22px;background:var(--tint);border-radius:10px;padding:14px 16px;
  font-size:19px;color:var(--ink)}

/* ── dark split ─────────────────────────────────────────────────────────────── */
.slide.dark-split{flex-direction:row;padding:0}
.dark-panel{flex:0 0 38%;background:var(--dark);color:#fff;padding:80px 64px;
  display:flex;flex-direction:column;justify-content:center}
.dark-panel .sectionpill{background:rgba(255,255,255,.14);color:#fff;align-self:flex-start}
.dark-panel h2{font-family:var(--font-display),sans-serif;font-size:58px;line-height:1.08;
  font-weight:700;letter-spacing:-.02em}
.dark-panel .accent-rule{width:88px;height:4px;background:var(--accent);margin:26px 0}
.dark-panel p{font-size:23px;line-height:1.45;color:rgba(255,255,255,.72)}
.split-body{flex:1 1 auto;min-width:0;padding:80px 72px;display:flex;flex-direction:column}

/* ── posters ────────────────────────────────────────────────────────────────── */
.slide.cover{padding:0;flex-direction:row}
.cover-left{flex:0 0 52%;display:flex;flex-direction:column;justify-content:center;padding:0 96px}
.brandmark{display:flex;align-items:baseline;gap:14px;margin-bottom:26px}
.brandmark strong{font-family:var(--font-display),sans-serif;font-size:34px;color:var(--accent);
  letter-spacing:.04em}
.brandmark span{font-size:19px;letter-spacing:.2em;text-transform:uppercase;color:var(--muted)}
.cover-left h1{font-family:var(--font-display),sans-serif;font-size:92px;line-height:1.02;
  font-weight:700;letter-spacing:-.03em;margin:22px 0}
.cover-left .subtitle{font-size:27px;color:var(--ink)}
.cover-left .meta{margin-top:12px;font-size:20px;color:var(--muted)}
.cover-right{flex:1 1 auto;position:relative;min-width:0}
.cover-right img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.cover-card{position:absolute;left:44px;right:44px;bottom:52px;background:var(--surface);
  border:1px solid var(--line);border-radius:18px;padding:30px 32px;
  box-shadow:0 10px 34px rgba(15,27,45,.14)}
.cover-card .k{font-size:16px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;
  color:var(--accent)}
.cover-card h3{font-family:var(--font-display),sans-serif;font-size:34px;margin:6px 0 4px}
.cover-card .d{font-size:19px;color:var(--muted)}
.cover-stats{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:20px}
.cover-stats .v{font-family:var(--font-display),sans-serif;font-size:40px;font-weight:700;
  color:var(--accent);line-height:1}
.cover-stats .l{font-size:17px;color:var(--muted)}

.slide.closing{padding:0;align-items:center;justify-content:center}
.slide.closing img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0}
.slide.closing .scrim{position:absolute;inset:0;background:rgba(15,27,45,.74);z-index:1}
.closing-in{position:relative;z-index:2;text-align:center;max-width:1180px;padding:0 80px}
.closing-in h1{font-family:var(--font-display),sans-serif;font-size:86px;line-height:1.05;
  font-weight:700;color:#fff;letter-spacing:-.02em}
.closing-in .subtitle{margin-top:22px;font-size:28px;color:rgba(255,255,255,.82);line-height:1.4}
.closing-stats{display:flex;justify-content:center;gap:56px;margin-top:40px}
.closing-stats .v{font-family:var(--font-display),sans-serif;font-size:48px;font-weight:700;
  color:var(--accent)}
.closing-stats .l{font-size:18px;color:rgba(255,255,255,.7)}
.closing .footer{position:absolute;left:104px;right:104px;bottom:44px;z-index:2;
  color:rgba(255,255,255,.6)}

/* ── quote ──────────────────────────────────────────────────────────────────── */
.slide.quote .slide-body{justify-content:center}
.quote-in h1{font-family:var(--font-display),sans-serif;font-size:76px;line-height:1.1;
  font-weight:700;letter-spacing:-.02em;max-width:1500px}
.quote-in .subtitle{margin-top:26px;font-size:28px;color:var(--muted);max-width:1300px}
"""


def _grid_cols(n: int) -> str:
    """Column count for a card grid: code decides, so cards are always equal and never orphaned."""
    if n <= 3:
        return f"repeat({max(n,1)},1fr)"
    if n == 4:
        return "repeat(4,1fr)"
    if n <= 6:
        return "repeat(3,1fr)"
    return "repeat(4,1fr)"          # 7-8 -> two rows of four


_IDX_COLOURS = ("var(--accent)", "var(--accent-3)", "var(--accent-2)", "var(--dark)")


def _header(s: Dict) -> str:
    sub = f'<p class="subtitle">{_e(s["subtitle"])}</p>' if s.get("subtitle") else ""
    pill = f'<span class="sectionpill">{_e("%02d · %s" % (s["n"] - 1, s["section"]))}</span>' if s.get("section") else ""
    return (f'<div class="slide-header">{pill}<h2>{_e(s["title"])}</h2>{sub}'
            f'<div class="rule"></div></div>')


def _callouts(s: Dict) -> str:
    cs = s.get("callouts") or []
    if not cs:
        return ""
    labels = {"see": "What we see", "opportunity": "Opportunity", "recommendation": "TBS recommendation"}
    items = "".join(
        f'<div class="callout {c["kind"]}"><span class="k">{_e(labels[c["kind"]])}</span>'
        f'<p>{_e(c["text"])}</p></div>' for c in cs)
    return f'<div class="callout-row">{items}</div>'


def _takeaway(s: Dict) -> str:
    if not s.get("takeaway"):
        return ""
    return (f'<div class="takeaway"><span class="takeaway-label">Takeaway</span>'
            f'<p>{_e(s["takeaway"])}</p></div>')


def _footer(s: Dict, ctx: Dict) -> str:
    left = _e(f'{ctx.get("client") or ctx.get("domain", "")} — {ctx.get("report_name", "Search Console Report")}')
    right = _e(ctx.get("period_label", ""))
    return f'<div class="footer"><span>{left}</span><span>{right}</span></div>'


def _chart_div(s: Dict, figs: Dict[int, Dict]) -> str:
    fig = figs.get(s["n"])
    if not fig:
        return ""
    cid = f'chart-{s["n"]}'
    spec = json.dumps(fig)
    return (f'<div class="chart" id="{cid}"></div>'
            f'<script class="plotly-spec" type="application/json" data-target="{cid}">{spec}</script>')


def _cards_html(cards: List[Dict]) -> str:
    out = []
    for i, c in enumerate(cards):
        colour = _IDX_COLOURS[i % len(_IDX_COLOURS)]
        body = f'<p>{_e(c["body"])}</p>' if c.get("body") else ""
        out.append(f'<div class="card"><span class="idx" style="background:{colour}">{i+1}</span>'
                   f'<h3>{_e(c["title"])}</h3>{body}</div>')
    return (f'<div class="card-grid" style="grid-template-columns:{_grid_cols(len(cards))}">'
            + "".join(out) + "</div>")


# ── template renderers ────────────────────────────────────────────────────────────────────────

def _t_cards(s, ctx, figs):
    return (f'<section class="slide cards">{_header(s)}'
            f'<div class="slide-body">{_cards_html(s["content"]["cards"])}{_chart_div(s, figs)}</div>'
            f'{_callouts(s)}{_takeaway(s)}{_footer(s, ctx)}</section>')


def _t_dark_split(s, ctx, figs):
    note = f'<p>{_e(s["content"].get("panel_note",""))}</p>' if s["content"].get("panel_note") else ""
    pill = f'<span class="sectionpill">{_e(s["section"])}</span>' if s.get("section") else ""
    return (f'<section class="slide dark-split">'
            f'<div class="dark-panel">{pill}<h2>{_e(s["title"])}</h2>'
            f'<div class="accent-rule"></div>{note}</div>'
            f'<div class="split-body"><div class="slide-body">'
            f'{_cards_html(s["content"]["cards"])}{_chart_div(s, figs)}</div>'
            f'{_takeaway(s)}{_footer(s, ctx)}</div></section>')


def _t_table(s, ctx, figs):
    c = s["content"]
    head = "".join(f"<th>{_e(h)}</th>" for h in c["columns"])
    body = "".join("<tr>" + "".join(f"<td>{_e(v)}</td>" for v in r) + "</tr>" for r in c["rows"])
    return (f'<section class="slide table">{_header(s)}<div class="slide-body">'
            f'<table><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table></div>'
            f'{_callouts(s)}{_takeaway(s)}{_footer(s, ctx)}</section>')


def _t_kpi_chart(s, ctx, figs):
    ks = s["content"].get("kpis") or []
    tiles = "".join(
        f'<div class="kpi"><div class="l">{_e(k["label"])}</div><div class="v">{_e(k["value"])}</div>'
        + (f'<span class="pill {k["tone"]}">{_e(k["note"])}</span>' if k.get("note") else "")
        + "</div>" for k in ks)
    row = (f'<div class="kpi-row" style="grid-template-columns:repeat({len(ks)},1fr)">{tiles}</div>'
           if ks else "")
    return (f'<section class="slide kpi">{_header(s)}'
            f'<div class="slide-body">{row}{_chart_div(s, figs)}</div>'
            f'{_callouts(s)}{_takeaway(s)}{_footer(s, ctx)}</section>')


def _t_movers(s, ctx, figs):
    def col(d, cls, tone):
        rows = "".join(
            f'<div class="mover"><span class="lbl">{_e(r["label"])}</span>'
            f'<span class="pill {tone}">{_e(r["delta"])}</span></div>' for r in d["rows"])
        return f'<div class="mover-col {cls}"><h3>{_e(d["title"])}</h3>{rows}</div>'
    c = s["content"]
    return (f'<section class="slide movers-slide">{_header(s)}<div class="slide-body">'
            f'<div class="movers">{col(c["rising"], "up", "good")}{col(c["falling"], "down", "bad")}</div>'
            f'</div>{_takeaway(s)}{_footer(s, ctx)}</section>')


def _t_roadmap(s, ctx, figs):
    caps = ("var(--accent)", "var(--accent-3)", "var(--accent-2)")
    out = []
    for i, p in enumerate(s["content"]["phases"]):
        lis = "".join(f"<li>{_e(b)}</li>" for b in p["bullets"])
        out_box = f'<div class="out">{_e(p["outcome"])}</div>' if p.get("outcome") else ""
        out.append(f'<div class="phase"><div class="cap" style="background:{caps[i % 3]}">'
                   f'<div class="m">{_e(p["meta"])}</div><h3>{_e(p["title"])}</h3></div>'
                   f'<div class="bd"><ul>{lis}</ul></div>{out_box}</div>')
    return (f'<section class="slide roadmap-slide">{_header(s)}<div class="slide-body">'
            f'<div class="phases">{"".join(out)}</div></div>'
            f'{_takeaway(s)}{_footer(s, ctx)}</section>')


def _t_quote(s, ctx, figs):
    sub = f'<p class="subtitle">{_e(s["subtitle"])}</p>' if s.get("subtitle") else ""
    pill = f'<span class="sectionpill">{_e(s["section"])}</span>' if s.get("section") else ""
    return (f'<section class="slide quote"><div class="slide-body"><div class="quote-in">'
            f'{pill}<h1>{_e(s["title"])}</h1>{sub}</div></div>'
            f'{_takeaway(s)}{_footer(s, ctx)}</section>')


def _stats_html(stats, cls="cover-stats"):
    if not stats:
        return ""
    items = "".join(f'<div><div class="v">{_e(s["value"])}</div>'
                    f'<div class="l">{_e(s["label"])}</div></div>' for s in stats)
    return f'<div class="{cls}">{items}</div>'


def _t_cover(s, ctx, figs):
    c = s["content"]
    prompt = c.get("image_prompt") or "premium editorial context photograph, no text, no people"
    img = f'<img class="ai-img" data-prompt="{_e(prompt)}" alt="">'
    return (f'<section class="slide cover">'
            f'<div class="cover-left">'
            f'<p class="brandmark"><strong>TBS</strong><span>{_e(ctx.get("report_name","Organic Search Report"))}</span></p>'
            f'<h1>{_e(s["title"])}</h1>'
            f'<p class="subtitle">Prepared by TBS for {_e(c.get("client") or ctx.get("domain",""))}</p>'
            f'<p class="meta">{_e(c.get("meta") or ctx.get("period_label",""))}</p></div>'
            f'<div class="cover-right">{img}'
            f'<div class="cover-card"><span class="k">Prepared for</span>'
            f'<h3>{_e(c.get("client") or ctx.get("domain",""))}</h3>'
            f'<p class="d">{_e(c.get("descriptor",""))}</p>{_stats_html(c.get("stats"))}</div>'
            f'</div></section>')


def _t_closing(s, ctx, figs):
    c = s["content"]
    prompt = c.get("image_prompt") or "premium editorial context photograph, no text, no people"
    sub = f'<p class="subtitle">{_e(s["subtitle"])}</p>' if s.get("subtitle") else ""
    return (f'<section class="slide closing">'
            f'<img class="ai-img" data-prompt="{_e(prompt)}" alt=""><div class="scrim"></div>'
            f'<div class="closing-in"><h1>{_e(s["title"])}</h1>{sub}'
            f'{_stats_html(c.get("stats"), "closing-stats")}</div>'
            f'{_footer(s, ctx)}</section>')


RENDERERS = {
    "cover": _t_cover, "cards": _t_cards, "dark_split": _t_dark_split, "table": _t_table,
    "kpi_chart": _t_kpi_chart, "movers": _t_movers, "roadmap": _t_roadmap,
    "quote": _t_quote, "closing": _t_closing,
}

# Plotly mounts from the hidden specs. One line, deterministic — no model-authored JS.
_MOUNT_JS = """<script>(function(){
var s=document.querySelectorAll('script.plotly-spec');
for(var i=0;i<s.length;i++){try{
var f=JSON.parse(s[i].textContent), el=document.getElementById(s[i].dataset.target);
if(el&&window.Plotly)Plotly.newPlot(el,f.data,f.layout,{staticPlot:true,responsive:false});
}catch(e){}}})();</script>"""


def _vars(palette: Dict, fonts: Dict) -> str:
    p = palette
    return (":root{"
            f"--bg:{p.get('bg','#F5F7FA')};--surface:{p.get('surface','#FFFFFF')};"
            f"--line:{p.get('line','#E3E8EF')};--ink:{p.get('ink','#0F1B2D')};"
            f"--muted:{p.get('muted','#6B7A90')};--dark:{p.get('dark','#0F1B2D')};"
            f"--accent:{p.get('accent','#3C8DD9')};--accent-2:{p.get('accent2','#79B84B')};"
            f"--accent-3:{p.get('accent3','#F4B740')};--bad:{p.get('bad','#C4553B')};"
            f"--tint:{p.get('tint','#E8F4FB')};--tint2:{p.get('tint2','#F2F3EC')};"
            f"--font-display:'{fonts.get('display','Poppins')}';"
            f"--font-body:'{fonts.get('body','Inter')}';"
            "}")


def render_deck(slides: List[Dict], *, palette: Dict, fonts: Dict, ctx: Dict,
                figs: Optional[Dict[int, Dict]] = None) -> str:
    """Render validated slides (from deck_schema.normalize_plan) into one self-contained deck."""
    figs = figs or {}
    body = []
    for s in slides:
        fn = RENDERERS.get(s["template"])
        if not fn:
            continue
        try:
            body.append(fn(s, ctx, figs))
        except Exception:                      # one bad slide must not kill the deck
            import logging
            logging.getLogger(__name__).exception("Slide %s failed to render — skipping.", s.get("n"))
    return ("<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n"
            "<title>Report</title>\n<style>\n" + _vars(palette, fonts) + DECK_CSS +
            "\n</style>\n</head>\n<body>\n" + "\n".join(body) + "\n" + _MOUNT_JS + "\n</body>\n</html>")

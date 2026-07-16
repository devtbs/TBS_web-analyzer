# Deck Analyst Playbook

The CORE section below is injected verbatim into every deck prompt (single-pass and the 3-layer
Insights stage). The CONDITIONAL section documents the rules implemented in `analyst_flags.py`;
editing a threshold there tunes the flags — keep this table in sync.

## CORE PRINCIPLES

1. Lead every slide with the INSIGHT / takeaway, not the raw number — the number is evidence, not the point.
2. Every recommendation must name a specific query, page, or country FROM THE DATA — never generic advice.
3. Frame declines as opportunities to DEFEND or OPTIMISE, never as failure; stay executive and non-alarmist.
4. One sharp recommendation beats three vague ones; tie each recommendation to the metric that motivates it.
5. Quantify the upside whenever the data allows it (e.g. "~X extra clicks if pushed to top 3").
6. Do NOT repeat the KPI strip on every slide — each slide must earn its place with a distinct point.
7. Recommend only what the data supports (SEO content, internal linking, title/meta CTR, targeting) — no website-redesign guesses.

## CONDITIONAL RULES

These are computed in `analyst_flags.py` against the real period-over-period data and surfaced to the
model as an ANALYST FLAGS block. Thresholds are the named constants in that file.

| id | trigger (from real data) | flag it emits |
|----|--------------------------|---------------|
| R1 | overall clicks Δ ≥ +10% AND impressions Δ ≥ +10% | momentum — scale the winning content/topics |
| R2 | overall impressions Δ ≥ +15% AND clicks Δ ≤ +3% | rising visibility not converting — CTR/title opportunity |
| R3 | overall avg position worsened ≥ 0.5 | ranking softened — on-page refresh + internal links |
| R4 | query impressions Δ ≥ +20% AND position worsened ≥ 1.0 (impr ≥ 100) | DEFEND — demand rising, rank slipping, refresh the page |
| R5 | query clicks Δ ≥ +10 AND position improved ≥ 1.0 | MOMENTUM — double down on this query |
| R6 | query prev_position ≤ 3 AND now > 3 | AT RISK — a top-3 term slipped, defend priority |
| R7 | ctr_opportunities: actual_ctr < ½ expected_ctr (ranked by missed clicks) | QUICK CTR WIN — rewrite title/meta |
| R8 | striking_distance: top by potential extra clicks | NEAR PAGE 1 — push to top 3 |
| R9 | page clicks_delta ≤ −25% | PAGE DECLINE — investigate/refresh this landing page |

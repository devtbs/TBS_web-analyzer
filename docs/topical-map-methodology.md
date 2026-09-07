# Topical map methodology

The generation and writing prompts use the TBS methods described in [KORAYS FRAMEWORK](https://notes.tbs-marketing.com/share/11561214/qeyal4aelbvn0to6aayr) and [Writing](https://notes.tbs-marketing.com/share/11905586/r45ei9o2wplt16zk33hz). The Topical Map Creation SOP attached to Writing provides supporting page-boundary and architecture guidance. The distilled rules live in `backend/services/topical_methodology.py`; no live fetch of those notes is required when generating a map.

## Map to article

- Establish source context, central entity and central search intent. Carry the selected market through regeneration.
- Classify Core and Outer using the actual offering, with supporting topics connecting to Core.
- Use query clusters, observed URLs and competitor research to justify page boundaries. Do not force a fixed article count or competitor-gap quota.
- Each node records its main and supporting contexts, page rationale, evidence/assumptions, and whether it proposes creating or updating a page. Update targets must come from observed URLs. Volumes and difficulty come from metric providers, not the language model.
- Briefs receive the site's context, relevant cluster and stored research. They specify heading flow, answer-first writing, contextual links and verification needs.
- Write reuses the saved node brief; when missing, it creates a grounded node brief. The generic writing endpoint remains compatible with callers that do not supply a node ID.
- The UI exposes foundations and node details; Markdown and plan CSV exports retain the new fields and saved briefs.

## Reliability

Primary-site failure fails the analysis instead of promoting a competitor. Stable node IDs reject stale actions. Brief saves merge into the latest JSON under a short database row lock; regeneration rejects a plan changed since its read. Locks are not held across AI calls. Empty regeneration keeps the previous plan.

The database fields remain JSON; no schema migration is needed. Old nodes receive deterministic IDs when read. Older analyses without stored source context or market cannot recover historical inputs automatically; rerun those analyses with the intended inputs to populate the new foundations. Prompt changes affect future generations, not existing saved briefs.

## Validation

`backend/tests/test_topical_map.py` covers primary failures, concurrent saves, stale IDs, regeneration conflicts, saved-brief writing, market retention, malformed model output and measured zero volumes. Tests use mocked AI/SERP services and temporary SQLite databases. Production row-lock behavior is designed for PostgreSQL; live model output and paid research calls require a separate real-data smoke test.

The notes' methodology is used as editorial guidance. Ranking guarantees and fixed publication quotas are not encoded as established facts.

"""Domain-split API routers.

`backend/api/routes.py` was a single ~2k-line module holding 62 endpoints. It is now
split into focused routers by domain (auth, gsc, analytics, ranking, reports, decks,
analysis, content). Every route keeps its original full path, and main.py mounts each
router with no prefix, so all URLs are unchanged.
"""

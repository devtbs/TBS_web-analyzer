"""The agency's ready-made proposal decks.

Most pitches do not need a generated deck — we already have polished, approved proposals per
service in Canva and Google Slides. This module is the catalogue behind the Proposal tab's
"Use a ready-made proposal" mode: the user picks a service and a language, and the chosen deck is
saved against the client so it sits in Documents next to everything else for that account.

Links live in code rather than a table on purpose: they are agency-wide assets, they change rarely,
and keeping them here means they are reviewed like any other change instead of being edited live.
"""
from typing import List, Optional

# Each service carries the links we actually have. A missing link (Web Design has no Google Slides
# deck in English, and no Canva deck in Thai yet) is simply absent — the UI hides what is not there
# rather than offering a dead button.
PROPOSAL_LIBRARY: List[dict] = [
    {
        "id": "seo",
        "label": "SEO",
        "languages": {
            "en": {
                "canva": "https://canva.link/vhqq2wpi0hc0mh5",
                "slides": "https://docs.google.com/presentation/d/1FTkjklIFsqZgpxzJkl2z3YMJfZTnUDhjVrkfP_GdzNc/edit?usp=sharing",
            },
            "th": {"canva": "https://canva.link/xfkcc5xblm8u6jf"},
        },
    },
    {
        "id": "facebook-ads",
        "label": "Facebook Ads",
        "languages": {
            "en": {
                "canva": "https://canva.link/8vd59dugjfjjo5n",
                "slides": "https://docs.google.com/presentation/d/1Mzp5sYeN2MIkZUys5H87OdQ36ohjKthbavHUSR8dnmw/edit?usp=sharing",
            },
            "th": {"canva": "https://canva.link/2e37msw4k8283ve"},
        },
    },
    {
        "id": "google-ads",
        "label": "Google Ads",
        "languages": {
            "en": {
                "canva": "https://canva.link/4a41jf233xt63j7",
                "slides": "https://docs.google.com/presentation/d/1wy_SEdMoHMkjsFXtoSvX_1CRCacrTmiIRY146FdB2qo/edit?usp=sharing",
            },
            "th": {"canva": "https://canva.link/jwe11yo123yhfyd"},
        },
    },
    {
        "id": "web-design",
        "label": "Web Design",
        "languages": {
            "en": {"canva": "https://canva.link/240g0blhcnplvhg"},
            "th": {},
        },
    },
    {
        "id": "multimedia-design",
        "label": "Multimedia Design",
        "languages": {
            "en": {
                "canva": "https://canva.link/ucymrettln9yh18",
                "slides": "https://docs.google.com/presentation/d/1MG0EWdsRofcwojoDTV8vIvzhx4ylHEpJIjZaBit8Qlk/edit?usp=sharing",
            },
            "th": {"canva": "https://canva.link/7jgdsskcfjegde8"},
        },
    },
]

LANGUAGES = {"en": "English", "th": "Thai"}
FORMATS = {"canva": "Canva", "slides": "Google Slides"}


def catalogue() -> List[dict]:
    """The full library, with empty language entries dropped so the UI only offers real decks."""
    out = []
    for svc in PROPOSAL_LIBRARY:
        langs = {k: dict(v) for k, v in svc["languages"].items() if v}
        if langs:
            out.append({"id": svc["id"], "label": svc["label"], "languages": langs})
    return out


def find(service: str, language: str, fmt: str) -> Optional[dict]:
    """Resolve one library entry, or None when that combination does not exist."""
    for svc in PROPOSAL_LIBRARY:
        if svc["id"] != service:
            continue
        url = (svc["languages"].get(language) or {}).get(fmt)
        if not url:
            return None
        return {"service": svc["id"], "service_label": svc["label"],
                "language": language, "language_label": LANGUAGES.get(language, language),
                "format": fmt, "format_label": FORMATS.get(fmt, fmt), "url": url}
    return None

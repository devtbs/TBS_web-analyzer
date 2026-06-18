"""Extract "/on <date>" highlighted lines from free-text notes.

Single source of truth for the highlight trigger, shared by the standalone
highlight_to_pptx.py script and the AI presentation flow. Highlighted text is
always treated VERBATIM — nothing here rewrites or summarises it.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import List

# A highlight: a line that (ignoring leading whitespace) starts with "/on", then a
# date like "26 may", then the rest of the note. Date and detail captured separately.
HIGHLIGHT_RE = re.compile(
    r"""^\s*/on\s+
        (?P<date>\d{1,2}\s+[A-Za-z]+)
        (?:\s+(?P<detail>.*\S))?
        \s*$""",
    re.IGNORECASE | re.MULTILINE | re.VERBOSE,
)


@dataclass(frozen=True)
class Highlight:
    date: str
    detail: str = ""

    @property
    def text(self) -> str:
        """The full highlighted line, exactly as written."""
        return f"{self.date} {self.detail}".strip()


def extract_highlights(notes: str) -> List[Highlight]:
    if not notes:
        return []
    return [
        Highlight(date=m.group("date").strip(), detail=(m.group("detail") or "").strip())
        for m in HIGHLIGHT_RE.finditer(notes)
    ]


def highlight_texts(notes: str) -> List[str]:
    """Just the verbatim highlighted lines."""
    return [h.text for h in extract_highlights(notes)]


def to_brief_block(notes: str) -> str:
    """A brief addendum instructing the deck to reproduce the highlights verbatim.

    Returns '' when there are no highlights, so it's safe to always append.
    """
    texts = highlight_texts(notes)
    if not texts:
        return ""
    lines = "\n".join(f"- {t}" for t in texts)
    return (
        "\n\nKEY DATES / HIGHLIGHTS (flagged by the user). Add ONE dedicated "
        "'Key Dates' slide and reproduce each line below EXACTLY as written — "
        "verbatim, no rewording, summarising, reordering, or omissions:\n" + lines
    )

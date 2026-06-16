"""Library of editable AI-deck prompts, persisted to JSON so they survive restarts.

There is always a built-in "default" prompt (id="default", from ai_deck_service);
users can additionally save any number of named prompts and pick which one to use.
The required HTML output contract is appended separately at render time, so it can
never be edited away here.
"""
from __future__ import annotations

import json
import logging
import uuid
from pathlib import Path
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)

CONFIG_PATH = Path(__file__).resolve().parent.parent / "prompt_config.json"
DEFAULT_ID = "default"


def default_prompt() -> str:
    from services.ai_deck_service import DEFAULT_DECK_PROMPT
    return DEFAULT_DECK_PROMPT


def _load() -> Dict:
    try:
        if CONFIG_PATH.exists():
            data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
            if isinstance(data, dict) and isinstance(data.get("prompts"), list):
                return data
            # migrate old single-prompt format: {"prompt": "..."}
            if isinstance(data, dict) and data.get("prompt"):
                return {"prompts": [{"id": uuid.uuid4().hex[:8], "name": "Saved prompt", "prompt": data["prompt"]}]}
    except Exception as e:
        logger.warning("Failed to read prompt_config.json: %s", e)
    return {"prompts": []}


def _save(data: Dict) -> None:
    CONFIG_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def list_prompts() -> List[Dict]:
    """Built-in default first, then saved prompts — names only (for the picker)."""
    saved = [{"id": p["id"], "name": p["name"]} for p in _load()["prompts"]]
    return [{"id": DEFAULT_ID, "name": "Default (built-in)"}] + saved


def get_prompt_text(prompt_id: Optional[str]) -> str:
    """Resolve an id to prompt text. Unknown/default/blank → the built-in default."""
    if not prompt_id or prompt_id == DEFAULT_ID:
        return default_prompt()
    for p in _load()["prompts"]:
        if p["id"] == prompt_id:
            return p["prompt"]
    return default_prompt()


def get_prompt(prompt_id: str) -> Dict:
    if not prompt_id or prompt_id == DEFAULT_ID:
        return {"id": DEFAULT_ID, "name": "Default (built-in)", "prompt": default_prompt(), "builtin": True}
    for p in _load()["prompts"]:
        if p["id"] == prompt_id:
            return {**p, "builtin": False}
    return {"id": DEFAULT_ID, "name": "Default (built-in)", "prompt": default_prompt(), "builtin": True}


def upsert_prompt(name: str, prompt: str, prompt_id: Optional[str] = None) -> Dict:
    """Create a new saved prompt, or update an existing one by id."""
    name = (name or "Untitled prompt").strip()
    data = _load()
    if prompt_id and prompt_id != DEFAULT_ID:
        for p in data["prompts"]:
            if p["id"] == prompt_id:
                p["name"], p["prompt"] = name, prompt
                _save(data)
                return {"id": p["id"], "name": p["name"]}
    new = {"id": uuid.uuid4().hex[:8], "name": name, "prompt": prompt}
    data["prompts"].append(new)
    _save(data)
    return {"id": new["id"], "name": new["name"]}


def delete_prompt(prompt_id: str) -> None:
    if not prompt_id or prompt_id == DEFAULT_ID:
        return
    data = _load()
    data["prompts"] = [p for p in data["prompts"] if p["id"] != prompt_id]
    _save(data)

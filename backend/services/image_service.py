"""AI image generation for decks (Supermachine — dev.supermachine.art).

The backend generates images (it has internet — it already calls the LLM) and the
deck renderer embeds them as base64, so Chromium renders them offline. One failed
image never breaks a deck — callers get None and skip it.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Optional

from config import settings

logger = logging.getLogger(__name__)

# Supermachine API (resolved from dev.supermachine.art docs).
SUPERMACHINE_BASE = "https://dev.supermachine.art/v1"
SUPERMACHINE_POLL_ATTEMPTS = 30   # ~30 * 4s = 2 min ceiling per image
SUPERMACHINE_POLL_DELAY = 4       # seconds between polls

# Resolutions the "Supermachine NextGen" model accepts (the API rejects anything else
# with INVALID_RESOLUTION). We snap any requested size to the nearest of these by aspect
# ratio. 1280x720 matches the 16:9 deck slide, so it's the natural default.
SUPERMACHINE_RESOLUTIONS = [
    (1280, 720), (1184, 884), (1024, 768), (1024, 576),   # landscape
    (1024, 1024), (1280, 1280),                            # square
    (768, 1024), (884, 1184), (576, 1024), (720, 1280),    # portrait
]


def images_enabled() -> bool:
    return bool(getattr(settings, "SUPERMACHINE_API_KEY", ""))


def _compress(data: bytes) -> bytes:
    """Re-encode the generated image as a sized JPEG so embedded base64 stays small
    (keeps deck HTML light → reliable, fast Chromium render). Falls back to original."""
    try:
        from io import BytesIO
        from PIL import Image
        im = Image.open(BytesIO(data)).convert("RGB")
        im.thumbnail((1536, 1536))
        buf = BytesIO()
        im.save(buf, "JPEG", quality=80, optimize=True)
        return buf.getvalue()
    except Exception:
        return data


def _parse_size(size: str) -> tuple[int, int]:
    try:
        w, h = size.lower().split("x")
        return int(w), int(h)
    except Exception:
        return 1280, 720


def _snap_resolution(width: int, height: int) -> tuple[int, int]:
    """Pick the supported resolution closest in aspect ratio to the requested one,
    so the API never rejects us with INVALID_RESOLUTION."""
    target = width / height if height else 16 / 9
    return min(SUPERMACHINE_RESOLUTIONS, key=lambda wh: abs((wh[0] / wh[1]) - target))


async def generate_image(prompt: str, *, size: str = "1280x720",
                         quality: str = "medium") -> Optional[bytes]:
    """Generate one image via Supermachine: POST /v1/generate -> poll /v1/images
    until the batch completes -> download the result URL. Returns image bytes, or None.

    `quality` is accepted for call-site compatibility but is not used by Supermachine.
    """
    if not images_enabled():
        return None
    import httpx

    width, height = _snap_resolution(*_parse_size(size))
    model = getattr(settings, "SUPERMACHINE_MODEL", "") or "Supermachine NextGen"
    headers = {
        "Authorization": f"Bearer {settings.SUPERMACHINE_API_KEY}",
        "Content-Type": "application/json",
    }
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                f"{SUPERMACHINE_BASE}/generate",
                headers=headers,
                json={
                    "model": model,
                    "prompt": prompt,
                    "width": width,
                    "height": height,
                    "count": 1,
                },
            )
            resp.raise_for_status()
            batch_id = resp.json().get("batchId")
            if not batch_id:
                logger.warning("supermachine: no batchId in response")
                return None

            # Poll until the image for this batch is completed.
            for _ in range(SUPERMACHINE_POLL_ATTEMPTS):
                await asyncio.sleep(SUPERMACHINE_POLL_DELAY)
                poll = await client.get(
                    f"{SUPERMACHINE_BASE}/images",
                    headers=headers,
                    params={"batchId": batch_id},
                )
                poll.raise_for_status()
                items = poll.json().get("items") or []
                if not items:
                    continue
                item = items[0]
                status = str(item.get("status", "")).lower()
                if status == "completed" and item.get("url"):
                    img = await client.get(item["url"])
                    img.raise_for_status()
                    return _compress(img.content)
                if status in ("failed", "error"):
                    logger.warning("supermachine: batch %s failed", batch_id)
                    return None
            logger.warning("supermachine: batch %s timed out", batch_id)
            return None
    except Exception as e:
        logger.warning("supermachine image generation failed: %s", str(e)[:160])
        return None

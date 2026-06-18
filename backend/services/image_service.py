"""AI image generation for decks (OpenAI gpt-image-2).

The backend generates images (it has internet — it already calls the LLM) and the
deck renderer embeds them as base64, so Chromium renders them offline. One failed
image never breaks a deck — callers get None and skip it.
"""
from __future__ import annotations

import asyncio
import base64
import logging
from typing import Optional

from config import settings

logger = logging.getLogger(__name__)

IMAGE_MODEL = "gpt-image-2"


def images_enabled() -> bool:
    return bool(getattr(settings, "OPENAI_API_KEY", ""))


def _compress(data: bytes) -> bytes:
    """Re-encode the generated PNG as a sized JPEG so embedded base64 stays small
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


async def generate_image(prompt: str, *, size: str = "1536x1024",
                         quality: str = "medium") -> Optional[bytes]:
    """Generate one image with gpt-image-2. Returns PNG bytes, or None on failure."""
    if not images_enabled():
        return None
    from openai import AsyncOpenAI

    client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
    # Retry a few times to ride out rate limits (gpt-image-2 IPM caps are low on
    # lower tiers); back off between attempts.
    for attempt in range(4):
        try:
            resp = await client.images.generate(
                model=IMAGE_MODEL,
                prompt=prompt,
                size=size,
                quality=quality,
                n=1,
            )
            b64 = resp.data[0].b64_json
            if b64:
                return _compress(base64.b64decode(b64))
            return None
        except Exception as e:
            msg = str(e)
            is_rate = "429" in msg or "rate" in msg.lower()
            logger.warning("gpt-image-2 attempt %d failed (%s): %s",
                           attempt + 1, "rate-limit" if is_rate else "error", msg[:160])
            if attempt == 3:
                return None
            await asyncio.sleep(8 if is_rate else 2)
    return None

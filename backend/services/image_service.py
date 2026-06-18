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

# Primary model is configurable per-environment (OPENAI_IMAGE_MODEL); if that model
# isn't available on the account, we fall back to the widely-available gpt-image-1.
IMAGE_MODEL = getattr(settings, "OPENAI_IMAGE_MODEL", "") or "gpt-image-2"
FALLBACK_IMAGE_MODEL = "gpt-image-1"


def images_enabled() -> bool:
    return bool(getattr(settings, "OPENAI_API_KEY", ""))


def _is_model_unavailable(msg: str) -> bool:
    """True when the error is the model being unknown/unauthorized for this account,
    rather than a transient rate-limit — i.e. a different model should be tried."""
    m = msg.lower()
    return any(k in m for k in ("model_not_found", "does not exist", "not found",
                                "404", "403", "do not have access", "unsupported"))


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
    model = IMAGE_MODEL
    # Retry a few times to ride out rate limits (image-model IPM caps are low on lower
    # tiers); back off between attempts. If the configured model is unavailable on this
    # account, switch to the fallback model and keep trying.
    for attempt in range(4):
        try:
            resp = await client.images.generate(
                model=model,
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
            unavailable = _is_model_unavailable(msg)
            logger.warning("image model %s attempt %d failed (%s): %s",
                           model, attempt + 1,
                           "rate-limit" if is_rate else ("model-unavailable" if unavailable else "error"),
                           msg[:160])
            if unavailable and model != FALLBACK_IMAGE_MODEL:
                logger.warning("switching image model %s -> %s", model, FALLBACK_IMAGE_MODEL)
                model = FALLBACK_IMAGE_MODEL
                continue  # retry immediately with the fallback model
            if attempt == 3:
                return None
            await asyncio.sleep(8 if is_rate else 2)
    return None

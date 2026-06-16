"""SlideSpeak API client — AI-designed presentation generation.

Unlike the template renderer (presentation_generator.py), SlideSpeak's AI designs
the whole deck: layouts, visuals, structure. We feed it a text brief built from
the client's real data plus brand/tone instructions, then poll until the .pptx is
ready and download it.

Flow:
  1. POST /presentation/generate           -> { task_id }
  2. GET  /task_status/{task_id} (poll)     -> task_status == "SUCCESS", task_result -> .pptx URL
  3. download the returned URL              -> pptx bytes

Docs: https://docs.slidespeak.co/basics/api-references/
"""
from __future__ import annotations

import asyncio
import logging
from typing import Dict, Optional

import httpx

from config import settings

logger = logging.getLogger(__name__)

BASE_URL = "https://api.slidespeak.co/api/v1"


class SlideSpeakError(RuntimeError):
    pass


class SlideSpeakService:
    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or settings.SLIDESPEAK_API_KEY
        if not self.api_key:
            raise SlideSpeakError("SLIDESPEAK_API_KEY not configured.")

    @property
    def _headers(self) -> Dict[str, str]:
        return {"X-API-Key": self.api_key, "Content-Type": "application/json"}

    async def generate(
        self,
        plain_text: str,
        *,
        length: int = 8,
        template: str = "default",
        language: str = "ENGLISH",
        fetch_images: bool = True,
        tone: str = "professional",
        verbosity: str = "standard",
        custom_user_instructions: Optional[str] = None,
    ) -> str:
        """Kick off generation; returns a task_id to poll."""
        body = {
            "plain_text": plain_text,
            "length": length,
            "template": template,
            "language": language,
            "fetch_images": fetch_images,
            "tone": tone,
            "verbosity": verbosity,
        }
        if custom_user_instructions:
            body["custom_user_instructions"] = custom_user_instructions

        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(f"{BASE_URL}/presentation/generate",
                                     json=body, headers=self._headers)
        if resp.status_code >= 400:
            raise SlideSpeakError(f"generate failed ({resp.status_code}): {resp.text}")
        data = resp.json()
        task_id = data.get("task_id") or data.get("task_id".upper())
        if not task_id:
            raise SlideSpeakError(f"No task_id in response: {data}")
        return task_id

    async def wait_for_result(self, task_id: str, *, poll_interval: float = 3.0,
                              timeout: float = 300.0) -> str:
        """Poll task_status until SUCCESS; return the .pptx download URL."""
        elapsed = 0.0
        async with httpx.AsyncClient(timeout=60) as client:
            while elapsed < timeout:
                resp = await client.get(f"{BASE_URL}/task_status/{task_id}",
                                        headers=self._headers)
                if resp.status_code >= 400:
                    raise SlideSpeakError(f"task_status failed ({resp.status_code}): {resp.text}")
                data = resp.json()
                state = (data.get("task_status") or data.get("status") or "").upper()
                if state in ("SUCCESS", "SUCCEEDED", "COMPLETED"):
                    return self._extract_url(data)
                if state in ("FAILURE", "FAILED", "ERROR"):
                    raise SlideSpeakError(f"Generation failed: {data}")
                await asyncio.sleep(poll_interval)
                elapsed += poll_interval
        raise SlideSpeakError(f"Timed out after {timeout}s waiting for task {task_id}")

    @staticmethod
    def _extract_url(data: Dict) -> str:
        result = data.get("task_result") or data.get("result") or {}
        if isinstance(result, str):
            return result
        if isinstance(result, dict):
            for key in ("url", "presentation_url", "download_url", "pptx_url"):
                if result.get(key):
                    return result[key]
        raise SlideSpeakError(f"Could not find download URL in result: {data}")

    async def download(self, url: str) -> bytes:
        async with httpx.AsyncClient(timeout=120) as client:
            resp = await client.get(url)
        if resp.status_code >= 400:
            raise SlideSpeakError(f"download failed ({resp.status_code})")
        return resp.content

    async def generate_deck(self, plain_text: str, **kwargs) -> bytes:
        """Full flow: generate -> poll -> download. Returns .pptx bytes."""
        task_id = await self.generate(plain_text, **kwargs)
        logger.info("SlideSpeak task started: %s", task_id)
        url = await self.wait_for_result(task_id)
        logger.info("SlideSpeak deck ready: %s", url)
        return await self.download(url)

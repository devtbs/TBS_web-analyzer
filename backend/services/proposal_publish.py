"""Publish a proposal deck to Cloudflare Pages — one project per client.

A prospect should receive a clean, client-facing link (tbs-proposal-<client>.pages.dev), not a URL
on our internal tool. One project per client means the URL is stable and brandable, and re-running
the proposal updates the same address rather than scattering preview links.

Deployment goes through `wrangler pages deploy` rather than the Direct Upload API: that API needs a
hashed file manifest and a separate JWT upload round-trip per asset, all of which wrangler already
implements correctly.
"""
import asyncio
import json
import logging
import re
import shutil
import tempfile
from pathlib import Path
from typing import Optional

from config import settings

logger = logging.getLogger(__name__)

# Cloudflare project names: lowercase letters, digits and hyphens, 58 chars max.
_PROJECT_PREFIX = "tbs-proposal"
_MAX_NAME = 58
_API = "https://api.cloudflare.com/client/v4"


def is_configured() -> bool:
    return bool((settings.CLOUDFLARE_API_TOKEN or "").strip()
                and (settings.CLOUDFLARE_ACCOUNT_ID or "").strip())


def project_name(brand: str, domain: str = "") -> str:
    """Stable project name for a client, so re-publishing updates the same URL."""
    base = re.sub(r"[^a-z0-9]+", "-", (brand or domain or "client").lower()).strip("-")
    name = f"{_PROJECT_PREFIX}-{base}"[:_MAX_NAME].strip("-")
    return name or _PROJECT_PREFIX


async def _cf(method: str, path: str, payload: Optional[dict] = None) -> dict:
    import httpx
    headers = {"Authorization": f"Bearer {settings.CLOUDFLARE_API_TOKEN}",
               "Content-Type": "application/json"}
    url = f"{_API}/accounts/{settings.CLOUDFLARE_ACCOUNT_ID}{path}"
    async with httpx.AsyncClient(timeout=45) as c:
        r = await c.request(method, url, headers=headers,
                            content=json.dumps(payload) if payload else None)
    try:
        return r.json()
    except Exception:
        return {"success": False, "errors": [{"message": r.text[:300]}]}


async def ensure_project(name: str) -> None:
    """Create the Pages project if it does not exist yet. Idempotent."""
    got = await _cf("GET", f"/pages/projects/{name}")
    if got.get("success"):
        return
    made = await _cf("POST", "/pages/projects",
                     {"name": name, "production_branch": "main"})
    if not made.get("success"):
        errs = "; ".join(e.get("message", "") for e in (made.get("errors") or []))
        # A concurrent create is fine — anything else is not.
        if "already exists" not in errs.lower():
            raise RuntimeError(f"Could not create Cloudflare Pages project {name!r}: {errs[:200]}")


def _wrangler() -> str:
    for candidate in ("npx", "/usr/bin/npx", "/usr/local/bin/npx"):
        if shutil.which(candidate) or Path(candidate).exists():
            return candidate
    raise RuntimeError("npx not found on this host — cannot run wrangler.")


async def publish(html: str, brand: str, domain: str = "") -> dict:
    """Deploy one HTML page as a client's proposal site. Returns {url, project}."""
    if not is_configured():
        raise RuntimeError("Cloudflare is not configured — set CLOUDFLARE_API_TOKEN and "
                           "CLOUDFLARE_ACCOUNT_ID in backend/.env.")
    name = project_name(brand, domain)
    await ensure_project(name)

    tmp = Path(tempfile.mkdtemp(prefix="proposal-"))
    try:
        (tmp / "index.html").write_text(html, encoding="utf-8")
        # Stop Cloudflare serving the deck to search engines — it is a private client document.
        (tmp / "_headers").write_text("/*\n  X-Robots-Tag: noindex, nofollow\n", encoding="utf-8")

        cmd = [_wrangler(), "--yes", "wrangler@latest", "pages", "deploy", str(tmp),
               f"--project-name={name}", "--branch=main", "--commit-dirty=true"]
        proc = await asyncio.create_subprocess_exec(
            *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
            env={"CLOUDFLARE_API_TOKEN": settings.CLOUDFLARE_API_TOKEN,
                 "CLOUDFLARE_ACCOUNT_ID": settings.CLOUDFLARE_ACCOUNT_ID,
                 "PATH": "/usr/local/bin:/usr/bin:/bin", "HOME": str(Path.home()),
                 "CI": "1", "NO_COLOR": "1"})
        try:
            out_b, _ = await asyncio.wait_for(proc.communicate(), timeout=300)
        except asyncio.TimeoutError:
            proc.kill()
            raise RuntimeError("Cloudflare deploy timed out after 5 minutes.")
        out = (out_b or b"").decode("utf-8", "replace")

        if proc.returncode != 0:
            logger.error("wrangler failed (%s): %s", proc.returncode, out[-600:])
            raise RuntimeError(f"Cloudflare deploy failed: {out.strip()[-300:]}")

        # wrangler prints the deployment URL; fall back to the project's stable address.
        m = re.search(r"https://[a-z0-9.-]+\.pages\.dev", out)
        deploy_url = m.group(0) if m else ""
        logger.info("published proposal for %s to %s", brand, deploy_url or name)
        return {"project": name,
                "url": f"https://{name}.pages.dev",
                "deployment_url": deploy_url}
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

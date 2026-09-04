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


async def _zone_id(domain: str) -> Optional[str]:
    """The Cloudflare zone holding this domain, or None if it is not active on this account."""
    j = await _cf_root("GET", f"/zones?name={domain}")
    for z in (j.get("result") or []):
        if z.get("name") == domain:
            if z.get("status") != "active":
                logger.warning("zone %s is %s, not active — cannot attach a custom domain yet",
                               domain, z.get("status"))
                return None
            return z.get("id")
    return None


async def _cf_root(method: str, path: str, payload: Optional[dict] = None) -> dict:
    """Cloudflare call that is NOT account-scoped (zones live at the root)."""
    import httpx
    headers = {"Authorization": f"Bearer {settings.CLOUDFLARE_API_TOKEN}",
               "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=45) as c:
        r = await c.request(method, f"{_API}{path}", headers=headers,
                            content=json.dumps(payload) if payload else None)
    try:
        return r.json()
    except Exception:
        return {"success": False, "errors": [{"message": r.text[:300]}]}


async def attach_domain(project: str, host: str) -> bool:
    """Point <host> at this Pages project, creating the CNAME if Cloudflare did not.

    Returns True only when the hostname is actually attached — the caller falls back to the
    pages.dev URL otherwise, so a DNS problem never leaves the user without a working link.
    """
    base = host.split(".", 1)[1] if "." in host else host
    zone = await _zone_id(base)
    if not zone:
        return False

    added = await _cf("POST", f"/pages/projects/{project}/domains", {"name": host})
    errs = "; ".join(e.get("message", "") for e in (added.get("errors") or []))
    if not added.get("success") and "already" not in errs.lower():
        logger.error("could not attach %s to %s: %s", host, project, errs[:200])
        return False

    # Attaching usually creates the DNS record; add it ourselves when it did not.
    recs = await _cf_root("GET", f"/zones/{zone}/dns_records?name={host}")
    if not (recs.get("result") or []):
        made = await _cf_root("POST", f"/zones/{zone}/dns_records", {
            "type": "CNAME", "name": host, "content": f"{project}.pages.dev",
            "proxied": True, "comment": "TBS proposal deck"})
        if not made.get("success"):
            logger.error("CNAME for %s failed: %s", host,
                         [e.get("message") for e in (made.get("errors") or [])])
            return False
    return True


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
        url = f"https://{name}.pages.dev"

        # Prefer a client-facing subdomain when one is configured and the zone is ready.
        base = (settings.PROPOSAL_DOMAIN or "").strip().lstrip(".")
        if base:
            slug = re.sub(r"[^a-z0-9]+", "-", (brand or domain or "client").lower()).strip("-")[:40]
            host = f"{slug or 'proposal'}.{base}"
            if await attach_domain(name, host):
                url = f"https://{host}"
            else:
                logger.warning("custom domain %s not ready — returning the pages.dev link", host)

        logger.info("published proposal for %s to %s", brand, url)
        return {"project": name, "url": url, "deployment_url": deploy_url}
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

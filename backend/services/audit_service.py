"""Technical-SEO audit: crawl a property's pages and flag on-page issues.

Reuses SitemapService for URL discovery and a bounded httpx fetch for each page.
Runs Core Web Vitals via Google's keyless PageSpeed Insights API on a small
sample. Reports progress through the shared progress_tracker.
"""
import asyncio
import logging
from collections import defaultdict
from typing import List, Dict
from urllib.parse import urlparse

import httpx
from bs4 import BeautifulSoup

from services.sitemap_service import sitemap_service
from utils.progress_tracker import progress_tracker

logger = logging.getLogger(__name__)

# Bound concurrent page fetches so a large crawl doesn't exhaust sockets.
_FETCH_GATE = asyncio.Semaphore(6)
_HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; TBS-Audit/1.0; +https://analysis.phyominthein.com)"
}
_PSI_URL = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed"


def _property_to_base_url(property_url: str) -> str:
    """Turn a GSC property id into a crawlable base URL."""
    if property_url.startswith("sc-domain:"):
        return "https://" + property_url.replace("sc-domain:", "")
    return property_url


async def _fetch_page(client: httpx.AsyncClient, url: str) -> Dict:
    """Fetch one page and run on-page checks. Returns a per-page check dict."""
    async with _FETCH_GATE:
        try:
            r = await client.get(url, follow_redirects=True)
        except Exception as e:
            return {"url": url, "ok": False, "status": 0, "error": str(e)}

    out = {"url": url, "ok": True, "status": r.status_code}
    if r.status_code >= 400 or "text/html" not in r.headers.get("content-type", ""):
        return out

    soup = BeautifulSoup(r.text, "html.parser")
    title = (soup.title.string or "").strip() if soup.title else ""
    meta_desc_tag = soup.find("meta", attrs={"name": "description"})
    meta_desc = (meta_desc_tag.get("content") or "").strip() if meta_desc_tag else ""
    h1s = soup.find_all("h1")
    canonical = soup.find("link", attrs={"rel": "canonical"})
    has_schema = bool(soup.find_all("script", attrs={"type": "application/ld+json"}))
    text = soup.get_text(" ", strip=True)
    word_count = len(text.split())

    out.update({
        "title": title,
        "title_len": len(title),
        "meta_desc": meta_desc,
        "meta_desc_len": len(meta_desc),
        "h1_count": len(h1s),
        "has_canonical": canonical is not None,
        "has_schema": has_schema,
        "word_count": word_count,
    })
    return out


def _evaluate(pages: List[Dict]) -> List[Dict]:
    """Turn per-page checks into grouped issues with affected URLs."""
    buckets = defaultdict(list)
    seen_titles = defaultdict(list)

    for p in pages:
        url = p["url"]
        if not p.get("ok") or p.get("status", 0) == 0:
            buckets[("unreachable", "critical", "Page could not be fetched")].append(url)
            continue
        if p["status"] >= 400:
            buckets[(f"http_{p['status']}", "critical",
                     f"Returns HTTP {p['status']}")].append(url)
            continue
        if "title" not in p:
            continue  # non-HTML

        if not p["title"]:
            buckets[("missing_title", "critical", "Missing <title>")].append(url)
        else:
            seen_titles[p["title"]].append(url)
            if p["title_len"] > 60:
                buckets[("long_title", "info", "Title longer than 60 chars")].append(url)
            elif p["title_len"] < 15:
                buckets[("short_title", "warning", "Title shorter than 15 chars")].append(url)
        if not p["meta_desc"]:
            buckets[("missing_meta", "warning", "Missing meta description")].append(url)
        elif p["meta_desc_len"] > 160:
            buckets[("long_meta", "info", "Meta description longer than 160 chars")].append(url)
        if p["h1_count"] == 0:
            buckets[("missing_h1", "warning", "Missing <h1>")].append(url)
        elif p["h1_count"] > 1:
            buckets[("multiple_h1", "info", "Multiple <h1> tags")].append(url)
        if not p["has_canonical"]:
            buckets[("missing_canonical", "info", "Missing canonical link")].append(url)
        if not p["has_schema"]:
            buckets[("missing_schema", "info", "No structured data (JSON-LD)")].append(url)
        if p["word_count"] < 200:
            buckets[("thin_content", "warning", "Thin content (<200 words)")].append(url)

    # Duplicate titles across pages
    for title, urls in seen_titles.items():
        if len(urls) > 1:
            buckets[("duplicate_title", "warning",
                     f"Duplicate title: “{title[:60]}”")].extend(urls)

    issues = []
    for (itype, severity, message), urls in buckets.items():
        issues.append({
            "type": itype,
            "severity": severity,
            "message": message,
            "count": len(urls),
            "urls": urls[:50],
        })
    sev_rank = {"critical": 0, "warning": 1, "info": 2}
    issues.sort(key=lambda i: (sev_rank.get(i["severity"], 9), -i["count"]))
    return issues


async def _pagespeed(client: httpx.AsyncClient, url: str) -> Dict:
    """Core Web Vitals + performance score via keyless PageSpeed Insights."""
    try:
        from config import settings
        params = {"url": url, "strategy": "mobile", "category": "performance"}
        if settings.PAGESPEED_API_KEY:
            params["key"] = settings.PAGESPEED_API_KEY
        r = await client.get(_PSI_URL, params=params, timeout=60)
        if r.status_code != 200:
            return {"url": url, "ok": False}
        data = r.json()
        lh = data.get("lighthouseResult", {})
        score = lh.get("categories", {}).get("performance", {}).get("score")
        audits = lh.get("audits", {})

        def metric(key):
            return audits.get(key, {}).get("displayValue")

        return {
            "url": url,
            "ok": True,
            "performance_score": round(score * 100) if score is not None else None,
            "lcp": metric("largest-contentful-paint"),
            "cls": metric("cumulative-layout-shift"),
            "tbt": metric("total-blocking-time"),
            "fcp": metric("first-contentful-paint"),
        }
    except Exception as e:
        logger.warning(f"PSI failed for {url}: {e}")
        return {"url": url, "ok": False}


async def run_audit(audit_id: str, property_url: str, max_pages: int = 100):
    """Background entry point. Crawls, evaluates, and persists results."""
    from database import SessionLocal, Audit

    db = SessionLocal()
    try:
        await progress_tracker.create(audit_id, total_steps=4)
        base = _property_to_base_url(property_url)

        await progress_tracker.update(audit_id, 1, "discovering", "Discovering pages from sitemap...")
        urls = await sitemap_service.fetch_sitemap_urls(base, max_urls=max_pages)
        if not urls:
            urls = [base]

        await progress_tracker.update(audit_id, 2, "crawling",
                                      f"Crawling {len(urls)} pages...")
        async with httpx.AsyncClient(timeout=30, headers=_HEADERS, verify=False) as client:
            pages = await asyncio.gather(*[_fetch_page(client, u) for u in urls])

            await progress_tracker.update(audit_id, 3, "performance",
                                          "Measuring Core Web Vitals (sample)...")
            sample = [p["url"] for p in pages if p.get("status") == 200][:3]
            cwv = await asyncio.gather(*[_pagespeed(client, u) for u in sample]) if sample else []

        await progress_tracker.update(audit_id, 4, "finalizing", "Compiling report...")
        issues = _evaluate(pages)
        counts = defaultdict(int)
        for i in issues:
            counts[i["severity"]] += 1
        crawled = sum(1 for p in pages if p.get("ok"))
        # Simple score: 100 minus weighted issue penalties, floored at 0.
        penalty = counts["critical"] * 10 + counts["warning"] * 4 + counts["info"] * 1
        score = max(0, 100 - penalty)

        summary = {
            "pages_crawled": crawled,
            "pages_total": len(urls),
            "score": score,
            "counts": dict(counts),
            "core_web_vitals": [c for c in cwv if c.get("ok")],
        }

        audit = db.query(Audit).filter(Audit.audit_id == audit_id).first()
        if audit:
            audit.status = "complete"
            audit.summary = summary
            audit.issues = issues
            db.commit()

        await progress_tracker.complete(audit_id, "Audit complete!")
        logger.info(f"audit {audit_id}: {crawled} pages, score {score}, {len(issues)} issue types")
    except Exception as e:
        logger.error(f"audit {audit_id} failed: {e}")
        await progress_tracker.fail(audit_id, str(e))
        try:
            db.rollback()
            from database import Audit as A
            audit = db.query(A).filter(A.audit_id == audit_id).first()
            if audit:
                audit.status = "failed"
                audit.error = str(e)
                db.commit()
        except Exception:
            pass
    finally:
        db.close()

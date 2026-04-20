"""
News digest job — runs at 9am daily (and on demand).

Fetches RSS/Atom feeds configured in config.RSS_FEEDS, filters to entries
published in the last 48 hours, deduplicates by URL, and pushes each article
as a low-priority checklist item. If NEWS_INTERESTS is set, uses the LLM to
filter articles to only those relevant to the user's interests. Sends one
notification summarising results.
"""
from __future__ import annotations

import json
import logging
import xml.etree.ElementTree as ET
from datetime import datetime, timezone, timedelta
from email.utils import parsedate_to_datetime

import httpx

import checklist
import config
import notifications
import scheduler as _scheduler

log = logging.getLogger("shrimp.automations.news_digest")

# Atom namespace
_ATOM_NS = "http://www.w3.org/2005/Atom"


def _parse_date(date_str: str | None) -> datetime | None:
    """Parse RFC 2822 or ISO 8601 date strings, returning UTC-aware datetime."""
    if not date_str:
        return None
    date_str = date_str.strip()
    # Try RFC 2822 (common in RSS 2.0 pubDate)
    try:
        return parsedate_to_datetime(date_str).astimezone(timezone.utc)
    except Exception:
        pass
    # Try ISO 8601 variants (Atom published/updated)
    for fmt in (
        "%Y-%m-%dT%H:%M:%S%z",
        "%Y-%m-%dT%H:%M:%SZ",
        "%Y-%m-%dT%H:%M:%S.%f%z",
        "%Y-%m-%dT%H:%M:%S.%fZ",
        "%Y-%m-%d",
    ):
        try:
            dt = datetime.strptime(date_str, fmt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc)
        except ValueError:
            pass
    return None


def _fetch_entries(feed_url: str) -> list[dict]:
    """Fetch a feed URL and return a list of entry dicts."""
    try:
        with httpx.Client(timeout=20, follow_redirects=True) as client:
            resp = client.get(feed_url, headers={"User-Agent": "SHRIMP/1.0 RSS reader"})
            resp.raise_for_status()
            content = resp.text
    except Exception:
        log.exception("Failed to fetch feed: %s", feed_url)
        return []

    try:
        root = ET.fromstring(content)
    except ET.ParseError:
        log.warning("Failed to parse XML from: %s", feed_url)
        return []

    entries: list[dict] = []

    # Detect format: RSS 2.0 uses <channel><item>, Atom uses <feed><entry>
    tag = root.tag
    # Strip namespace if present
    if tag.startswith("{"):
        tag = tag.split("}", 1)[1]

    if tag in ("rss", "RDF"):
        # RSS 2.0 / RSS 1.0
        for item in root.iter("item"):
            title_el = item.find("title")
            link_el = item.find("link")
            desc_el = item.find("description")
            pub_el = item.find("pubDate") or item.find("dc:date", {"dc": "http://purl.org/dc/elements/1.1/"})
            entries.append({
                "title": (title_el.text or "").strip() if title_el is not None else "",
                "url": (link_el.text or "").strip() if link_el is not None else "",
                "description": (desc_el.text or "").strip() if desc_el is not None else "",
                "date_str": pub_el.text if pub_el is not None else None,
            })
    else:
        # Atom
        ns = {"atom": _ATOM_NS}
        # Try with namespace first, then without
        for entry in root.findall(f"{{{_ATOM_NS}}}entry") or root.findall("entry"):
            title_el = entry.find(f"{{{_ATOM_NS}}}title") or entry.find("title")
            # Atom link is an element with href attribute
            link_el = entry.find(f"{{{_ATOM_NS}}}link") or entry.find("link")
            link_url = ""
            if link_el is not None:
                link_url = link_el.get("href", "") or (link_el.text or "")
            summary_el = entry.find(f"{{{_ATOM_NS}}}summary") or entry.find("summary") or entry.find(f"{{{_ATOM_NS}}}content") or entry.find("content")
            pub_el = entry.find(f"{{{_ATOM_NS}}}published") or entry.find("published") or entry.find(f"{{{_ATOM_NS}}}updated") or entry.find("updated")
            entries.append({
                "title": (title_el.text or "").strip() if title_el is not None else "",
                "url": link_url.strip(),
                "description": (summary_el.text or "").strip() if summary_el is not None else "",
                "date_str": pub_el.text if pub_el is not None else None,
            })

    return entries


async def _call_llm(prompt: str) -> str:
    parts: list[str] = []
    async with httpx.AsyncClient(timeout=120) as client:
        async with client.stream(
            "POST",
            f"{config.OLLAMA_HOST}/api/generate",
            json={
                "model": config.OLLAMA_MODEL,
                "prompt": prompt,
                "stream": True,
                "options": {"num_ctx": min(getattr(config, "NUM_CTX", 4096), 4096)},
            },
        ) as resp:
            async for line in resp.aiter_lines():
                if not line.strip():
                    continue
                try:
                    obj = json.loads(line)
                    parts.append(obj.get("response", ""))
                    if obj.get("done"):
                        break
                except json.JSONDecodeError:
                    pass
    return "".join(parts).strip()


def _filter_by_interests(entries: list[tuple[dict, str]], interests: str) -> list[tuple[dict, str]]:
    """Use the LLM to keep only entries relevant to the user's interests."""
    if not entries:
        return entries

    numbered = "\n".join(
        f"{i+1}. {e['title']} — {e['description'][:150]}"
        for i, (e, _) in enumerate(entries)
    )
    prompt = (
        f"The user is interested in: {interests}\n\n"
        f"Below is a numbered list of news article headlines and summaries.\n"
        f"Return ONLY the numbers of articles that are relevant to the user's interests, "
        f"as a comma-separated list (e.g. 1,3,7). If none are relevant, return an empty response.\n\n"
        f"{numbered}"
    )

    try:
        raw = _scheduler.run_async(_call_llm(prompt))
        kept_indices: set[int] = set()
        for token in raw.replace(" ", "").split(","):
            token = token.strip()
            if token.isdigit():
                idx = int(token) - 1
                if 0 <= idx < len(entries):
                    kept_indices.add(idx)
        filtered = [entries[i] for i in sorted(kept_indices)]
        log.info("News digest: interest filter kept %d/%d articles", len(filtered), len(entries))
        return filtered
    except Exception:
        log.exception("News digest: interest filtering failed, returning all entries")
        return entries


def run() -> None:
    """Entry point called by the scheduler (sync)."""
    try:
        feeds: list[dict] = getattr(config, "RSS_FEEDS", [])
        enabled_feeds = [f for f in feeds if f.get("enabled", True)]

        if not enabled_feeds:
            log.info("News digest: no feeds configured or all disabled, skipping")
            return

        log.info("News digest: fetching %d feed(s)", len(enabled_feeds))

        cutoff = datetime.now(timezone.utc) - timedelta(hours=48)
        seen_urls: set[str] = set()
        all_new_entries: list[tuple[dict, str]] = []  # (entry, feed_name)

        for feed in enabled_feeds:
            feed_url: str = feed.get("url", "")
            feed_name: str = feed.get("name", feed_url)
            if not feed_url:
                continue

            entries = _fetch_entries(feed_url)
            log.info("News digest: %s — %d total entries", feed_name, len(entries))

            for entry in entries:
                url = entry.get("url", "")
                if not url or url in seen_urls:
                    continue

                # Filter by date
                dt = _parse_date(entry.get("date_str"))
                if dt is not None and dt < cutoff:
                    continue

                seen_urls.add(url)
                all_new_entries.append((entry, feed_name))

        if not all_new_entries:
            log.info("News digest: no new entries in the last 48 hours")
            return

        # Filter by interests if configured
        interests: str = getattr(config, "NEWS_INTERESTS", "").strip()
        if interests:
            log.info("News digest: filtering %d articles by interests", len(all_new_entries))
            all_new_entries = _filter_by_interests(all_new_entries, interests)
            if not all_new_entries:
                log.info("News digest: no articles matched interests")
                return

        added = 0
        feed_names_seen: set[str] = set()

        for entry, feed_name in all_new_entries:
            title = entry.get("title") or entry.get("url", "Untitled")
            url = entry["url"]
            description = entry.get("description", "")
            snippet = description[:300] if description else ""

            checklist.append_item(
                text=f"Read: {title}",
                source="news_digest",
                source_ref=url,
                priority="low",
                context={"feed": feed_name, "url": url, "summary": snippet},
            )
            added += 1
            feed_names_seen.add(feed_name)

        log.info("News digest: added %d new articles from %d feed(s)", added, len(feed_names_seen))

        notifications.append(
            title="News Digest",
            body=f"{added} new article{'s' if added != 1 else ''} across {len(feed_names_seen)} feed{'s' if len(feed_names_seen) != 1 else ''}",
            type="news_digest",
            priority="low",
            source="news_digest",
        )

        log.info("News digest complete")
    except Exception:
        log.exception("News digest job failed")

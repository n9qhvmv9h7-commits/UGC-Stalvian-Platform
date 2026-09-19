"""Story orchestration: fetch/cache panel content, localize per creator."""
import asyncio
import logging
from datetime import datetime

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.models import PanelCache, Story
from app.services.panel_client import PanelError, panel
from app.services.translator import translate_payload

logger = logging.getLogger(__name__)


async def cache_set(db: AsyncSession, key: str, payload: dict) -> None:
    """Persist the last-known copy of panel reference data."""
    row = (
        await db.execute(select(PanelCache).where(PanelCache.key == key))
    ).scalar_one_or_none()
    if row is None:
        db.add(PanelCache(key=key, payload=payload))
    else:
        row.payload = payload
        row.fetched_at = datetime.utcnow()
    await db.commit()


async def cache_get(db: AsyncSession, key: str) -> dict | None:
    row = (
        await db.execute(select(PanelCache).where(PanelCache.key == key))
    ).scalar_one_or_none()
    return row.payload if row else None


async def cached_fetch(
    db: AsyncSession, key: str, fetch, max_age_seconds: int = 6 * 3600
) -> dict:
    """Serve `key` from panel_cache while fresh; refresh via `fetch()` when
    stale; fall back to the stale copy if the panel is unreachable. Raises
    PanelError only when there is nothing cached at all."""
    row = (
        await db.execute(select(PanelCache).where(PanelCache.key == key))
    ).scalar_one_or_none()
    if row is not None:
        age = (datetime.utcnow() - row.fetched_at.replace(tzinfo=None)).total_seconds()
        if age < max_age_seconds:
            return row.payload
    try:
        payload = await fetch()
    except PanelError:
        if row is not None:
            logger.warning("Panel unreachable — serving stale cache for %s", key)
            return row.payload
        raise
    await cache_set(db, key, payload)
    return payload


def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        # Python 3.10's fromisoformat rejects the "Z" suffix
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def normalize_scenes(scenes: list | None) -> list[dict]:
    """Panel scenes use visual_description/text_overlay; the UI speaks visual/overlay."""
    out = []
    for scene in scenes or []:
        if not isinstance(scene, dict):
            continue
        out.append(
            {
                "narration": scene.get("narration"),
                "visual": scene.get("visual") or scene.get("visual_description"),
                "overlay": scene.get("overlay") or scene.get("text_overlay"),
                "duration_seconds": scene.get("duration_seconds"),
            }
        )
    return out


async def localized_payload(db: AsyncSession, story: Story, language: str) -> dict:
    """Return the story payload in `language`, translating + caching on first request."""
    if story.language == language:
        return story.payload
    translations = story.translations or {}
    if language in translations:
        return translations[language]
    if language == "en":
        # story was stored already-translated and has no English copy (legacy
        # rows) — serve the primary payload rather than machine-translating back
        return story.payload

    translated = await asyncio.get_event_loop().run_in_executor(
        None, lambda: translate_payload(story.payload, language)
    )
    if translated is None:
        # Translation unavailable right now — serve English, cache nothing,
        # so the next request retries instead of locking English in.
        return story.payload
    translations[language] = translated
    story.translations = translations
    flag_modified(story, "translations")
    await db.commit()
    return translated


# ---- Single panel connection ---------------------------------------------
# ONE pipeline pulls everything from the panel (albums catalog + approved
# script feeds), persists it locally, and each UGC section serves from the
# DB only. No request path talks to the panel directly (the sole exception:
# on-demand album-story generation, which is inherently live).

# feed name on the /api/ugc/scripts surface -> our Story.kind
_FEED_KINDS = {
    "breaking": "breaking",
    "movers": "mover",
    "hindsight": "hindsight",
    "trending": "trending",
    # X threads for creators on tweet accounts. The panel composes the tweet
    # text server-side from the same posts its Instagram layouts render, and
    # serves them on the same /api/ugc/scripts surface — so they sync, retract
    # and translate exactly like the video feeds. Kinds are prefixed "x_" so
    # the two surfaces can never be confused in a query.
    "tweets_breaking": "x_breaking",
    "tweets_trending": "x_trending",
}


def is_thread_kind(kind: str | None) -> bool:
    return bool(kind) and kind.startswith("x_")


def _payload_fn(kind: str):
    """Movers carry extra chart fields, threads carry tweets instead of
    scenes; every other feed is the plain script shape, which is also the
    right default for a feed added later."""
    if kind == "mover":
        return _mover_script_payload
    if is_thread_kind(kind):
        return _thread_payload
    return _breaking_payload


async def sync_all(db: AsyncSession) -> dict:
    """The single sync pass. Each part fails soft so one broken feed never
    blocks the others — but a part that failed is REPORTED rather than only
    logged: a feed that stays empty because the panel refused it is otherwise
    indistinguishable from a feed the panel has nothing for, and the only
    place that difference is visible is a server log nobody is watching."""
    result: dict = {
        "new_breaking": 0, "new_movers": 0, "created": 0,
        "updated": 0, "retracted": 0, "catalog": False, "errors": {},
    }
    try:
        await cache_set(db, "albums", await panel.list_albums())
        result["catalog"] = True
    except PanelError as exc:
        logger.warning("Catalog sync skipped: %s", exc)
        result["errors"]["albums"] = str(exc)
    for feed in _FEED_KINDS:
        try:
            created, updated = await _sync_feed(db, feed)
            result[f"new_{feed}"] = created
            result["created"] += created
            result["updated"] += updated
        except PanelError as exc:
            logger.warning("%s sync skipped: %s", feed, exc)
            result["errors"][feed] = str(exc)
    try:
        result["retracted"], refreshed = await _reconcile_feeds(db)
        result["updated"] += refreshed
    except PanelError as exc:
        logger.warning("Feed reconcile skipped: %s", exc)
        result["errors"]["retractions"] = str(exc)
    return result


async def _sync_feed(db: AsyncSession, feed: str) -> tuple[int, int]:  # noqa: C901
    """Incremental sync of one approved feed (updated_since cursor). Items
    can legitimately reappear when edited + re-approved -> upsert."""
    kind = _FEED_KINDS[feed]
    cursor = await cache_get(db, f"cursor:{feed}") or {}
    updated_since = cursor.get("updated_since")
    created = updated = 0
    max_updated = updated_since
    page, limit = 1, 100
    while True:
        data = await panel.list_scripts(
            feed, updated_since=updated_since, page=page, limit=limit
        )
        items = data.get("items", [])
        for item in items:
            if item.get("id") is None:
                continue
            stamp = item.get("updated_at") or item.get("generated_at")
            if stamp and (max_updated is None or stamp > max_updated):
                max_updated = stamp
            c, u = await _upsert_story(db, kind, item)
            created += c
            updated += u
        # Same reason as the sweep: land each page rather than carrying the
        # whole feed in one session. The cursor below only moves once every
        # page is in, so a crash mid-feed re-reads it rather than skipping it.
        await db.commit()
        db.expunge_all()
        # The feed is newest-first, so the cursor only advances after EVERY
        # page of the changed set is consumed — a partial read would skip the
        # older pages forever. A short page means the set is exhausted; never
        # trust `total` (a missing value must not truncate the read).
        if len(items) < limit:
            break
        page += 1
    await db.commit()
    if created or updated:
        logger.info("Synced %s: %d new, %d updated", feed, created, updated)
    if max_updated:
        await cache_set(db, f"cursor:{feed}", {"updated_since": max_updated})
    return created, updated


async def _upsert_story(
    db: AsyncSession, kind: str, item: dict, *, trust_payload: bool = False
) -> tuple[int, int]:
    """Insert or update one panel script. Returns (created, updated) as 0/1.

    `trust_payload` skips the replay guard below. Pass it only for a full read
    of the panel's current feed, which IS the current truth; the guard exists
    for deliveries that can arrive out of order, not for a fresh sweep.
    """
    ref = str(item["id"])
    to_payload = _payload_fn(kind)
    existing = (
        await db.execute(select(Story).where(Story.kind == kind, Story.panel_ref == ref))
    ).scalar_one_or_none()
    if existing is None:
        story = Story(
            kind=kind,
            panel_ref=ref,
            language="en",
            payload=to_payload(item),
            raw=item,  # keep the exact panel response locally
            published_at=_parse_dt(item.get("generated_at")),
        )
        # Savepoint per item: a concurrent sync (scheduler + manual refresh)
        # inserting the same panel_ref must not sink the whole batch.
        try:
            async with db.begin_nested():
                db.add(story)
            return 1, 0
        except IntegrityError:
            return 0, 0
    # Replay/ordering guard: never overwrite with a version that isn't newer.
    old_stamp = (existing.raw or {}).get("updated_at")
    new_stamp = item.get("updated_at")
    if not trust_payload and new_stamp and old_stamp and new_stamp <= old_stamp:
        return 0, 0
    new_payload = to_payload(item)
    if existing.payload == new_payload and existing.status == "active":
        return 0, 0
    existing.payload = new_payload
    existing.raw = item
    existing.translations = {}  # content changed — cached translations are stale
    existing.status = "active"  # an edited re-approval reactivates it
    existing.published_at = _parse_dt(item.get("generated_at")) or existing.published_at
    return 0, 1


async def _reconcile_feeds(db: AsyncSession) -> tuple[int, int]:
    """The full read of every feed, for the two things a cursor cannot do.

    Retractions: any active id we hold that is no longer in the panel's feed
    has been withdrawn (the poll fallback for a missed script.retracted).

    Corrections, for the thread feeds only: the panel composes X threads from
    its posts on read, so a fix on its side changes the text without touching
    `updated_at` and an incremental sync would never see it. This pass already
    holds every current item, so it re-upserts those with the replay guard
    off. Unchanged payloads write nothing, so the cost is a comparison per
    item.

    MEMORY IS THE CONSTRAINT HERE, not time. The tweet feeds run to thousands
    of posts — tweets_breaking alone is 18+ pages of 100 — so anything this
    loop keeps, it keeps thousands of times over on a 512 MB instance. Every
    page is therefore committed and expunged before the next is fetched, and
    the retraction check reads three columns rather than whole Story rows with
    their payload and raw panel response attached.
    """
    retracted = refreshed = 0
    for feed, kind in _FEED_KINDS.items():
        approved_ids: set[str] = set()
        page = 1
        while True:
            data = await panel.list_scripts(feed, page=page, limit=100)
            items = data.get("items", [])
            approved_ids |= {str(i["id"]) for i in items if i.get("id") is not None}
            # Only the thread feeds are recomposed on read; a script feed is
            # stored as generated, so an edit there moves `updated_at` and the
            # incremental sync already has it. No reason to re-compare
            # thousands of scripts every half hour.
            if is_thread_kind(kind):
                for item in items:
                    if item.get("id") is None:
                        continue
                    _created, updated = await _upsert_story(
                        db, kind, item, trust_payload=True
                    )
                    refreshed += updated
            # Land this page and let go of it. Holding every item of every
            # feed until one commit at the end is what an OOM kill looks like.
            await db.commit()
            db.expunge_all()
            # Terminate ONLY on a short page — a missing/zero `total` must not
            # truncate the sweep and mass-retract everything beyond page 1.
            if len(items) < 100:
                break
            page += 1
        # Three columns, not whole rows: the payload and the stored panel
        # response are not needed to decide a status, and there are thousands
        # of these.
        rows = (
            await db.execute(
                select(Story.id, Story.panel_ref, Story.status).where(
                    Story.kind == kind,
                    Story.creator_id.is_(None),
                    Story.status.in_(("active", "retracted")),
                )
            )
        ).all()
        active = [r for r in rows if r.status == "active"]
        # Safety valve: an empty approved feed while we hold active content is
        # far more likely a panel incident (reset DB, dormant config) than a
        # deliberate retract-everything — never mass-retract on it.
        if not approved_ids and active:
            logger.warning(
                "Approved %s feed is empty while %d local stories are active — "
                "skipping retraction sweep",
                feed,
                len(active),
            )
            continue
        gone = [
            r.id
            for r in rows
            if r.panel_ref and r.status == "active" and r.panel_ref not in approved_ids
        ]
        # Self-healing: a falsely retracted story (transient partial read,
        # misrouted webhook) comes back on the next sweep.
        back = [
            r.id
            for r in rows
            if r.panel_ref and r.status == "retracted" and r.panel_ref in approved_ids
        ]
        for ids, status in ((gone, "retracted"), (back, "active")):
            # Chunked: an IN list of several thousand ids is a statement no
            # database enjoys parsing.
            for start in range(0, len(ids), 500):
                await db.execute(
                    update(Story)
                    .where(Story.id.in_(ids[start : start + 500]))
                    .values(status=status)
                )
        retracted += len(gone)
        await db.commit()
        db.expunge_all()

    if retracted:
        logger.info("Retired %d retracted stories", retracted)
    if refreshed:
        logger.info("Refreshed %d stories the panel had recomposed", refreshed)
    return retracted, refreshed


async def apply_webhook_event(db: AsyncSession, event: str, item: dict) -> dict:
    """Handle a verified panel webhook (script.approved / script.retracted)."""
    feed = item.get("feed") or (
        "movers" if item.get("trade_type") == "album_mover_script" else "breaking"
    )
    kind = _FEED_KINDS.get(feed, "breaking")
    if event == "script.approved":
        created, updated = await _upsert_story(db, kind, item)
        await db.commit()
        return {"created": bool(created), "updated": bool(updated)}
    # Retraction: panel ids are unique across feeds, so look the story up by
    # ref alone — a payload without feed markers must still retract correctly.
    row = (
        await db.execute(
            select(Story).where(
                Story.creator_id.is_(None), Story.panel_ref == str(item["id"])
            )
        )
    ).scalar_one_or_none()
    if row is not None and row.status != "retracted":
        row.status = "retracted"
        await db.commit()
        return {"retracted": True}
    return {"retracted": False}


def _breaking_payload(item: dict) -> dict:
    return {
        "title": item.get("title"),
        "hook": item.get("hook"),
        "script_body": item.get("script_body"),
        "scenes": normalize_scenes(item.get("scenes")),
        "alternative_hooks": item.get("alternative_hooks") or [],
        "call_to_action": item.get("call_to_action"),
        "hashtags": item.get("hashtags") or [],
        "virality_score": item.get("virality_score"),
        "sources": item.get("sources") or [],
    }


def _thread_payload(item: dict) -> dict:
    """An X thread from the panel: `tweets` is the whole point, and the rest
    is what a creator needs to judge and cite it. Panel imagery is never
    carried — creators supply their own visuals."""
    tweets = [
        {"text": str(t.get("text")).strip(), "order": t.get("order") or i + 1}
        for i, t in enumerate(item.get("tweets") or [])
        if isinstance(t, dict) and str(t.get("text") or "").strip()
    ]
    chart = item.get("chart_data") or {}
    # Trending headlines are line-broken for the Instagram carousel; a title
    # on a card is one line.
    title = " ".join(str(item.get("title") or chart.get("slide1_headline") or "").split())
    return {
        "title": title,
        "tweets": tweets,
        "ticker": item.get("ticker") or chart.get("ticker") or "",
        "hashtags": item.get("hashtags") or [],
        "virality_score": item.get("virality_score"),
        "sources": item.get("sources") or [],
    }


def _mover_script_payload(item: dict) -> dict:
    """Album Movers Scripts arrive shoot-ready from the panel's curated
    pipeline (PANEL_MOVERS_SCRIPTS_SPEC.md) — we pass the copy through
    untouched and lift display stats out of chart_data."""
    chart = item.get("chart_data") or {}
    return {
        **_breaking_payload(item),
        "ticker": item.get("ticker") or chart.get("ticker") or "",
        "album_name": chart.get("album_name") or "",
        "album_kind": chart.get("kind") or "",
        "company_name": chart.get("company_name") or "",
        "amount_str": chart.get("amount_str") or "",
        # month_return_pct is the real 30-day move; pct_change is only the chart window
        "pct_change": chart.get("month_return_pct", chart.get("pct_change")),
    }



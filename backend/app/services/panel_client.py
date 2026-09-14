"""HTTP client for the Stalvian Marketing Panel's /api/ugc/* surface.

All content and data on the UGC platform originates from the panel. Auth is a
scoped X-API-Key header (no login/refresh). The script feeds carry every script
the panel holds — there is no curation gate, creators browse the lot and pick —
except ones the panel has explicitly withdrawn, which arrive as retractions.
Rate limits: 240 req/60s across the surface, 30 req/60s on album-story
generation. See PANEL_INTEGRATION_CHANGES_FOR_UGC.md.
"""
import logging

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

# Content angles mirrored from the panel spec (unknown angle -> 400 panel-side).
FUND_ANGLES = [
    "origin_story", "performance", "scandal", "positions",
    "strategy", "ceo_founder", "funny_quirky", "comparison",
]
POLITICIAN_ANGLES = [
    "origin_story", "trading_record", "scandal", "committee_trades",
    "hypocrisy", "best_trades", "comparison", "funny_quirky",
]


class PanelError(Exception):
    pass


class PanelClient:
    async def _request(self, method: str, path: str, *, json=None, params=None, timeout: float = 60):
        try:
            async with httpx.AsyncClient(base_url=settings.PANEL_API_URL, timeout=timeout) as client:
                resp = await client.request(
                    method, path, json=json, params=params,
                    headers={"X-API-Key": settings.PANEL_API_KEY},
                )
        except httpx.HTTPError as exc:
            raise PanelError(f"Panel unreachable: {exc}")
        if resp.status_code == 429:
            raise PanelError(f"Panel rate limit hit on {path}")
        if resp.status_code >= 400:
            logger.warning("Panel %s %s -> %s: %s", method, path, resp.status_code, resp.text[:300])
            raise PanelError(f"Panel {method} {path} failed ({resp.status_code})")
        return resp.json()

    # ---- Albums catalog ------------------------------------------------
    async def list_albums(self) -> dict:
        """{funds: [{name, slug, total_return, cagr, alpha}],
            politicians: [{name, slug, party, total_return}]}"""
        data = await self._request("GET", "/api/ugc/albums")
        funds, politicians = [], []
        for album in data.get("albums", []):
            returns = album.get("returns") or {}
            base = {
                "name": album.get("name"),
                "slug": album.get("slug"),
                "total_return": returns.get("total_return", "—"),
                "cagr": returns.get("cagr", "—"),
                "alpha": returns.get("alpha", "—"),
                "sharpe": returns.get("sharpe", "—"),
                "max_drawdown": returns.get("max_drawdown", "—"),
            }
            if album.get("kind") == "politician":
                politicians.append(
                    {**base, "party": album.get("party"), "chamber": album.get("chamber")}
                )
            else:
                funds.append(base)
        return {"funds": funds, "politicians": politicians}

    # ---- Album stories (on-demand, English source) ---------------------
    async def generate_album_story(
        self, kind: str, name: str, angle: str, slug: str | None = None
    ) -> dict:
        """POST /api/ugc/album-story — slug preferred (exact), name fallback."""
        body = {"kind": kind, "angle": angle}
        if slug:
            body["slug"] = slug
        else:
            body["name"] = name
        return await self._request("POST", "/api/ugc/album-story", json=body, timeout=240)

    # ---- Portfolio charts + holdings (same UGC key as everything else) --
    async def portfolio_history(self, slug: str, range_: str = "all") -> dict:
        """{slug, range, note, points: [{date, portfolio, spy}], holdings_history}
        — index values, 100 = series start."""
        return await self._request(
            "GET", f"/api/ugc/portfolios/{slug}/history", params={"range": range_}
        )

    async def portfolio_detail(self, slug: str) -> dict:
        """Summary (returns incl. beta) + current holdings + holdings_as_of."""
        return await self._request("GET", f"/api/ugc/portfolios/{slug}")

    # ---- Approved script feeds (webhook poll fallback) -----------------
    async def list_scripts(
        self,
        feed: str,
        updated_since: str | None = None,
        page: int = 1,
        limit: int = 100,
    ) -> dict:
        """{items, total, page, limit} — every script, newest-changed first."""
        params = {"feed": feed, "page": page, "limit": limit}
        if updated_since:
            params["updated_since"] = updated_since
        return await self._request("GET", "/api/ugc/scripts", params=params)


panel = PanelClient()

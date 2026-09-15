"""TikTok Login Kit + Display API.

Docs: developers.tiktok.com — /v2/oauth/token/, /v2/video/list/.

Two properties of TikTok's OAuth that shape the code:
  - the refresh token ROTATES on every refresh, so the new one must be stored
    or the connection dies within 24 hours;
  - scopes are granted individually, so `video.list` can be declined while
    login succeeds.
"""
import logging
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

import httpx

from app.config import settings
from app.services.social.base import (
    RemoteVideo,
    SocialProviderError,
    TokenBundle,
)
from app.services.view_tracker import canonical_key

logger = logging.getLogger(__name__)

_AUTHORIZE = "https://www.tiktok.com/v2/auth/authorize/"
_TOKEN = "https://open.tiktokapis.com/v2/oauth/token/"
_VIDEO_LIST = "https://open.tiktokapis.com/v2/video/list/"

# user.info.basic is required for the account identity; video.list is what
# makes ownership matching possible at all.
REQUIRED_SCOPES = ("user.info.basic", "video.list")

_VIDEO_FIELDS = "id,title,video_description,create_time,share_url,view_count"


def _expiry(seconds: int | None) -> datetime | None:
    if not seconds:
        return None
    return datetime.now(timezone.utc) + timedelta(seconds=int(seconds))


def _raise_for(payload: dict, resp: httpx.Response) -> None:
    """TikTok reports failures in the body with a 200, so status alone lies."""
    error = payload.get("error")
    code = (payload.get("error") or {}).get("code") if isinstance(error, dict) else error
    if not code or code in ("ok", "success"):
        return
    message = str(
        payload.get("error_description")
        or (payload.get("error") or {}).get("message")
        or payload.get("message")
        or code
    )
    # Anything about the grant means the creator must reconnect; everything
    # else is worth retrying rather than declaring the connection dead.
    fatal = str(code) in {
        "invalid_grant",
        "invalid_request",
        "access_token_invalid",
        "scope_not_authorized",
    }
    raise SocialProviderError(f"TikTok: {message}", retryable=not fatal)


class TikTokProvider:
    name = "tiktok"
    required_scopes = REQUIRED_SCOPES

    def is_configured(self) -> bool:
        return bool(settings.TIKTOK_CLIENT_KEY and settings.TIKTOK_CLIENT_SECRET)

    def authorize_url(self, state: str, code_challenge: str, redirect_uri: str) -> str:
        return f"{_AUTHORIZE}?" + urlencode(
            {
                "client_key": settings.TIKTOK_CLIENT_KEY,
                "scope": ",".join(REQUIRED_SCOPES),
                "response_type": "code",
                "redirect_uri": redirect_uri,
                "state": state,
                "code_challenge": code_challenge,
                "code_challenge_method": "S256",
            }
        )

    async def _token_request(self, data: dict) -> dict:
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(
                    _TOKEN,
                    data={
                        "client_key": settings.TIKTOK_CLIENT_KEY,
                        "client_secret": settings.TIKTOK_CLIENT_SECRET,
                        **data,
                    },
                    headers={"Content-Type": "application/x-www-form-urlencoded"},
                )
        except httpx.HTTPError as exc:
            raise SocialProviderError(f"TikTok unreachable: {exc}", retryable=True)
        payload = resp.json()
        _raise_for(payload, resp)
        return payload

    def _bundle(self, payload: dict) -> TokenBundle:
        granted = [s for s in (payload.get("scope") or "").replace(" ", ",").split(",") if s]
        return TokenBundle(
            access_token=payload["access_token"],
            # Rotates on every refresh — storing the new value is not optional.
            refresh_token=payload.get("refresh_token"),
            access_expires_at=_expiry(payload.get("expires_in")),
            refresh_expires_at=_expiry(payload.get("refresh_expires_in")),
            account_id=payload.get("open_id") or "",
            scopes=granted,
        )

    async def exchange_code(
        self, code: str, code_verifier: str, redirect_uri: str
    ) -> TokenBundle:
        bundle = self._bundle(
            await self._token_request(
                {
                    "code": code,
                    "grant_type": "authorization_code",
                    "redirect_uri": redirect_uri,
                    "code_verifier": code_verifier,
                }
            )
        )
        # A connection without video.list can never match anything, so refuse
        # it here rather than storing something that silently does nothing.
        missing = [s for s in REQUIRED_SCOPES if s not in bundle.scopes]
        if missing:
            raise SocialProviderError(
                "TikTok connection needs access to your video list — "
                "please allow every permission on the TikTok screen.",
                retryable=False,
            )
        return bundle

    async def refresh(self, refresh_token: str) -> TokenBundle:
        return self._bundle(
            await self._token_request(
                {"grant_type": "refresh_token", "refresh_token": refresh_token}
            )
        )

    async def list_recent_media(
        self, access_token: str, since: datetime
    ) -> list[RemoteVideo]:
        """Videos newer than `since`, newest first.

        Stops as soon as the page runs older than the window — never pages
        through full history.
        """
        out: list[RemoteVideo] = []
        cursor: int | None = None
        for _ in range(5):  # hard cap; the window check normally exits sooner
            body: dict = {"max_count": 20}
            if cursor:
                body["cursor"] = cursor
            try:
                async with httpx.AsyncClient(timeout=30) as client:
                    resp = await client.post(
                        _VIDEO_LIST,
                        params={"fields": _VIDEO_FIELDS},
                        json=body,
                        headers={
                            "Authorization": f"Bearer {access_token}",
                            "Content-Type": "application/json",
                        },
                    )
            except httpx.HTTPError as exc:
                raise SocialProviderError(f"TikTok unreachable: {exc}", retryable=True)
            payload = resp.json()
            _raise_for(payload, resp)

            data = payload.get("data") or {}
            reached_window_end = False
            for item in data.get("videos") or []:
                created = item.get("create_time")
                published = (
                    datetime.fromtimestamp(int(created), tz=timezone.utc) if created else None
                )
                if published and published < since:
                    reached_window_end = True
                    continue
                share_url = item.get("share_url") or ""
                if not share_url:
                    continue
                out.append(
                    RemoteVideo(
                        # From the platform's own URL, so the key is computed by
                        # exactly the same function that keys a pasted link.
                        canonical_key=canonical_key(share_url, "tiktok"),
                        platform_media_id=str(item.get("id") or ""),
                        permalink=share_url,
                        published_at=published,
                        views=item.get("view_count"),
                        title=(item.get("title") or item.get("video_description") or None),
                    )
                )
            if reached_window_end or not data.get("has_more"):
                break
            cursor = data.get("cursor")
            if not cursor:
                break
        return out


provider = TikTokProvider()

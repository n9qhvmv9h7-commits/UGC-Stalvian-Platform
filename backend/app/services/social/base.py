"""The shape every social provider implements.

Two providers will never justify a plugin registry, but they do justify a
shared vocabulary: the sync job, the callback and the gate all speak in terms
of these types rather than any one platform's JSON.

Three deliberate decisions in this interface:

  - `list_recent_media(since=...)` pushes the bounded-window rule INTO the
    interface, so no provider can accidentally page through years of history.
    Everything submittable or still earning is inside that window by
    construction, which turns "did pagination complete?" from a correctness
    question into a performance one.

  - `fetch_stats` is separate from `list_recent_media` because the cost
    profiles genuinely differ. TikTok returns view counts in the list response;
    Instagram needs a second call per media. Folding them together would make
    the interface lie about what a sync costs.

  - `SocialProviderError.retryable` is the difference between "this creator
    must reconnect" and "the network hiccuped". Conflating them means one blip
    tells every creator their account is broken.
"""
from dataclasses import dataclass, field
from datetime import datetime
from typing import Protocol


@dataclass
class TokenBundle:
    access_token: str
    refresh_token: str | None
    access_expires_at: datetime | None
    refresh_expires_at: datetime | None
    account_id: str
    account_handle: str | None = None
    # What was ACTUALLY granted, which is not what was asked for: TikTok's
    # consent screen has per-scope toggles, so a creator can approve login and
    # decline the video list. Storing that half-connection without noticing
    # means it silently never matches anything.
    scopes: list[str] = field(default_factory=list)


@dataclass
class RemoteVideo:
    """One video as the platform reports it.

    `canonical_key` is built with view_tracker.canonical_key() from the
    platform's own URL, so it is directly comparable to the key derived from
    what a creator pasted. That equality IS the ownership proof — if the two
    sides ever compute keys differently, nothing errors and ownership matching
    silently never fires.
    """

    canonical_key: str
    platform_media_id: str
    permalink: str
    published_at: datetime | None
    views: int | None = None
    title: str | None = None


class SocialProviderError(Exception):
    def __init__(self, message: str, *, retryable: bool):
        super().__init__(message)
        self.retryable = retryable


class SocialProvider(Protocol):
    name: str
    required_scopes: tuple[str, ...]

    def is_configured(self) -> bool: ...

    def authorize_url(self, state: str, code_challenge: str, redirect_uri: str) -> str: ...

    async def exchange_code(
        self, code: str, code_verifier: str, redirect_uri: str
    ) -> TokenBundle: ...

    async def refresh(self, refresh_token: str) -> TokenBundle: ...

    async def list_recent_media(
        self, access_token: str, since: datetime
    ) -> list[RemoteVideo]: ...

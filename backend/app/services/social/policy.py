"""Which platforms require a connected account, and whether a creator may submit.

One module answers this for all three consumers — the submit path, the
/api/social/connections endpoint the app builds its UI from, and the admin
view — so the gate and the 403 can never disagree about the rules.

The policy is served to the frontend rather than inlined at build time.
NEXT_PUBLIC_* values are baked into the Docker image (see frontend/src/lib/
app-mode.ts), so inlining would mean flipping a platform on required a backend
env change and a frontend rebuild in lockstep across two Render services, with
a window where the gate and the 403 disagree. The codebase already solved this
twice the same way: /api/earnings/formula and /api/feed/types.
"""
from app.config import settings
from app.services import crypto

# Platforms whose views can only be read through a creator's own authorised
# account. YouTube is absent deliberately: an app-level API key already reads
# its views without consent, so requiring OAuth there would add friction for no
# view-tracking benefit. (Ownership on YouTube is covered separately, by the
# channel comparison in view_tracker.channel_matches_handle.)
CONNECTABLE = ("tiktok", "instagram")

# Platforms capitalise themselves; .title() would write "Tiktok".
LABELS = {"tiktok": "TikTok", "instagram": "Instagram", "youtube": "YouTube", "x": "X"}


def label(platform: str) -> str:
    return LABELS.get(platform, platform.title())

_CREDENTIALS = {
    "tiktok": ("TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"),
    "instagram": ("INSTAGRAM_CLIENT_ID", "INSTAGRAM_CLIENT_SECRET"),
}


def connectable(platform: str) -> bool:
    """Whether a creator could actually complete a connection right now.

    Credentials AND token encryption, because both are required end to end:
    without a key we refuse to store the token, so the flow cannot finish. If
    these two answers ever diverge, a platform can be gated while the connect
    button is dead — the creator is blocked with no way to comply, which is the
    one outcome this module exists to prevent.
    """
    names = _CREDENTIALS.get(platform)
    if not names:
        return False
    if not all(getattr(settings, n, "") for n in names):
        return False
    return crypto.available()


def required_platforms() -> set[str]:
    """Platforms a creator must connect before submitting for them.

    ANDed with `connectable`, so a platform can never be gated while its
    credentials are missing — that would lock creators out of submitting with
    no way to comply. The failure direction is deliberate: open for the
    creator, closed for the misconfiguration.
    """
    configured = {
        p.strip().lower()
        for p in (settings.SOCIAL_CONNECT_REQUIRED or "").split(",")
        if p.strip()
    }
    return {p for p in configured if p in CONNECTABLE and connectable(p)}


def requires_connection(platform: str) -> bool:
    return platform in required_platforms()


def can_submit(platform: str, connected: set[str]) -> bool:
    """Per-platform, evaluated against the URL being submitted.

    Not "has the creator connected anything" — with YouTube open, a creator who
    has connected nothing can still legitimately submit a YouTube link, so a
    blanket gate would block a submission we intend to allow.
    """
    return not requires_connection(platform) or platform in connected


def blocked_reason(platform: str) -> str:
    name = label(platform)
    return (
        f"Connect your {name} account before submitting {name} videos — it's "
        "how we confirm the video is yours and read its views."
    )

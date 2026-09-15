"""Provider lookup. Two providers do not need more than a dict."""
from app.services.social.base import SocialProvider
from app.services.social.tiktok import provider as tiktok_provider

PROVIDERS: dict[str, SocialProvider] = {
    "tiktok": tiktok_provider,
}


def get(platform: str) -> SocialProvider | None:
    return PROVIDERS.get(platform)

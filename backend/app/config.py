"""Settings for the Stalvian UGC Creator Platform backend."""
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    ENVIRONMENT: str = "development"  # "production" on Render

    # Database — SQLite for local dev, Postgres in production (Render).
    DATABASE_URL: str = "sqlite+aiosqlite:///./ugc_platform.db"

    # Auth
    AUTH_SECRET: str = ""
    TOKEN_TTL_HOURS: int = 24 * 7  # creators stay logged in for a week

    # Stalvian Marketing Panel — the single source of all content/data.
    # Auth is a scoped X-API-Key on the /api/ugc/* surface (see
    # PANEL_INTEGRATION_CHANGES_FOR_UGC.md). Unset key -> mock panel mode.
    PANEL_API_URL: str = "http://localhost:8000"
    PANEL_API_KEY: str = ""
    # Shared HMAC secret for the panel's script.approved/script.retracted
    # webhooks (POST /api/webhooks/panel). Unset -> receiver returns 503.
    PANEL_WEBHOOK_SECRET: str = ""

    # Translation (content localization for creators). Haiku keeps this cheap.
    ANTHROPIC_API_KEY: str = ""
    TRANSLATION_MODEL: str = "claude-haiku-4-5-20251001"

    # View tracking
    YOUTUBE_API_KEY: str = ""

    # Payout formula (cents / views). See app/payout.py.
    PAYOUT_BASE_CENTS: int = 500
    PAYOUT_MIN_VIEWS: int = 1000
    PAYOUT_TIER1_CENTS_PER_K: int = 100
    PAYOUT_TIER1_MAX_K: int = 50
    PAYOUT_TIER2_CENTS_PER_K: int = 50
    PAYOUT_CAP_CENTS: int = 25000

    FRONTEND_URL: str = "http://localhost:3100"

    class Config:
        env_file = ".env"
        extra = "ignore"

    @property
    def async_database_url(self) -> str:
        url = self.DATABASE_URL
        if url.startswith("postgresql://"):
            url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
        return url


settings = Settings()

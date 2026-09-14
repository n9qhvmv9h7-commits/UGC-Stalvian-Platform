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
    # PANEL_INTEGRATION_CHANGES_FOR_UGC.md). An unset key is NOT a mock mode:
    # every panel call simply fails, and the app serves whatever it already
    # holds in panel_cache / stories.
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

    # Client referrals. Every creator has a referral code that new Stalvian
    # clients enter during onboarding; the creator then earns a share of every
    # fee those clients pay, for as long as they stay clients. The share is in
    # basis points (2500 = 25%). Changing it only affects fees recorded after
    # the change — each fee event stores the commission computed at the time.
    REFERRAL_COMMISSION_BPS: int = 2500
    # Static key the Stalvian product sends as X-API-Key when it validates a
    # code, attributes a new client, or reports a fee (see
    # REFERRAL_API_REQUIREMENTS.md). Unset -> those endpoints return 503; the
    # admin panel can still attribute clients and record fees by hand.
    REFERRAL_API_KEY: str = ""
    # Where a prospective client goes to sign up (shown next to the code on the
    # creator's earnings page). Optional.
    REFERRAL_SIGNUP_URL: str = ""

    # The two frontend origins. In production the creator app and the admin
    # panel are separate Render services with separate URLs; both must be
    # allowed through CORS. Locally one dev server on :3100 serves both, so
    # ADMIN_URL stays empty.
    FRONTEND_URL: str = "http://localhost:3100"
    ADMIN_URL: str = ""

    # First-admin bootstrap. There is no signup endpoint and creating a creator
    # requires an existing admin, so a fresh database has no way in. When these
    # are set and the database holds no admin yet, one is created on startup.
    # Safe to leave set (it no-ops once an admin exists); clear after first boot.
    BOOTSTRAP_ADMIN_EMAIL: str = ""
    BOOTSTRAP_ADMIN_PASSWORD: str = ""
    BOOTSTRAP_ADMIN_NAME: str = "Stalvian Admin"

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

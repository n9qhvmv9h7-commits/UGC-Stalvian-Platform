"""Database models for the Stalvian UGC Creator Platform."""
from datetime import datetime, timezone

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class Creator(Base):
    """A UGC creator account (self-service signup)."""

    __tablename__ = "creators"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    name: Mapped[str] = mapped_column(String(255))
    handle: Mapped[str | None] = mapped_column(String(64), nullable=True)  # @handle they post under
    # Application review: signups start pending until an admin approves them.
    # terminated = two deletion strikes ended the partnership.
    status: Mapped[str] = mapped_column(String(16), default="pending", index=True)  # pending | approved | rejected | terminated
    review_note: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # A strike per deleted-after-posting video; two strikes -> terminated.
    strikes: Mapped[int] = mapped_column(Integer, default=0)
    tiktok_handle: Mapped[str | None] = mapped_column(String(64), nullable=True)
    instagram_handle: Mapped[str | None] = mapped_column(String(64), nullable=True)
    youtube_handle: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # Which surface this creator works on. A video creator gets Album Stories +
    # Daily Scripts; a tweet creator gets the X equivalents. Set by an admin at
    # invite and changeable later; a creator only ever sees their own side.
    # Existing accounts default to "video", which is what they all are.
    account_type: Mapped[str] = mapped_column(String(8), default="video", index=True)  # video | tweets
    language: Mapped[str] = mapped_column(String(8), default="en")  # all content localized to this
    country: Mapped[str | None] = mapped_column(String(64), nullable=True)
    payout_method: Mapped[str | None] = mapped_column(String(16), nullable=True)  # iban | paypal
    payout_details: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    # The code new Stalvian clients enter during onboarding to credit this
    # creator (e.g. "POL-7K3M"). Generated on invite, backfilled on startup for
    # accounts that predate referrals.
    referral_code: Mapped[str | None] = mapped_column(String(16), unique=True, index=True, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_login: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Story(Base):
    """A piece of content served to creators.

    Two flavours share this table:
    - creator_id set  -> an Album Story generated on demand for that creator
    - creator_id null -> a shared feed item (breaking news / mover) synced from
      the Marketing Panel, identified by panel_ref
    """

    __tablename__ = "stories"
    __table_args__ = (UniqueConstraint("kind", "panel_ref", name="uq_story_panel_ref"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    creator_id: Mapped[int | None] = mapped_column(ForeignKey("creators.id"), nullable=True, index=True)
    # album_story | breaking | mover | hindsight | trending (video surface)
    # x_breaking | x_trending (X threads — payload carries `tweets`, not scenes)
    kind: Mapped[str] = mapped_column(String(16), index=True)
    panel_ref: Mapped[str | None] = mapped_column(String(64), nullable=True)  # panel script/post id
    album_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    album_kind: Mapped[str | None] = mapped_column(String(16), nullable=True)  # fund | politician
    angle: Mapped[str | None] = mapped_column(String(32), nullable=True)
    language: Mapped[str] = mapped_column(String(8), default="en")  # language of `payload`
    # active | retracted — the panel can retract an approved script (webhook
    # event / reconcile); retracted stories stay stored but are never served.
    status: Mapped[str] = mapped_column(String(16), default="active", index=True)
    payload: Mapped[dict] = mapped_column(JSON)  # title/hook/scenes/hashtags/cta/virality/sources…
    # The exact panel API response this story came from, untrimmed — we always
    # keep a local copy of everything served to creators.
    raw: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    translations: Mapped[dict] = mapped_column(JSON, default=dict)  # {lang: payload}
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class VideoSubmission(Base):
    """A link to a video the creator published, tracked for views and pay."""

    __tablename__ = "video_submissions"

    id: Mapped[int] = mapped_column(primary_key=True)
    creator_id: Mapped[int] = mapped_column(ForeignKey("creators.id"), index=True)
    story_id: Mapped[int | None] = mapped_column(ForeignKey("stories.id"), nullable=True)
    url: Mapped[str] = mapped_column(String(512), unique=True)
    # Canonical video identity (e.g. "youtube:<video-id>") so URL variants of the
    # same video can never be submitted (and paid) twice.
    canonical_key: Mapped[str] = mapped_column(String(255), unique=True)
    platform: Mapped[str] = mapped_column(String(16))  # tiktok | instagram | youtube | other
    title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # pending -> verified (counts toward pay) | rejected | removed (deleted
    # from the platform after posting -> a strike) | deleted (creator removed
    # the submission in-app -> soft delete, history kept)
    status: Mapped[str] = mapped_column(String(16), default="pending", index=True)
    views: Mapped[int] = mapped_column(Integer, default=0)
    views_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Whether the platform itself says this video belongs to this creator.
    # Deliberately separate from `status`: ownership is evidence, status is a
    # decision. unconfirmed = no evidence either way (the default, and the only
    # value for a platform we cannot ask). owned = the platform confirmed it.
    # foreign = the platform says it is someone else's — a flag for the admin
    # queue, NEVER an automatic rejection.
    ownership_state: Mapped[str] = mapped_column(String(16), default="unconfirmed")
    # What the platform reported, kept so an admin can see WHY it was flagged.
    ownership_note: Mapped[str | None] = mapped_column(String(255), nullable=True)
    review_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class SocialConnection(Base):
    """A creator's authorised link to one social platform.

    The point is ownership: a video that appears in the list the platform
    returns for THIS connection is provably the creator's, which is the
    judgement an admin currently makes by eye. View counts come along for free.

    Tokens are encrypted at rest (app/services/crypto.py) — they are other
    people's credentials, and the first real secrets this app holds. Instagram
    has no refresh token at all (its long-lived token refreshes itself), so
    refresh_token stays permanently NULL there by design, not by oversight.
    """

    __tablename__ = "social_connections"
    __table_args__ = (UniqueConstraint("creator_id", "platform", name="uq_social_connection"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    creator_id: Mapped[int] = mapped_column(ForeignKey("creators.id"), index=True)
    platform: Mapped[str] = mapped_column(String(16), index=True)  # tiktok | instagram
    # The platform's own stable id for the account — the thing ownership is
    # matched on. A handle can be changed by the creator; this cannot.
    platform_account_id: Mapped[str] = mapped_column(String(128))
    account_handle: Mapped[str | None] = mapped_column(String(128), nullable=True)
    # What was ACTUALLY granted. TikTok's consent screen has per-scope toggles,
    # so a creator can approve login and decline the video list — storing that
    # half-connection without noticing means it silently never matches anything.
    scopes: Mapped[str] = mapped_column(String(255), default="")
    access_token: Mapped[str] = mapped_column(Text)  # encrypted
    refresh_token: Mapped[str | None] = mapped_column(Text, nullable=True)  # encrypted
    access_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    refresh_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # active | needs_reauth | revoked. needs_reauth is set ONLY on a real auth
    # failure, never on a timeout — one network blip must not tell every
    # creator to reconnect.
    status: Mapped[str] = mapped_column(String(16), default="active", index=True)
    last_error: Mapped[str | None] = mapped_column(String(255), nullable=True)
    consecutive_failures: Mapped[int] = mapped_column(Integer, default=0)
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class OAuthState(Base):
    """One in-flight OAuth authorisation.

    The callback arrives from the platform as a top-level navigation with no
    Authorization header and no cookie for the API origin, so the request
    cannot identify the creator on its own — this row is what does. Minting it
    requires the creator's own session, which is what makes it CSRF-proof:
    an attacker cannot mint state bound to someone else.

    Single-use and short-lived; the sweep runs with the sync job.
    """

    __tablename__ = "oauth_states"

    id: Mapped[int] = mapped_column(primary_key=True)
    state: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    creator_id: Mapped[int] = mapped_column(ForeignKey("creators.id"), index=True)
    platform: Mapped[str] = mapped_column(String(16))
    code_verifier: Mapped[str] = mapped_column(String(128))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class PanelCache(Base):
    """Last-known copy of panel reference data (e.g. the albums catalog) so the
    UGC platform keeps serving even when the panel is unreachable."""

    __tablename__ = "panel_cache"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    payload: Mapped[dict] = mapped_column(JSON)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class FeedRead(Base):
    """How far a creator has read one Daily Scripts feed.

    Unread is "arrived since you last looked", so it compares against
    Story.created_at — when WE stored it, not when the panel published it.
    A backfilled story that is old but new to us still counts as unread.
    No row means the creator has never opened that feed: everything is unread.
    """

    __tablename__ = "feed_reads"
    __table_args__ = (UniqueConstraint("creator_id", "feed_key", name="uq_feed_read"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    creator_id: Mapped[int] = mapped_column(ForeignKey("creators.id"), index=True)
    feed_key: Mapped[str] = mapped_column(String(32))
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ViewSnapshot(Base):
    """Point-in-time view count of a video — the history behind the daily
    earnings chart. Written whenever a video's view count changes."""

    __tablename__ = "view_snapshots"

    id: Mapped[int] = mapped_column(primary_key=True)
    video_id: Mapped[int] = mapped_column(ForeignKey("video_submissions.id"), index=True)
    views: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class AuditLog(Base):
    """Every admin mutation, recorded atomically with the change itself —
    who approved which video, who recorded which payout, and what changed."""

    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    admin_id: Mapped[int] = mapped_column(ForeignKey("creators.id"), index=True)
    action: Mapped[str] = mapped_column(String(32), index=True)  # e.g. video.review
    entity: Mapped[str] = mapped_column(String(32))  # creator | video | payout
    entity_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    detail: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)


class Payout(Base):
    """A payment made (or queued) to a creator, recorded by Stalvian."""

    __tablename__ = "payouts"

    id: Mapped[int] = mapped_column(primary_key=True)
    creator_id: Mapped[int] = mapped_column(ForeignKey("creators.id"), index=True)
    amount_cents: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(16), default="paid")  # paid | pending
    note: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ReferredClient(Base):
    """A Stalvian client who entered a creator's referral code during
    onboarding. Identified by the product's own client id (external_ref) so
    the same client can never be attributed twice."""

    __tablename__ = "referred_clients"

    id: Mapped[int] = mapped_column(primary_key=True)
    creator_id: Mapped[int] = mapped_column(ForeignKey("creators.id"), index=True)
    external_ref: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    # Optional display label (e.g. a masked email "m***@gmail.com") — never
    # the client's full identity; creators only ever see this label.
    label: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # active | churned — churned clients stay listed (their past fees still
    # count) but are flagged so creators know the stream has stopped.
    status: Mapped[str] = mapped_column(String(16), default="active", index=True)
    source: Mapped[str] = mapped_column(String(16), default="api")  # api | admin
    attributed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class FeeEvent(Base):
    """A fee paid by a referred client, and the creator's share of it.

    commission_cents is computed when the row is written (at the rate in force
    then) so a later rate change never rewrites what a creator already earned.
    """

    __tablename__ = "fee_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    client_id: Mapped[int] = mapped_column(ForeignKey("referred_clients.id"), index=True)
    creator_id: Mapped[int] = mapped_column(ForeignKey("creators.id"), index=True)  # denormalized for sums
    # Idempotency key from the product (its own fee/transaction id). Unique
    # when set, so a retried delivery can never double-pay.
    external_ref: Mapped[str | None] = mapped_column(String(128), unique=True, nullable=True)
    fee_cents: Mapped[int] = mapped_column(Integer)
    commission_bps: Mapped[int] = mapped_column(Integer)
    commission_cents: Mapped[int] = mapped_column(Integer)
    currency: Mapped[str] = mapped_column(String(3), default="EUR")
    note: Mapped[str | None] = mapped_column(String(255), nullable=True)
    source: Mapped[str] = mapped_column(String(16), default="api")  # api | admin
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

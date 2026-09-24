import axios from "axios";

export const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8100";

const api = axios.create({ baseURL: API_URL });

const TOKEN_COOKIE = "ugc-token";

export function getToken(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(new RegExp(`(?:^|; )${TOKEN_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export function setToken(token: string) {
  const secure = typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${TOKEN_COOKIE}=${encodeURIComponent(token)}; path=/; max-age=${7 * 24 * 3600}; SameSite=Lax${secure}`;
}

export function clearToken() {
  document.cookie = `${TOKEN_COOKIE}=; path=/; max-age=0`;
}

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

/* A list endpoint must always hand back something with `items`.

   Axios only rejects on a non-2xx STATUS — a body it could parse still reaches
   `.data`, so an error shape like {detail: "..."} was flowing into components
   that did `data.items.length` and crashing the page with "Cannot read
   properties of undefined". Normalizing here means one guard covers every
   caller, instead of every caller needing its own. */
function asList<T>(data: unknown): { items: T[]; page: number; limit: number } {
  const body = (data ?? {}) as { items?: T[]; page?: number; limit?: number };
  return {
    items: Array.isArray(body.items) ? body.items : [],
    page: body.page ?? 1,
    limit: body.limit ?? 0,
  };
}

api.interceptors.response.use(
  (resp) => resp,
  (error) => {
    if (error.response?.status === 401 && typeof window !== "undefined") {
      const path = window.location.pathname;
      if (path !== "/login" && path !== "/") {
        clearToken();
        window.location.href = "/login";
      }
    }
    return Promise.reject(error);
  }
);

// ---------- Types ----------

/** A creator makes videos or tweets, never both. Set by an admin at invite. */
export type AccountType = "video" | "tweets";

export interface Creator {
  id: number;
  email: string;
  name: string;
  handle: string | null;
  status: "pending" | "approved" | "rejected" | "terminated";
  /** Which surface this creator works on — drives tabs and feeds. */
  account_type: AccountType;
  review_note: string | null;
  strikes: number;
  tiktok_handle: string | null;
  instagram_handle: string | null;
  youtube_handle: string | null;
  language: string;
  country: string | null;
  payout_method: string | null;
  payout_details: string | null;
  is_admin: boolean;
  /** The code new Stalvian clients enter during onboarding to credit this creator. */
  referral_code: string | null;
}

export interface Scene {
  narration?: string;
  visual?: string;
  overlay?: string;
  [key: string]: unknown;
}

export interface StoryPayload {
  id: number;
  kind: string;
  /** generating -> active | failed. Album stories are written in the
      background, so a fresh one arrives as `generating`. */
  status?: "generating" | "active" | "failed" | "retracted";
  /** Set when status is `failed`. */
  error?: string;
  album_name?: string | null;
  album_kind?: string | null;
  angle?: string | null;
  angle_label?: string | null;
  language: string;
  title?: string;
  hook?: string;
  script_body?: string;
  scenes?: Scene[];
  alternative_hooks?: string[];
  call_to_action?: string;
  hashtags?: string[];
  virality_score?: number;
  sources?: string[];
  // mover fields
  ticker?: string;
  headline?: string;
  company_name?: string;
  company_description?: string;
  summary?: string;
  caption?: string;
  person_label?: string;
  amount_str?: string;
  pct_change?: number;
  /** X threads (tweet accounts): the post as tweets, in order. A story with
      tweets has no scenes — it is posted, not shot. */
  tweets?: Tweet[];
  /** One entry per tweet: which card the panel draws under it. */
  media?: TweetMedia[];
  /** Breaking-news subtab (macro | stock | fda | gov) or "trending". */
  category?: string | null;
  category_label?: string | null;
  /** The stocks the thread is about (macro: three; single-company: one). */
  stocks?: ThreadStock[];
  /** The smart money already in these names (macro tweet 3). */
  buyers?: ThreadBuyer[];
  featured_buyer?: FeaturedBuyer | null;
  /** The company price chart, when the panel has one for this post. */
  chart?: ThreadChart | null;
  /** The last month of the same series (Album Trades movers, tweet 1). */
  chart_month?: ThreadChart | null;
  /** Hedge Fund Alerts. */
  filer_name?: string;
  holdings?: ThreadHolding[];
  top_buys?: RankedRow[];
  top_sells?: RankedRow[];
  /** Insider Picks: the insider's return since the buy. */
  insider_return_pct?: number | null;
  /** Top Movers: the article's domain for the card footer. */
  source_label?: string | null;
  /** Pictures this creator has attached, by tweet and slot. The bytes are
      fetched per tweet, only for the one on screen. */
  images?: { order: number; slot: number }[];
  published_at?: string | null;
  created_at?: string | null;
}

export interface Tweet {
  text: string;
  order: number;
}

export type TweetMediaKind =
  | "image"
  | "dual_image"
  | "logos"
  | "faces"
  | "chart"
  | "chart_entry"
  | "chart_month"
  | "chart_wide"
  | "holdings"
  | "list_buys"
  | "list_sells"
  | "square_chart"
  | "square_plain"
  | "none";

export interface TweetMedia {
  kind: TweetMediaKind;
  /** Upload prompt on the picture (or the picture half of a split card). */
  hint?: string;
  /** Replaces the company name on a chart card, and may carry newlines.
      The panel sets one per tweet where the card should say something other
      than the company's name. */
  heading?: string | null;
}

export interface ThreadStock {
  ticker: string;
  company_name: string;
  short_name: string;
  description: string;
  logo_url: string | null;
}

export interface ThreadBuyer {
  name: string;
  ticker: string;
  return_pct: number | null;
  detail: string;
  photo_url: string | null;
}

export interface FeaturedBuyer {
  name: string;
  kind: "politician" | "investor";
  return_pct: number | null;
  entry_date: string | null;
  amount: string | null;
  photo_url: string | null;
}

export interface ThreadChart {
  ticker: string;
  price: number;
  start_price: number;
  change_abs: number;
  change_pct: number;
  range_label: string;
  from_date: string | null;
  to_date: string | null;
  points: number[];
  /** Epoch ms per point, when the panel had them (month ticks on the square card). */
  times?: number[] | null;
  /** Index into `points` where the featured buyer bought, if known. */
  entry_index: number | null;
}

export interface ThreadHolding {
  issuer: string;
  class_type: string;
  value: number;
  shares: number | null;
}

export interface RankedRow {
  ticker: string;
  amount: string;
  icon_url: string | null;
}

export interface AlbumStats {
  name: string;
  slug?: string;
  total_return: string;
  cagr: string;
  alpha: string;
  sharpe: string;
  max_drawdown: string;
  party?: string | null;
  chamber?: string | null;
}

export interface AlbumsCatalog {
  funds: AlbumStats[];
  politicians: AlbumStats[];
  fund_angles: { key: string; label: string }[];
  politician_angles: { key: string; label: string }[];
}

export interface Video {
  id: number;
  url: string;
  platform: string;
  title: string | null;
  status: "pending" | "verified" | "rejected" | "removed";
  /** What the platform says about who posted it — evidence, not a verdict. */
  ownership_state: "unconfirmed" | "owned" | "foreign" | "disappeared";
  views: number;
  eligible_views: number;
  window_open: boolean;
  earning_until: string;
  views_updated_at: string | null;
  payout_cents: number;
  review_note: string | null;
  story_id: number | null;
  created_at: string | null;
}

export interface PayoutFormula {
  currency: string;
  /** Which curve this is: video views or X impressions. */
  kind: "video" | "x";
  window_days: number;
  /** A link must arrive within this many days of posting. */
  submit_within_days: number;
  min_views: number;
  base_cents: number;
  tier1_cents_per_1k: number;
  tier1_up_to_views: number;
  tier2_cents_per_1k: number;
  cap_cents: number;
  /** X only: a creator's first N verified posts earn this flat bonus. 0 otherwise. */
  first_posts: number;
  first_post_bonus_cents: number;
  /** X only: views pay is multiplied for posts submitted up to launch_until. */
  launch_multiplier: number;
  launch_until: string | null;
  launch_active: boolean;
  /** Share of every fee paid by referred clients, in basis points (2500 = 25%). */
  commission_bps: number;
  commission_pct: number;
  examples: { views: number; payout_cents: number }[];
}

export interface Earnings {
  /** views pay + referral commission — the one balance creators are paid on */
  earned_cents: number;
  /** Earned in the current calendar month. */
  month_earned_cents: number;
  /** This month's earnings not yet settled — balances are paid monthly. */
  pending_cents: number;
  views_earned_cents: number;
  commission_earned_cents: number;
  referral: {
    code: string | null;
    clients: number;
    active_clients: number;
    fees_cents: number;
    commission_cents: number;
  };
  paid_cents: number;
  balance_cents: number;
  total_views: number;
  verified_videos: number;
  pending_videos: number;
  payouts: {
    id: number;
    amount_cents: number;
    status: string;
    note: string | null;
    created_at: string | null;
  }[];
  formula: PayoutFormula;
}

// ---------- Auth ----------

export const login = (body: { email: string; password: string }) =>
  api.post<{ token: string; creator: Creator }>("/api/auth/login", body).then((r) => r.data);

export const fetchMe = () => api.get<Creator>("/api/auth/me").then((r) => r.data);

export interface ProfileUpdate {
  name?: string;
  handle?: string;
  tiktok_handle?: string;
  instagram_handle?: string;
  youtube_handle?: string;
  language?: string;
  country?: string;
  payout_method?: string;
  payout_details?: string;
  current_password?: string;
  new_password?: string;
}

export const updateMe = (body: ProfileUpdate) =>
  api.patch<Creator>("/api/auth/me", body).then((r) => r.data);

// ---------- Admin ----------

export interface CreatorApplication {
  id: number;
  name: string;
  email: string;
  account_type: AccountType;
  language: string;
  country: string | null;
  status: string;
  review_note: string | null;
  strikes: number;
  payout_method: string | null;
  payout_ready: boolean;
  socials: { platform: string; handle: string; url: string }[];
  referral_code: string | null;
  is_admin: boolean;
  created_at: string | null;
}

export interface AdminVideo {
  id: number;
  url: string;
  platform: string;
  title: string | null;
  story_id: number | null;
  status: string;
  review_note: string | null;
  ownership_state: "unconfirmed" | "owned" | "foreign" | "disappeared";
  ownership_note: string | null;
  views: number;
  eligible_views: number;
  earning_until: string;
  payout_cents: number;
  creator: { id: number; name: string; email: string; handle: string | null };
  created_at: string | null;
}

export interface AdminOverview {
  kpis: {
    views_gained: number;
    earned_cents: number;
    views_earned_cents: number;
    commission_cents: number;
    total_earned_cents: number;
    total_views_earned_cents: number;
    total_commission_cents: number;
    referred_clients: number;
    paid_cents: number;
    outstanding_cents: number;
    active_creators: number;
    pending_review: number;
  };
  daily: { date: string; views: number; views_cents: number; commission_cents: number; earned_cents: number }[];
  platforms: { platform: string; views: number; videos: number }[];
  statuses: { status: string; count: number }[];
  top_creators: {
    id: number;
    name: string;
    handle: string | null;
    views_gained: number;
    eligible_views: number;
    earned_cents: number;
    spark: number[];
  }[];
  top_videos: {
    id: number;
    url: string;
    platform: string;
    title: string | null;
    creator_name: string;
    views_gained: number;
    total_views: number;
    eligible_views: number;
    payout_cents: number;
  }[];
}

export interface CreatorMetrics {
  creator_id: number;
  videos: number;
  verified_videos: number;
  eligible_views: number;
  total_views: number;
  earned_cents: number;
  views_earned_cents: number;
  commission_cents: number;
  referred_clients: number;
  paid_cents: number;
  balance_cents: number;
  last_payout_at: string | null;
}

export interface AdminContent {
  albums: { album_name: string; album_kind: string; videos: number; eligible_views: number; earned_cents: number }[];
  kinds: { kind: string; videos: number; eligible_views: number }[];
  platforms: { platform: string; videos: number; eligible_views: number }[];
  top_stories: { story_id: number; title: string; kind: string; album_name: string | null; videos: number; eligible_views: number }[];
  unlinked: { videos: number; eligible_views: number };
}

export interface AdminPayoutBalance {
  creator_id: number;
  name: string;
  email: string;
  eligible_views: number;
  earned_cents: number;
  views_earned_cents: number;
  commission_cents: number;
  referred_clients: number;
  paid_cents: number;
  balance_cents: number;
  payout_method: string | null;
  payout_ready: boolean;
  last_payout_at: string | null;
}

export interface AdminPayoutsSummary {
  balances: AdminPayoutBalance[];
  history: { id: number; creator: { id: number; name: string }; amount_cents: number; note: string | null; created_at: string | null }[];
}

export interface AuditEntry {
  id: number;
  admin: { id: number; name: string };
  action: string;
  entity: string;
  entity_id: number | null;
  detail: Record<string, unknown>;
  created_at: string | null;
}

export const fetchAdminOverview = (days: number) =>
  api.get<AdminOverview>("/api/admin/overview", { params: { days } }).then((r) => r.data);

export const fetchAdminVideos = (status?: string) =>
  api
    .get<{ items: AdminVideo[] }>("/api/admin/videos", {
      params: status ? { status } : {},
    })
    .then((r) => r.data);

export const reviewVideo = (
  id: number,
  body: { status?: string; views?: number; review_note?: string }
) =>
  api
    .patch<{ status: string; strike: { strikes: number; creator_status: string } | null }>(
      `/api/admin/videos/${id}`,
      body
    )
    .then((r) => r.data);

export const fetchCreatorMetrics = () =>
  api.get<{ items: CreatorMetrics[] }>("/api/admin/creators/metrics").then((r) => r.data);

export const fetchAdminContent = () =>
  api.get<AdminContent>("/api/admin/content").then((r) => r.data);

export const fetchAdminPayouts = () =>
  api.get<AdminPayoutsSummary>("/api/admin/payouts").then((r) => r.data);

export const recordPayout = (body: { creator_id: number; amount_cents: number; note?: string }) =>
  api.post("/api/admin/payouts", body).then((r) => r.data);

export const fetchAuditLog = (page: number, limit = 50) =>
  api
    .get<{ items: AuditEntry[]; page: number; limit: number }>("/api/admin/audit", {
      params: { page, limit },
    })
    .then((r) => r.data);

export const createCreator = (body: {
  email: string;
  name?: string;
  language?: string;
  account_type?: AccountType;
}) =>
  api
    .post<{
      creator: {
        id: number;
        email: string;
        name: string;
        account_type: AccountType;
        referral_code: string | null;
      };
      password: string | null;
    }>(
      "/api/admin/creators",
      body
    )
    .then((r) => r.data);

export const fetchApplications = (status: string) =>
  api
    .get<{ items: CreatorApplication[] }>("/api/admin/creators", { params: { status } })
    .then((r) => r.data);

export const reviewCreator = (
  id: number,
  body: { status?: string; account_type?: AccountType; review_note?: string }
) =>
  api.patch(`/api/admin/creators/${id}`, body).then((r) => r.data);

// ---------- Stories ----------

export const fetchAlbums = () => api.get<AlbumsCatalog>("/api/stories/albums").then((r) => r.data);

export interface AlbumHistory {
  slug: string;
  range: string;
  points: { date: string; portfolio: number | null; spy: number | null }[];
}

export interface AlbumDetail {
  slug: string;
  returns?: { beta?: number | null } & Record<string, number | null>;
  holdings: { ticker: string; weight: number; last_price: number | null; is_stale?: boolean }[];
  holdings_as_of?: string | null;
  as_of?: string | null;
}

export const fetchAlbumHistory = (slug: string, range: "1y" | "all") =>
  api
    .get<AlbumHistory>(`/api/stories/albums/${slug}/history`, { params: { range } })
    .then((r) => r.data);

export const fetchAlbumDetail = (slug: string) =>
  api.get<AlbumDetail>(`/api/stories/albums/${slug}/detail`).then((r) => r.data);

/* Returns immediately with a `generating` story (HTTP 202) — the panel takes
   up to ~90s and no proxy in front of us will hold a request that long. Poll
   fetchStory(id) until status is `active` or `failed`. */
export const generateStory = (body: {
  album_kind: string;
  album_name: string;
  album_slug?: string;
  angle: string;
}) => api.post<StoryPayload>("/api/stories/generate", body).then((r) => r.data);

export const fetchStory = (id: number) =>
  api.get<StoryPayload>(`/api/stories/${id}`).then((r) => r.data);

export const fetchMyStories = () =>
  api.get("/api/stories/mine").then((r) => asList<StoryPayload>(r.data));

// ---------- Feeds ----------

export interface FeedPage {
  items: StoryPayload[];
  page: number;
  limit: number;
}

/** One Daily Scripts feed. The server owns the list (GET /api/feed/types), so
    a new feed reaches the app without a frontend release. */
export interface FeedCategory {
  key: string;
  label: string;
  count: number;
}

export interface FeedType {
  key: string;
  label: string;
  description: string;
  count: number;
  /** Stories stored since this creator last opened the feed. */
  unread: number;
  /** Sub-feeds to filter on (the panel's Breaking News subtabs). Empty when
      the feed has none. */
  categories: FeedCategory[];
}

export const fetchFeedTypes = () =>
  api.get<{ items: FeedType[] }>("/api/feed/types").then((r) => r.data.items);

export const markFeedSeen = (key: string) =>
  api.post(`/api/feed/${key}/seen`).then((r) => r.data);

export const fetchFeed = (key: string, page = 1, category?: string | null) =>
  api
    .get(`/api/feed/${key}`, { params: category ? { page, category } : { page } })
    .then((r) => asList<StoryPayload>(r.data));

// ---------- Thread images ----------
// The panel never sends its own imagery, so the picture on a tweet is the
// creator's. It comes back as a data URL because this API is reached with a
// Bearer token, which an <img src> cannot send.

export interface TweetImage {
  tweet_order: number;
  /** Which picture on the tweet: 0 is the tweet's own; composite cards use
      one slot per logo or face. */
  slot: number;
  size: number;
  data_url: string;
}

export const fetchTweetImages = (storyId: number, order: number) =>
  api
    .get<{ tweet_order: number; images: TweetImage[] }>(`/api/threads/${storyId}/tweets/${order}/image`)
    .then((r) => r.data.images);

export const uploadTweetImage = (storyId: number, order: number, file: File, slot = 0) => {
  const form = new FormData();
  form.append("file", file);
  return api
    .put<TweetImage>(`/api/threads/${storyId}/tweets/${order}/image`, form, {
      params: { slot },
      timeout: 60_000,
    })
    .then((r) => r.data);
};

export const deleteTweetImage = (storyId: number, order: number, slot = 0) =>
  api.delete(`/api/threads/${storyId}/tweets/${order}/image`, { params: { slot } }).then((r) => r.data);

// ---------- Connected social accounts ----------

export interface SocialPlatform {
  platform: string;
  label: string;
  /** Whether a connection is needed to submit for this platform right now. */
  requires_connection: boolean;
  /** Whether an OAuth flow can be started at all (credentials configured). */
  connectable: boolean;
  connected: boolean;
  status: "active" | "needs_reauth" | "revoked" | null;
  account_handle: string | null;
  last_synced_at: string | null;
  can_submit: boolean;
}

export interface SocialConnections {
  platforms: SocialPlatform[];
  /** Platforms the creator currently cannot submit for. */
  blocked_platforms: string[];
}

export const fetchSocialConnections = () =>
  api.get<SocialConnections>("/api/social/connections").then((r) => r.data);

/** Returns the platform's consent URL — the app navigates to it. A full
    navigation, not a popup: creators live in in-app browsers where window.open
    is unreliable. */
export const startSocialConnect = (platform: string) =>
  api
    .post<{ authorize_url: string }>(`/api/social/${platform}/authorize`)
    .then((r) => r.data.authorize_url);

export const disconnectSocial = (platform: string) =>
  api.delete(`/api/social/${platform}`).then((r) => r.data);

// ---------- Videos & earnings ----------

export const submitVideo = (body: { url: string; story_id?: number | null; title?: string }) =>
  api.post<Video>("/api/videos", body).then((r) => r.data);

export const fetchMyVideos = () => api.get("/api/videos").then((r) => asList<Video>(r.data));

export const deleteVideo = (id: number) => api.delete(`/api/videos/${id}`).then((r) => r.data);

export const fetchEarnings = () => api.get<Earnings>("/api/earnings").then((r) => r.data);

export interface DailyEarnings {
  days: { date: string; views_cents: number; commission_cents: number; earned_cents: number }[];
  views_cents: number;
  commission_cents: number;
  total_cents: number;
}

/* Either a trailing window (`days`) or an explicit inclusive range
   (`start`/`end`, YYYY-MM-DD). The date picker sends the latter. */
export const fetchDailyEarnings = (params: { days?: number; start?: string; end?: string }) =>
  api.get<DailyEarnings>("/api/earnings/daily", { params }).then((r) => r.data);

export const fetchFormula = () => api.get<PayoutFormula>("/api/earnings/formula").then((r) => r.data);

// ---------- Referrals ----------

export interface ReferredClient {
  id: number;
  /** Masked label (e.g. "m***@gmail.com") — never the client's identity. */
  label: string;
  status: "active" | "churned";
  attributed_at: string | null;
  fees_cents: number;
  commission_cents: number;
  last_fee_at: string | null;
  /** Null until their first trade — the commission clock starts there. */
  first_fee_at: string | null;
  earning_until: string | null;
  window_open: boolean;
}

export interface MyReferrals {
  code: string;
  commission_bps: number;
  commission_pct: number;
  /** How long a client earns, counted from their first trade. */
  commission_days: number;
  signup_url: string | null;
  fees_cents: number;
  commission_cents: number;
  clients: ReferredClient[];
  active_clients: number;
}

export const fetchMyReferrals = () =>
  api.get<MyReferrals>("/api/referrals/me").then((r) => r.data);

export interface AdminReferrals {
  commission_bps: number;
  commission_pct: number;
  signup_url: string | null;
  totals: { clients: number; active_clients: number; fees_cents: number; commission_cents: number };
  creators: {
    creator_id: number;
    name: string;
    email: string;
    status: string;
    code: string | null;
    fees_cents: number;
    commission_cents: number;
    clients: number;
    active_clients: number;
  }[];
  clients: {
    id: number;
    creator_id: number;
    creator_name: string;
    client_ref: string;
    label: string | null;
    status: "active" | "churned";
    source: "api" | "admin";
    attributed_at: string | null;
  }[];
  recent_fees: {
    id: number;
    creator: { id: number; name: string };
    client: { id: number; client_ref: string; label: string | null };
    fee_cents: number;
    commission_cents: number;
    commission_bps: number;
    currency: string;
    source: "api" | "admin";
    note: string | null;
    occurred_at: string | null;
  }[];
}

export const fetchAdminReferrals = () =>
  api.get<AdminReferrals>("/api/admin/referrals").then((r) => r.data);

export const adminAttributeClient = (body: {
  creator_id: number;
  client_ref: string;
  label?: string;
  attributed_at?: string;
}) => api.post<{ created: boolean; client_id: number }>("/api/admin/referrals/clients", body).then((r) => r.data);

export const adminRecordFee = (body: {
  client_id: number;
  fee_cents: number;
  occurred_at?: string;
  note?: string;
}) =>
  api
    .post<{ fee_id: number; fee_cents: number; commission_cents: number }>("/api/admin/referrals/fees", body)
    .then((r) => r.data);

export const adminSetClientStatus = (id: number, status: "active" | "churned") =>
  api.patch(`/api/admin/referrals/clients/${id}`, { status }).then((r) => r.data);

export const adminRegenerateCode = (creatorId: number) =>
  api.post<{ code: string }>(`/api/admin/referrals/creators/${creatorId}/code`).then((r) => r.data);

export default api;

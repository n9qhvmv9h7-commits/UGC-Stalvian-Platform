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

export interface Creator {
  id: number;
  email: string;
  name: string;
  handle: string | null;
  status: "pending" | "approved" | "rejected" | "terminated";
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
  published_at?: string | null;
  created_at?: string | null;
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
  window_days: number;
  /** A link must arrive within this many days of posting. */
  submit_within_days: number;
  min_views: number;
  base_cents: number;
  tier1_cents_per_1k: number;
  tier1_up_to_views: number;
  tier2_cents_per_1k: number;
  cap_cents: number;
  /** Share of every fee paid by referred clients, in basis points (2500 = 25%). */
  commission_bps: number;
  commission_pct: number;
  examples: { views: number; payout_cents: number }[];
}

export interface Earnings {
  /** views pay + referral commission — the one balance creators are paid on */
  earned_cents: number;
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

export const createCreator = (body: { email: string; name?: string; language?: string }) =>
  api
    .post<{
      creator: { id: number; email: string; name: string; referral_code: string | null };
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

export const reviewCreator = (id: number, body: { status: string; review_note?: string }) =>
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
  api.get<{ items: StoryPayload[] }>("/api/stories/mine").then((r) => r.data);

// ---------- Feeds ----------

export interface FeedPage {
  items: StoryPayload[];
  page: number;
  limit: number;
}

/** One Daily Scripts feed. The server owns the list (GET /api/feed/types), so
    a new feed reaches the app without a frontend release. */
export interface FeedType {
  key: string;
  label: string;
  description: string;
  count: number;
  /** Stories stored since this creator last opened the feed. */
  unread: number;
}

export const fetchFeedTypes = () =>
  api.get<{ items: FeedType[] }>("/api/feed/types").then((r) => r.data.items);

export const markFeedSeen = (key: string) =>
  api.post(`/api/feed/${key}/seen`).then((r) => r.data);

export const fetchFeed = (key: string, page = 1) =>
  api.get<FeedPage>(`/api/feed/${key}`, { params: { page } }).then((r) => r.data);

export const refreshFeeds = () => api.post("/api/feed/refresh", {}, { timeout: 120_000 }).then((r) => r.data);

// ---------- Videos & earnings ----------

export const submitVideo = (body: { url: string; story_id?: number | null; title?: string }) =>
  api.post<Video>("/api/videos", body).then((r) => r.data);

export const fetchMyVideos = () => api.get<{ items: Video[] }>("/api/videos").then((r) => r.data);

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

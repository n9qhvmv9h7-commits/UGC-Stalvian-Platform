/* The two creator surfaces.

   A creator makes videos or tweets, never both, and only ever sees their own
   side of the app. Everything that differs between the two — which pages
   exist, where the daily feed lives, what the dashboard calls things — is
   decided here, from the account type the profile reports, so no page has to
   carry its own "if tweets" logic for navigation. */

import type { AccountType } from "@/lib/api";

export interface NavLink {
  href: string;
  label: string;
  icon: string;
}

export interface Surface {
  type: AccountType;
  links: NavLink[];
  /** The daily feed page — the one link the sidebar badges with unread counts. */
  feedPath: string;
  /** What a piece of content is called on this surface. */
  noun: "scripts" | "threads";
}

export const SURFACES: Record<AccountType, Surface> = {
  video: {
    type: "video",
    links: [
      { href: "/dashboard", label: "Dashboard", icon: "ph-squares-four" },
      { href: "/albums", label: "Albums", icon: "ph-stack" },
      { href: "/album-stories", label: "Album Stories", icon: "ph-vinyl-record" },
      { href: "/daily-scripts", label: "Daily Scripts", icon: "ph-lightning" },
      { href: "/my-videos", label: "My Videos", icon: "ph-video-camera" },
      { href: "/earnings", label: "Earnings", icon: "ph-currency-eur" },
    ],
    feedPath: "/daily-scripts",
    noun: "scripts",
  },
  tweets: {
    type: "tweets",
    links: [
      { href: "/dashboard", label: "Dashboard", icon: "ph-squares-four" },
      { href: "/albums", label: "Albums", icon: "ph-stack" },
      { href: "/daily-threads", label: "Daily Threads", icon: "ph-x-logo" },
      { href: "/my-posts", label: "My Posts", icon: "ph-paper-plane-tilt" },
      { href: "/earnings", label: "Earnings", icon: "ph-currency-eur" },
    ],
    feedPath: "/daily-threads",
    noun: "threads",
  },
};

/** Resolve a profile to its surface. Anything unrecognised is the video
    surface, which is what every account was before types existed. */
export function surfaceOf(me: { account_type?: AccountType } | null | undefined): Surface {
  return SURFACES[me?.account_type === "tweets" ? "tweets" : "video"];
}

function matches(prefix: string, pathname: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** True when `pathname` is a page of another surface and not of `surface`:
    a tweet creator typing /my-videos, a video creator typing /daily-threads.
    Pages no surface claims (settings, unknown routes) are never foreign. */
export function isForeignPath(surface: Surface, pathname: string): boolean {
  const mine = surface.links.some((l) => matches(l.href, pathname));
  if (mine) return false;
  return Object.values(SURFACES).some(
    (other) => other.type !== surface.type && other.links.some((l) => matches(l.href, pathname))
  );
}

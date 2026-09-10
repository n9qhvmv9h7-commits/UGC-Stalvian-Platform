/* One codebase, two deployments.

   In production the creator app and the admin panel are separate Render
   services built from this same repo, each with its own URL. They are told
   apart by NEXT_PUBLIC_APP_MODE, which Render passes as a Docker build arg —
   so the value is inlined at BUILD time and each service ships a bundle that
   serves only its own surface. Locally one dev server serves both, which is
   the default "all".

   Enforcement lives in middleware.ts; this module is just the shared vocabulary. */

export type AppMode = "creator" | "admin" | "all";

export const APP_MODE = (process.env.NEXT_PUBLIC_APP_MODE || "all") as AppMode;

/** Landing route for this build — where login and stray requests end up. */
export const HOME_PATH = APP_MODE === "admin" ? "/admin" : "/dashboard";

export function isAdminPath(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

function crossAppHref(configured: string | undefined, sameHostFallback: string): string {
  const url = configured?.trim().replace(/\/+$/, "");
  return url || sameHostFallback;
}

/* The one link that crosses from one app to the other: the admin panel points
   back at the creator app. There is deliberately no link the other way — the
   creator app never advertises the admin panel, not even to an admin.

   When the creator app is deployed separately this is an absolute URL on a
   different origin; when one host serves everything (local dev) it stays a
   relative path. Render it with a plain <a>, never next/link — a full page
   load is right in both cases, and client-side navigation cannot cross an
   origin anyway. */
export const CREATOR_HREF = crossAppHref(process.env.NEXT_PUBLIC_CREATOR_URL, "/dashboard");

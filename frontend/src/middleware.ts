import { NextRequest, NextResponse } from "next/server";
import { APP_MODE, HOME_PATH, isAdminPath } from "@/lib/app-mode";

const PUBLIC_PATHS = ["/", "/login"];

/* Soft guard (the API enforces real auth) — but at least honor the JWT's exp
   so an expired cookie doesn't bounce users through a doomed /dashboard load. */
function tokenLooksValid(token: string | undefined): boolean {
  if (!token) return false;
  try {
    const payload = JSON.parse(
      atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))
    );
    return typeof payload.exp !== "number" || payload.exp * 1000 > Date.now();
  } catch {
    return false;
  }
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  /* Surface gating: a build serves either the creator app or the admin panel,
     never both. This runs in EVERY environment — the mode is a property of the
     build, not of the deploy — so `next start` locally behaves exactly like
     the Render service it was built for. The auth guard below stays
     production-only, keeping local dev (and DEV_AUTOLOGIN) as it was. */
  if (APP_MODE === "creator" && isAdminPath(pathname)) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }
  if (APP_MODE === "admin" && !isAdminPath(pathname) && pathname !== "/login") {
    // Covers "/" too, which is the Render health check path: a 3xx counts as
    // healthy, so the admin service passes its check on the redirect.
    return NextResponse.redirect(new URL("/admin", request.url));
  }

  if (process.env.NODE_ENV !== "production") return NextResponse.next();

  const authed = tokenLooksValid(request.cookies.get("ugc-token")?.value);
  const isPublic = PUBLIC_PATHS.includes(pathname);

  if (!authed && !isPublic) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  if (authed && pathname === "/login") {
    return NextResponse.redirect(new URL(HOME_PATH, request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|manifest.webmanifest|icon|apple-icon|assets|fonts).*)",
  ],
};

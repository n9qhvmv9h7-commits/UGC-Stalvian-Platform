import { NextRequest, NextResponse } from "next/server";

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
  if (process.env.NODE_ENV !== "production") return NextResponse.next();

  const authed = tokenLooksValid(request.cookies.get("ugc-token")?.value);
  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.includes(pathname);

  if (!authed && !isPublic) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  if (authed && pathname === "/login") {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|manifest.webmanifest|icon|apple-icon|assets|fonts).*)",
  ],
};

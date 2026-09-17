"use client";

/* App navigation — ink left sidebar (desktop) + compact top bar with tabs (mobile). */

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { UnreadDot } from "@/components/ui";
import { clearToken, fetchFeedTypes, fetchMe, getToken } from "@/lib/api";
import { surfaceOf } from "@/lib/surface";

/* Total unread across every daily feed. Same query key the page uses,
   so opening a feed updates the sidebar without a second request. */
function useUnreadScripts(): number {
  const { data } = useQuery({
    queryKey: ["feed-types"],
    queryFn: fetchFeedTypes,
    enabled: !!getToken(),
  });
  return (data ?? []).reduce((total, t) => total + t.unread, 0);
}

/* The links are the creator's surface, not a constant: a video creator gets
   the video pages, a tweet creator the X ones. AccountGate has already
   loaded ["me"] before any of this renders, so the list never flickers from
   one surface to the other. */
function useSurface() {
  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
    enabled: !!getToken(),
  });
  return { me, surface: surfaceOf(me) };
}

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { me, surface } = useSurface();
  const unread = useUnreadScripts();

  const logout = () => {
    clearToken();
    queryClient.clear();
    router.push("/login");
  };

  return (
    <aside className="sticky top-0 hidden h-screen w-[260px] shrink-0 flex-col bg-ink px-5 py-8 lg:flex">
      <Link href="/dashboard" className="flex items-center px-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/assets/stalvian-logo.svg" alt="Stalvian" className="h-6" />
        <span className="ml-3 rounded-[4px] bg-white/10 px-2 py-0.5 text-[11px] font-medium leading-4 text-white">
          Creators
        </span>
      </Link>

      <nav className="mt-10 flex flex-1 flex-col gap-1">
        {surface.links.map((link) => {
          const active = pathname.startsWith(link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`flex items-center gap-3 rounded-[8px] px-3 py-2.5 text-[15px] font-medium leading-6 transition-colors ${
                active ? "bg-white/10 text-white" : "text-white/60 hover:text-white"
              }`}
            >
              <i className={`ph ${link.icon} text-[20px]`} />
              {link.label}
              {link.href === surface.feedPath && (
                <span className="ml-auto">
                  <UnreadDot count={unread} onDark />
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="flex flex-col gap-1 border-t border-ink-500 pt-4">
        <Link
          href="/settings"
          className={`flex items-center gap-3 rounded-[8px] px-3 py-2.5 text-[15px] font-medium leading-6 transition-colors ${
            pathname.startsWith("/settings") ? "bg-white/10 text-white" : "text-white/60 hover:text-white"
          }`}
        >
          <i className="ph ph-gear text-[20px]" />
          Settings
          {me && (
            <span className="ml-auto rounded-[4px] bg-white/10 px-1.5 py-0.5 text-[11px] leading-4 text-white/70">
              {me.language.toUpperCase()}
            </span>
          )}
        </Link>
        <button
          onClick={logout}
          className="flex cursor-pointer items-center gap-3 rounded-[8px] px-3 py-2.5 text-left text-[15px] font-medium leading-6 text-white/60 transition-colors hover:text-white"
        >
          <i className="ph ph-sign-out text-[20px]" />
          Log Out
        </button>
        {me && (
          <div className="mt-3 flex items-center gap-3 px-3">
            <i className="ph ph-user-circle text-[22px] text-white/40" />
            <div className="min-w-0">
              <div className="truncate text-[13px] font-medium leading-4 text-white">{me.name}</div>
              {me.handle && (
                <div className="truncate text-[12px] leading-4 text-white/50">@{me.handle}</div>
              )}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

export function MobileNav() {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { surface } = useSurface();
  const unread = useUnreadScripts();

  return (
    <div className="lg:hidden">
      <div className="flex h-16 items-center justify-between bg-ink px-4">
        <Link href="/dashboard" className="flex items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/assets/stalvian-logo.svg" alt="Stalvian" className="h-5" />
          <span className="ml-2 rounded-[4px] bg-white/10 px-1.5 py-0.5 text-[10px] font-medium leading-4 text-white">
            Creators
          </span>
        </Link>
        <div className="flex items-center gap-4">
          <Link href="/settings" className="text-white/70 hover:text-white" aria-label="Settings">
            <i className="ph ph-gear text-[20px]" />
          </Link>
          <button
            onClick={() => {
              clearToken();
              queryClient.clear();
              router.push("/login");
            }}
            className="cursor-pointer text-white/70 hover:text-white"
            aria-label="Log out"
          >
            <i className="ph ph-sign-out text-[20px]" />
          </button>
        </div>
      </div>
      <div className="flex gap-1 overflow-x-auto border-b border-bone-200 bg-white px-4 py-2">
        {surface.links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className={`flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-2 text-[13px] font-medium ${
              pathname.startsWith(link.href) ? "bg-ink text-white" : "text-slate-500"
            }`}
          >
            {link.label}
            {link.href === surface.feedPath && <UnreadDot count={unread} />}
          </Link>
        ))}
      </div>
    </div>
  );
}

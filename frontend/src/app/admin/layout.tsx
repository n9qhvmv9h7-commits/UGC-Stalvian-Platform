"use client";

/* Admin shell — a separate internal platform, not a tab of the creator app.
   Own sidebar (admin sections only), own identity, no creator navigation.
   The gate here is UX only; every /api/admin endpoint enforces is_admin. */

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { clearToken, fetchMe, getToken } from "@/lib/api";
import { AccountGate } from "@/components/account-gate";
import { Button, EmptyState } from "@/components/ui";

const SECTIONS = [
  { href: "/admin", label: "Overview", icon: "ph-gauge" },
  { href: "/admin/creators", label: "Creators", icon: "ph-users-three" },
  { href: "/admin/videos", label: "Video Review", icon: "ph-video-camera" },
  { href: "/admin/content", label: "Content", icon: "ph-film-slate" },
  { href: "/admin/payouts", label: "Payouts", icon: "ph-currency-eur" },
  { href: "/admin/audit", label: "Audit Trail", icon: "ph-scroll" },
];

function isActive(pathname: string, href: string): boolean {
  return href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);
}

function AdminSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: fetchMe, enabled: !!getToken() });

  const logout = () => {
    clearToken();
    queryClient.clear();
    router.push("/login");
  };

  return (
    <aside className="sticky top-0 hidden h-screen w-[260px] shrink-0 flex-col bg-ink px-5 py-8 lg:flex">
      <Link href="/admin" className="flex items-center px-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/assets/stalvian-logo.svg" alt="Stalvian" className="h-6" />
        <span className="ml-3 rounded-[4px] bg-gold px-2 py-0.5 text-[11px] font-bold leading-4 text-ink">
          Admin
        </span>
      </Link>

      <nav className="mt-10 flex flex-1 flex-col gap-1">
        {SECTIONS.map((section) => (
          <Link
            key={section.href}
            href={section.href}
            className={`flex items-center gap-3 rounded-[8px] px-3 py-2.5 text-[15px] font-medium leading-6 transition-colors ${
              isActive(pathname, section.href)
                ? "bg-white/10 text-white"
                : "text-white/60 hover:text-white"
            }`}
          >
            <i className={`ph ${section.icon} text-[20px]`} />
            {section.label}
          </Link>
        ))}
      </nav>

      <div className="flex flex-col gap-1 border-t border-ink-500 pt-4">
        <Link
          href="/dashboard"
          className="flex items-center gap-3 rounded-[8px] px-3 py-2.5 text-[15px] font-medium leading-6 text-white/60 transition-colors hover:text-white"
        >
          <i className="ph ph-arrow-u-up-left text-[20px]" />
          Creator App
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
            <i className="ph ph-shield-check text-[22px] text-gold" />
            <div className="min-w-0">
              <div className="truncate text-[13px] font-medium leading-4 text-white">{me.name}</div>
              <div className="truncate text-[12px] leading-4 text-white/50">{me.email}</div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

function AdminMobileNav() {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();

  return (
    <div className="lg:hidden">
      <div className="flex h-16 items-center justify-between bg-ink px-4">
        <Link href="/admin" className="flex items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/assets/stalvian-logo.svg" alt="Stalvian" className="h-5" />
          <span className="ml-2 rounded-[4px] bg-gold px-1.5 py-0.5 text-[10px] font-bold leading-4 text-ink">
            Admin
          </span>
        </Link>
        <div className="flex items-center gap-4">
          <Link href="/dashboard" className="text-white/70 hover:text-white" aria-label="Creator app">
            <i className="ph ph-arrow-u-up-left text-[20px]" />
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
        {SECTIONS.map((section) => (
          <Link
            key={section.href}
            href={section.href}
            className={`whitespace-nowrap rounded-full px-4 py-2 text-[13px] font-medium ${
              isActive(pathname, section.href) ? "bg-ink text-white" : "text-slate-500"
            }`}
          >
            {section.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { data: me } = useQuery({ queryKey: ["me"], queryFn: fetchMe, enabled: !!getToken() });

  return (
    <AccountGate>
      {me && !me.is_admin ? (
        <div className="flex min-h-screen flex-col items-center justify-center bg-white px-6">
          <div className="w-full max-w-[520px]">
            <EmptyState
              icon="ph-lock"
              title="Admin only"
              body="This is the Stalvian internal platform. Your account doesn't have access."
              action={
                <Link href="/dashboard">
                  <Button kind="secondary" size="m">
                    Back to the Creator App
                  </Button>
                </Link>
              }
            />
          </div>
        </div>
      ) : (
        <div className="flex min-h-screen bg-white">
          <AdminSidebar />
          <div className="flex min-w-0 flex-1 flex-col">
            <AdminMobileNav />
            <main className="mx-auto w-full max-w-[1200px] flex-1 px-6 py-10 lg:px-12 lg:py-12">
              {children}
            </main>
            <footer className="border-t border-bone-200 px-6 py-6 lg:px-12">
              <p className="mx-auto max-w-[1200px] text-[12px] leading-4 text-slate-400">
                Stalvian internal — creator program operations. Not visible to creators.
              </p>
            </footer>
          </div>
        </div>
      )}
    </AccountGate>
  );
}

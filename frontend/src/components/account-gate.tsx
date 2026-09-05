"use client";

/* Blocks the app for creators whose application hasn't been approved yet.
   Admins and approved creators pass straight through. */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { clearToken, fetchMe, getToken, login, setToken, type Creator } from "@/lib/api";
import { Button, Spinner } from "@/components/ui";

// Dev-only, opt-in: with NEXT_PUBLIC_DEV_AUTOLOGIN=1 in .env.local, opening
// any app page without a session signs in as the seeded demo creator. Off by
// default so the app asks for a login like production would.
const DEV_AUTOLOGIN =
  process.env.NODE_ENV === "development" &&
  process.env.NEXT_PUBLIC_DEV_AUTOLOGIN === "1"
    ? { email: "demo@stalvian.com", password: "stalvian-demo" }
    : null;

// Module-level so StrictMode's double-effect shares one login request.
let devLoginInFlight: Promise<void> | null = null;

function StatusScreen({
  me,
  icon,
  title,
  children,
}: {
  me: Creator;
  icon: string;
  title: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const logout = () => {
    clearToken();
    queryClient.clear();
    router.push("/login");
  };

  const socials = [
    { label: "TikTok", handle: me.tiktok_handle },
    { label: "Instagram", handle: me.instagram_handle },
    { label: "YouTube", handle: me.youtube_handle },
  ].filter((s) => s.handle);

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <div className="flex h-16 items-center justify-between border-b border-bone-200 px-6">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/assets/stalvian-logo.svg" alt="Stalvian" className="h-5 invert" />
        <button
          onClick={logout}
          className="cursor-pointer text-[15px] font-medium leading-6 text-slate-500 hover:text-ink"
        >
          Log Out
        </button>
      </div>
      <div className="flex flex-1 items-center justify-center px-6">
        <div className="dashed-card flex w-full max-w-[520px] flex-col items-center gap-5 px-10 py-16 text-center">
          <i className={`ph ${icon} text-[44px] text-slate-400`} />
          <h1 className="display-md text-ink">{title}</h1>
          {children}
          {socials.length > 0 && (
            <div className="flex flex-wrap justify-center gap-2">
              {socials.map((s) => (
                <span
                  key={s.label}
                  className="rounded-full bg-bone-100 px-3 py-1 text-[13px] leading-5 text-slate-500"
                >
                  {s.label} · @{s.handle}
                </span>
              ))}
            </div>
          )}
          <Button kind="secondary" size="m" onClick={logout}>
            Log Out
          </Button>
        </div>
      </div>
    </div>
  );
}

export function AccountGate({ children }: { children: React.ReactNode }) {
  // Token lives in a cookie the server render can't see — resolve after mount
  // so SSR and the first client render agree.
  const [mounted, setMounted] = useState(false);
  const [, bump] = useState(0);
  useEffect(() => setMounted(true), []);
  const hasToken = mounted && !!getToken();
  const queryClient = useQueryClient();
  const router = useRouter();

  // Children must never render token-less while auto-login is owed: their
  // queries would 401 and the axios interceptor bounces to /login.
  const needsAutoLogin = mounted && !hasToken && !!DEV_AUTOLOGIN;

  useEffect(() => {
    if (!needsAutoLogin || !DEV_AUTOLOGIN) return;
    devLoginInFlight ??= login(DEV_AUTOLOGIN).then((result) => setToken(result.token));
    devLoginInFlight
      .then(() => {
        devLoginInFlight = null;
        queryClient.clear();
        bump((n) => n + 1); // re-render now that the cookie is set
      })
      .catch(() => {
        devLoginInFlight = null;
        router.push("/login");
      });
  }, [needsAutoLogin, queryClient, router]);

  const { data: me, isLoading, isError, refetch } = useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
    enabled: hasToken,
  });

  if (!mounted || needsAutoLogin || (hasToken && isLoading)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <Spinner label="Loading…" />
      </div>
    );
  }

  // Backend unreachable / 5xx (401s are handled by the axios interceptor) —
  // without this, pages would render with every query failing silently.
  if (hasToken && isError && !me) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-5 bg-white px-6">
        <i className="ph ph-plugs text-[44px] text-slate-400" />
        <p className="max-w-[380px] text-center text-[16px] leading-6 text-slate-500">
          Can&apos;t reach the Stalvian server right now. Check your connection and try
          again.
        </p>
        <Button kind="secondary" size="m" onClick={() => refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  if (me && !me.is_admin && me.status === "pending") {
    return (
      <StatusScreen me={me} icon="ph-hourglass-medium" title="Application under review">
        <p className="max-w-[400px] text-[16px] leading-6 text-slate-500">
          Thanks for applying, {me.name.split(" ")[0]}. We&apos;re checking out your
          profiles — you&apos;ll get access to scripts and the creator program as soon as
          we approve your application, usually within a day or two.
        </p>
      </StatusScreen>
    );
  }

  if (me && !me.is_admin && me.status === "terminated") {
    return (
      <StatusScreen me={me} icon="ph-hand-palm" title="Partnership ended">
        <p className="max-w-[400px] text-[16px] leading-6 text-slate-500">
          {me.review_note ||
            "Two posted videos were deleted, which ends the creator partnership per the program rules."}{" "}
          Earnings already verified will still be paid out. If you believe this is a
          mistake, contact the Stalvian team.
        </p>
      </StatusScreen>
    );
  }

  if (me && !me.is_admin && me.status === "rejected") {
    return (
      <StatusScreen me={me} icon="ph-prohibit" title="Application not accepted">
        <p className="max-w-[400px] text-[16px] leading-6 text-slate-500">
          {me.review_note ||
            "Unfortunately your application wasn't accepted this time. You're welcome to reach out once your channels have grown."}
        </p>
      </StatusScreen>
    );
  }

  return <>{children}</>;
}

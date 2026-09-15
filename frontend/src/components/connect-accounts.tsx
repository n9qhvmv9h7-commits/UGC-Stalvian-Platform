"use client";

/* Connected accounts — the panel in Settings, and the prompt on My Videos.

   Which platforms are connectable, and which are required, comes from the
   server (GET /api/social/connections). The app never hardcodes that list:
   it changes when a flag flips, and a frontend rebuild must not be needed to
   keep up. */

import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  disconnectSocial,
  fetchSocialConnections,
  startSocialConnect,
  type SocialPlatform,
} from "@/lib/api";
import { Badge, Button } from "@/components/ui";

const ICONS: Record<string, string> = {
  tiktok: "ph-tiktok-logo",
  instagram: "ph-instagram-logo",
  youtube: "ph-youtube-logo",
};

export function useSocialConnections() {
  return useQuery({ queryKey: ["social-connections"], queryFn: fetchSocialConnections });
}

function PlatformRow({ platform }: { platform: SocialPlatform }) {
  const queryClient = useQueryClient();
  const connect = useMutation({
    mutationFn: () => startSocialConnect(platform.platform),
    // Full-page navigation to the platform's consent screen. The callback
    // lands on the API and redirects back to /settings with ?connected=.
    onSuccess: (url) => {
      window.location.href = url;
    },
    onError: (err: unknown) => {
      const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail;
      toast.error(typeof detail === "string" ? detail : "Could not start the connection");
    },
  });

  const disconnect = useMutation({
    mutationFn: () => disconnectSocial(platform.platform),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["social-connections"] });
      toast.success(`${platform.label} disconnected`);
    },
    onError: () => toast.error("Could not disconnect — try again"),
  });

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-t border-bone-200 py-4">
      <div className="flex items-center gap-3">
        <i className={`ph ${ICONS[platform.platform] ?? "ph-link"} text-[22px] text-slate-500`} />
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className="text-[15px] font-medium leading-5 text-ink">{platform.label}</span>
            {platform.connected && <Badge tone="positive">Connected</Badge>}
            {platform.status === "needs_reauth" && <Badge tone="warn">Reconnect needed</Badge>}
            {!platform.connected && platform.requires_connection && (
              <Badge tone="warn">Required</Badge>
            )}
          </div>
          <span className="text-[13px] leading-5 text-slate-500">
            {platform.connected
              ? platform.account_handle
                ? `@${platform.account_handle.replace(/^@/, "")}`
                : "Linked"
              : platform.requires_connection
                ? "Needed to submit videos from this platform"
                : "Views are read without connecting"}
          </span>
        </div>
      </div>

      {platform.connected ? (
        <Button
          kind="secondary"
          size="s"
          onClick={() => disconnect.mutate()}
          disabled={disconnect.isPending}
        >
          Disconnect
        </Button>
      ) : platform.connectable ? (
        <Button
          kind="secondary"
          size="s"
          icon="ph-link-simple"
          onClick={() => connect.mutate()}
          disabled={connect.isPending}
        >
          {connect.isPending ? "Opening…" : "Connect"}
        </Button>
      ) : (
        <span className="text-[13px] leading-5 text-slate-400">Not available yet</span>
      )}
    </div>
  );
}

const CONNECT_ERRORS: Record<string, string> = {
  cancelled: "Connection cancelled",
  expired: "That connection link expired — please try again",
  scope: "Please allow every permission on the platform's screen, including access to your video list",
  failed: "Could not complete the connection — please try again",
  unavailable: "That platform is not available yet",
};

export function ConnectAccounts() {
  const { data } = useSocialConnections();
  const queryClient = useQueryClient();

  /* The OAuth callback lands on the API and redirects back here with the
     outcome in the query string — it cannot toast from the API origin. Report
     it once, then strip the param so a refresh does not repeat it. */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("connected");
    const failed = params.get("connect_error");
    if (!connected && !failed) return;
    if (connected) {
      toast.success(`${connected[0].toUpperCase()}${connected.slice(1)} connected`);
      queryClient.invalidateQueries({ queryKey: ["social-connections"] });
    } else if (failed) {
      toast.error(CONNECT_ERRORS[failed] ?? CONNECT_ERRORS.failed);
    }
    params.delete("connected");
    params.delete("connect_error");
    const qs = params.toString();
    window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
  }, [queryClient]);

  if (!data) return null;
  return (
    <div className="flex flex-col">
      {data.platforms.map((p) => (
        <PlatformRow key={p.platform} platform={p} />
      ))}
    </div>
  );
}

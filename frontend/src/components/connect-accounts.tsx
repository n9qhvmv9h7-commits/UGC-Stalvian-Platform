"use client";

/* Connected accounts — the panel in Settings, and the prompt on My Videos.

   Which platforms are connectable, and which are required, comes from the
   server (GET /api/social/connections). The app never hardcodes that list:
   it changes when a flag flips, and a frontend rebuild must not be needed to
   keep up. */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { disconnectSocial, fetchSocialConnections, type SocialPlatform } from "@/lib/api";
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
        /* The OAuth flow is not built yet — the model, policy and gate ship
           first so this whole surface can be exercised with the gate dormant.
           This becomes a link to /api/social/{platform}/authorize. */
        <Button kind="secondary" size="s" disabled title="Coming soon">
          Connect
        </Button>
      ) : (
        <span className="text-[13px] leading-5 text-slate-400">Not available yet</span>
      )}
    </div>
  );
}

export function ConnectAccounts() {
  const { data } = useSocialConnections();
  if (!data) return null;
  return (
    <div className="flex flex-col">
      {data.platforms.map((p) => (
        <PlatformRow key={p.platform} platform={p} />
      ))}
    </div>
  );
}

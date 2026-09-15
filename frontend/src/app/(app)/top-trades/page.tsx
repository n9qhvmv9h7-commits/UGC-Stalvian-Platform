"use client";

import { ScriptFeedPage } from "@/components/script-feed";

export default function TopTradesPage() {
  return (
    <ScriptFeedPage
      group="top-trades"
      basePath="/top-trades"
      eyebrow="Top Trades"
      headline="The trades worth talking about."
      blurb="What a position turned out to be worth, and which trades people are watching right now. The receipts, ready to shoot."
    />
  );
}

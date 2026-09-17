"use client";

/* Daily Threads — the X side of Daily Scripts. Same feed machinery, same
   server-owned list of feeds; the server only hands a tweet account the
   thread feeds, so this page never has to know their keys. */

import { ScriptFeedPage } from "@/components/script-feed";

export default function DailyThreadsPage() {
  return (
    <ScriptFeedPage
      basePath="/daily-threads"
      eyebrow="Daily Threads"
      icon="ph-x-logo"
      headline="Fresh threads, every day."
      blurb="Every thread comes from real moves by politicians, hedge funds and insiders. Pick a feed, copy the thread, post it — new threads arrive on their own."
      noun="threads"
    />
  );
}

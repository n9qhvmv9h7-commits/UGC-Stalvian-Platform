"use client";

import { ScriptFeedPage } from "@/components/script-feed";

export default function DailyScriptsPage() {
  return (
    <ScriptFeedPage
      group="daily"
      basePath="/daily-scripts"
      eyebrow="Daily Scripts"
      headline="Fresh scripts, every day."
      blurb="Every story comes from real moves by politicians, hedge funds and insiders. Pick a feed, take a hook, and film it — new scripts arrive on their own."
    />
  );
}

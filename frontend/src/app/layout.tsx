import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
// Phosphor icons self-hosted (bundled webfont) — no third-party CDN in the auth'd app
import "@phosphor-icons/web/regular";
import "@phosphor-icons/web/fill";
import { Providers } from "@/lib/providers";

const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Stalvian Creators",
  description:
    "Tell the Stalvian story. Ready-made scripts from real market data, in your language — and clear pay for every video.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // font variable must live on <html>: --font-sans references it at :root
    <html lang="en" className={geist.variable}>
      {/* suppressHydrationWarning: browser extensions (Grammarly) inject body
          attributes before React loads — harmless, but noisy without this */}
      <body className="antialiased" suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

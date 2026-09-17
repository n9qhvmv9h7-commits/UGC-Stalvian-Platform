import { Sidebar, MobileNav } from "@/components/navbar";
import { AccountGate } from "@/components/account-gate";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AccountGate>
    <div className="flex min-h-screen bg-white">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileNav />
        <main className="mx-auto w-full max-w-[1200px] flex-1 px-6 py-10 lg:px-12 lg:py-12">
          {children}
        </main>
        <footer className="border-t border-bone-200 px-6 py-8 lg:px-12">
          <p className="mx-auto max-w-[1200px] text-[12px] leading-4 text-slate-400">
            Content produced through the Stalvian Creator Program is marketing communication and is
            not investment advice. Always disclose the paid partnership in your videos and posts.
            Your capital is at risk.
          </p>
        </footer>
      </div>
    </div>
    </AccountGate>
  );
}

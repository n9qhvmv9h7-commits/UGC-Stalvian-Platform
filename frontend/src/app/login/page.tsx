"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { login, setToken } from "@/lib/api";
import { Button, Field } from "@/components/ui";

export default function LoginPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const result = await login({ email, password });
      setToken(result.token);
      queryClient.clear(); // never show the previous account's cached data
      router.push("/dashboard");
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } }).response?.status;
      if (status === 401) toast.error("Invalid email or password");
      else if (status === 429) toast.error("Too many attempts — try again in a few minutes");
      else toast.error("Could not reach the server — try again");
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen">
      <div className="hidden w-[44%] flex-col justify-between bg-ink p-[60px] lg:flex">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/assets/stalvian-logo.svg" alt="Stalvian" className="h-7 self-start" />
        <h1 className="display-lg text-white">
          Welcome back.
          <br />
          The feed is fresh.
        </h1>
        <p className="text-[12px] leading-4 text-slate-500">Your capital is at risk.</p>
      </div>
      <div className="flex flex-1 items-center justify-center px-6 py-16">
        <form onSubmit={submit} className="flex w-full max-w-[440px] flex-col gap-6">
          <h2 className="display-md text-ink">Log in</h2>
          <Field
            label="Email"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Field
            label="Password"
            type="password"
            placeholder="Your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <Button type="submit" disabled={busy}>
            {busy ? "Logging in…" : "Log In"}
          </Button>
          <p className="text-[15px] leading-5 text-slate-500">
            Access is invite-only — accounts are created by the Stalvian team. Reach out
            if you&apos;d like to join the creator program.
          </p>
        </form>
      </div>
    </div>
  );
}

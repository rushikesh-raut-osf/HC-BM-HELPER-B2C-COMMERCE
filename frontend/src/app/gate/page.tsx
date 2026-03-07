"use client";

import { useState } from "react";
import Image from "next/image";

export default function GatePage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail) {
      setError("Please enter your work email.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/gate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmedEmail }),
      });
      if (!res.ok) {
        const text = await res.text();
        let message = "Authorization failed.";
        try {
          const parsed = JSON.parse(text) as { error?: string };
          message = parsed.error || message;
        } catch {
          if (text.trim()) message = text;
        }
        throw new Error(message);
      }
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authorization failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="relative min-h-screen overflow-hidden bg-[radial-gradient(circle_at_16%_14%,rgba(56,189,248,0.16),transparent_35%),radial-gradient(circle_at_85%_88%,rgba(52,211,153,0.16),transparent_40%),linear-gradient(180deg,#eef3ff,#f6f9ff_46%,#ecf8f7)] px-4 py-8 text-obsidian sm:px-6 lg:flex lg:items-center lg:justify-center">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,rgba(255,255,255,0.24),transparent_20%,transparent_80%,rgba(15,23,42,0.04))]" aria-hidden="true" />
      <section className="relative mx-auto grid min-h-[calc(100vh-4rem)] w-full max-w-6xl gap-5 lg:grid-cols-[1.03fr_0.97fr]">
        <div className="flex h-full flex-col justify-center rounded-3xl border border-signal/15 bg-white/90 p-6 shadow-[0_22px_48px_rgba(37,99,235,0.12)] backdrop-blur sm:p-8 lg:p-10">
          <div className="inline-flex w-fit self-start items-center gap-3 rounded-full border border-signal/20 bg-signal/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-signal">
            Internal Access
          </div>
          <div className="mt-4 flex items-center gap-3">
            <img src="/scout-logo.png" alt="SCOUT" className="h-9 w-auto sm:h-10" />
            <div>
              <p className="text-2xl font-semibold sm:text-3xl">Access Gate</p>
            </div>
          </div>
          <p className="mt-4 max-w-[56ch] text-sm leading-6 text-obsidian/72">
            Enter your OSF work email to verify access and continue to SCOUT.
          </p>
          <div className="mt-6 grid gap-3">
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-2xl border border-obsidian/15 bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-signal/35"
              placeholder="Email"
              type="email"
              autoComplete="email"
              onKeyDown={(event) => {
                if (event.key === "Enter" && !loading) {
                  event.preventDefault();
                  void handleSubmit();
                }
              }}
            />
            {error && <p className="text-sm text-rose">{error}</p>}
            <button
              onClick={handleSubmit}
              className="mt-2 inline-flex items-center justify-center gap-2 rounded-full bg-obsidian px-6 py-3 text-sm font-semibold text-white shadow-[0_14px_28px_rgba(11,18,32,0.22)] transition-transform hover:-translate-y-[1px]"
              disabled={loading}
            >
              {loading ? (
                "Checking..."
              ) : (
                <>
                  Continue to SCOUT
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 20 20"
                    fill="none"
                    className="h-4 w-4"
                  >
                    <path
                      d="M4 10h12m0 0-4-4m4 4-4 4"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </>
              )}
            </button>
            <p className="text-xs text-obsidian/55">Only approved OSF accounts can access this workspace.</p>
          </div>
        </div>

        <div className="relative flex h-full flex-col overflow-hidden rounded-3xl border border-signal/15 bg-[linear-gradient(155deg,rgba(19,34,60,0.98),rgba(37,99,235,0.94))] py-6 pl-6 pr-0 shadow-[0_24px_54px_rgba(18,34,60,0.32)] sm:py-8 sm:pl-8 sm:pr-0">
          <div className="pointer-events-none absolute -right-10 -top-10 h-44 w-44 rounded-full bg-cyan-300/25 blur-3xl" aria-hidden="true" />
          <div className="pointer-events-none absolute -left-14 -bottom-20 h-56 w-56 rounded-full bg-sky-300/20 blur-3xl" aria-hidden="true" />
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_65%_45%,rgba(110,255,249,0.24),transparent_46%)]" aria-hidden="true" />
          <div className="relative flex min-h-[320px] w-full flex-1 items-center justify-end sm:min-h-[440px]">
            <Image
              src="/mascot/gate-mascot.png"
              alt="Scout mascot guiding sign in"
              fill
              priority
              sizes="(max-width: 1024px) 80vw, 42vw"
              style={{ top: "85px" }}
              className="object-contain object-right -translate-y-[3%] drop-shadow-[0_24px_42px_rgba(26,208,255,0.42)]"
            />
          </div>
          <div className="relative z-10 mt-auto mb-6 w-full pr-6 text-left text-sky-50/92 sm:mb-8 sm:pr-8">
            <p className="text-lg font-semibold tracking-[0.01em] text-[#9ef5f9] sm:text-xl">
              Move from questions to clarity faster.
            </p>
            <p className="mt-1 max-w-[42ch] text-sm leading-6 text-sky-100/80">
              SCOUT turns scattered inputs into focused, decision-ready intelligence for every brief.
            </p>
            <p className="mt-3 inline-flex max-w-[42ch] rounded-xl border border-cyan-200/35 bg-cyan-300/10 px-3 py-2 text-xs font-medium leading-5 text-cyan-100">
              Need access? Please create a Jira request and our team will enable your account.
            </p>
            <p className="mt-3 text-xs tracking-[0.08em] text-sky-100/55">© 2026 OSF Digital. All rights reserved.</p>
          </div>
        </div>
      </section>
    </main>
  );
}

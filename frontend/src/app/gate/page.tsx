"use client";

import { useState } from "react";

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
    <main className="min-h-screen bg-gradient-to-b from-[#eef3ff] via-[#f6f9ff] to-[#ecf8f7] px-4 py-8 text-obsidian sm:px-6">
      <section className="mx-auto grid w-full max-w-5xl gap-5 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-3xl border border-signal/15 bg-white/90 p-6 shadow-[0_22px_48px_rgba(37,99,235,0.12)] backdrop-blur sm:p-8">
          <div className="inline-flex items-center gap-3 rounded-full border border-signal/20 bg-signal/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-signal">
            Internal Access
          </div>
          <div className="mt-4 flex items-center gap-3">
            <img src="/scout-logo.png" alt="SCOUT" className="h-9 w-auto sm:h-10" />
            <div>
              <p className="text-2xl font-semibold sm:text-3xl">Access Gate</p>
            </div>
          </div>
          <p className="mt-4 max-w-[56ch] text-sm leading-6 text-obsidian/72">Add your OSF email.</p>
          <div className="mt-6 grid gap-3">
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-obsidian/60">
              Work email
            </label>
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
              {loading ? "Checking..." : "Continue to SCOUT"}
            </button>
            <p className="text-xs text-obsidian/55">Only approved OSF accounts can access this workspace.</p>
          </div>
        </div>

        <div className="rounded-3xl border border-signal/15 bg-[linear-gradient(155deg,rgba(31,42,68,0.96),rgba(37,99,235,0.92))] p-6 text-white shadow-[0_22px_48px_rgba(31,42,68,0.24)] sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/70">What you get</p>
          <h2 className="mt-2 text-xl font-semibold leading-tight sm:text-2xl">Requirement clarity, faster delivery.</h2>
          <div className="mt-5 grid gap-3 text-sm text-white/85">
            <div className="rounded-2xl border border-white/15 bg-white/10 p-3">
              Analyze requirement coverage with evidence-backed classification.
            </div>
            <div className="rounded-2xl border border-white/15 bg-white/10 p-3">
              Keep threads organized by project and save workspace state.
            </div>
            <div className="rounded-2xl border border-white/15 bg-white/10 p-3">
              Build and export FSD drafts directly from guided analysis.
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

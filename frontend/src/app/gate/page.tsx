"use client";

import { useState } from "react";

export default function GatePage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/gate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Authorization failed.");
      }
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authorization failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="app-shell min-h-screen px-4 py-8 text-obsidian sm:px-6">
      <section className="mx-auto flex max-w-2xl flex-col gap-6">
        <div className="card p-8">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-signal to-mint" />
            <div>
              <p className="text-sm font-semibold text-obsidian/70">Requirement Analyzer</p>
              <p className="text-2xl font-semibold">Access Gate</p>
            </div>
          </div>
          <p className="mt-4 text-sm text-obsidian/70">
            Please use your OSF email to access the Requirement Analyzer AI Agent.
          </p>
          <div className="mt-6 grid gap-3">
            <label className="text-xs font-semibold uppercase tracking-[0.2em] text-obsidian/60">
              Work email
            </label>
            <input
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-2xl border border-obsidian/15 bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-signal/30"
              placeholder="Work email"
              type="email"
            />
            {error && <p className="text-sm text-rose">{error}</p>}
            <button
              onClick={handleSubmit}
              className="mt-2 rounded-full bg-obsidian px-6 py-3 text-sm font-semibold text-white"
              disabled={loading}
            >
              {loading ? "Checking..." : "Continue"}
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}

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
    <main className="relative min-h-screen overflow-hidden bg-[#050b17] px-4 py-6 text-slate-100 sm:px-6 lg:px-10">
      <div
        className="pointer-events-none absolute inset-0 opacity-70"
        aria-hidden="true"
        style={{
          backgroundImage:
            "radial-gradient(circle at 20% 18%, rgba(56,189,248,0.25), transparent 34%), radial-gradient(circle at 78% 72%, rgba(45,212,191,0.18), transparent 35%), radial-gradient(circle at 62% 28%, rgba(14,165,233,0.15), transparent 30%), linear-gradient(160deg, #041126 0%, #061a35 45%, #041126 100%)",
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-30"
        aria-hidden="true"
        style={{
          backgroundImage:
            "radial-gradient(rgba(148,163,184,0.28) 1px, transparent 1px), radial-gradient(rgba(125,211,252,0.2) 1px, transparent 1px)",
          backgroundSize: "26px 26px, 26px 26px",
          backgroundPosition: "0 0, 13px 13px",
        }}
      />

      <section className="relative mx-auto flex w-full max-w-6xl justify-center pb-5">
        <div className="hidden items-center gap-4 rounded-full border border-white/25 bg-white/10 px-5 py-2 text-sm shadow-[0_10px_30px_rgba(15,23,42,0.38)] backdrop-blur md:flex">
          <span className="text-white/80">Loreal</span>
          <span className="text-white/80">Human Made</span>
          <span className="text-white/80">Useful Links</span>
          <span className="text-white/80">CodeWithHarry</span>
          <span className="text-cyan-300">Fizzer</span>
        </div>
      </section>

      <section className="relative mx-auto grid w-full max-w-6xl gap-5 lg:grid-cols-12">
        <div className="space-y-5 lg:col-span-7">
          <div className="rounded-[1.7rem] border border-white/25 bg-[linear-gradient(140deg,rgba(148,163,184,0.16),rgba(15,23,42,0.26))] p-5 shadow-[0_18px_45px_rgba(2,8,23,0.5)] backdrop-blur-xl sm:p-7">
            <div className="inline-flex items-center rounded-full border border-cyan-200/35 bg-cyan-300/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-cyan-100">
              Internal Access
            </div>
            <div className="mt-4 flex items-center gap-3">
              <img src="/scout-logo.png" alt="SCOUT" className="h-10 w-auto sm:h-12" />
              <p className="text-3xl font-semibold leading-none text-white sm:text-4xl">Access Gate</p>
            </div>
            <p className="mt-4 text-base text-slate-200/90">Add your OSF email for access.</p>

            <div className="mt-6 grid gap-3">
              <label className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-200/85">
                Work email
              </label>
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="w-full rounded-2xl border border-cyan-200/45 bg-slate-100/90 px-4 py-3 text-base text-slate-900 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.45)] focus:outline-none focus:ring-2 focus:ring-cyan-300/65"
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
              {error && <p className="text-sm text-rose-300">{error}</p>}
              <button
                onClick={handleSubmit}
                className="mt-2 inline-flex items-center justify-center gap-2 rounded-full border border-cyan-200/60 bg-[linear-gradient(90deg,rgba(2,8,23,0.98),rgba(8,47,73,0.95))] px-6 py-3 text-sm font-semibold text-cyan-50 shadow-[0_0_0_1px_rgba(34,211,238,0.15),0_0_18px_rgba(34,211,238,0.45)] transition hover:-translate-y-[1px] hover:shadow-[0_0_0_1px_rgba(34,211,238,0.22),0_0_22px_rgba(34,211,238,0.58)]"
                disabled={loading}
              >
                {loading ? "Checking..." : "Continue to SCOUT"}
              </button>
              <p className="text-sm text-slate-200/80">Authorized access for approved OSF accounts only.</p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <article className="rounded-3xl border border-white/20 bg-white/10 p-4 shadow-[0_12px_30px_rgba(2,8,23,0.4)] backdrop-blur">
              <p className="text-sm font-semibold text-cyan-100">System status log</p>
              <div className="mt-3 space-y-1.5 text-xs text-slate-200/90">
                <p>12:33:38 AM: System status</p>
                <p>12:33:58 AM: Real-time sync</p>
                <p>12:34:18 AM: Workspace ready</p>
                <p>12:34:41 AM: Signal stable</p>
              </div>
            </article>
            <article className="rounded-3xl border border-white/20 bg-white/10 p-4 shadow-[0_12px_30px_rgba(2,8,23,0.4)] backdrop-blur">
              <p className="text-sm font-semibold text-cyan-100">Quick Access Dashboard</p>
              <div className="mt-3 space-y-1.5 text-xs text-slate-200/90">
                <p>Progress: 90%</p>
                <p>Recent activity alerts</p>
                <p>Workspace health: Good</p>
                <p>Pending actions: 0</p>
              </div>
            </article>
          </div>
        </div>

        <div className="relative overflow-hidden rounded-[1.7rem] border border-cyan-200/30 bg-[linear-gradient(155deg,rgba(7,20,41,0.92),rgba(17,54,92,0.9))] p-4 shadow-[0_24px_55px_rgba(2,8,23,0.52)] lg:col-span-5 sm:p-5">
          <div className="pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full bg-cyan-300/20 blur-3xl" aria-hidden="true" />
          <div className="pointer-events-none absolute -left-14 -bottom-16 h-44 w-44 rounded-full bg-sky-300/15 blur-3xl" aria-hidden="true" />
          <div className="relative flex min-h-[420px] items-center justify-center sm:min-h-[560px]">
            <div className="absolute left-4 top-6 rounded-2xl border border-cyan-200/35 bg-cyan-300/10 px-4 py-3 text-3xl leading-none text-cyan-100 shadow-[0_0_24px_rgba(56,189,248,0.28)] sm:left-6 sm:top-8 sm:text-5xl">
              login to
              <br />
              continue.
            </div>
            <div className="relative h-[24rem] w-full max-w-[29rem] sm:h-[33rem]">
              <Image
                src="/mascot/gate-mascot.png"
                alt="Scout mascot guiding sign in"
                fill
                priority
                sizes="(max-width: 640px) 92vw, (max-width: 1024px) 60vw, 34vw"
                className="object-contain drop-shadow-[0_28px_44px_rgba(34,211,238,0.42)]"
              />
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

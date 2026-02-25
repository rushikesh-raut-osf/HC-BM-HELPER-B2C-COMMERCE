/* eslint-disable react/no-unescaped-entities */
"use client";

import { useMemo, useState } from "react";
import {
  analyzeRequirementsFile,
  analyzeRequirementsText,
  generateFsd,
  generateFsdDocx,
  GapResult,
} from "@/lib/api";

const SAMPLE = `Checkout must support Apple Pay and gift messages.
Add store locator with map view.
Allow coupon stacking by customer group.
Enable multi-ship to multiple addresses.`;

export default function Home() {
  const [text, setText] = useState(SAMPLE);
  const [file, setFile] = useState<File | null>(null);
  const [results, setResults] = useState<GapResult[]>([]);
  const [fsd, setFsd] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showDebug, setShowDebug] = useState(false);

  const summary = useMemo(() => {
    const counts = {
      total: results.length,
      oob: 0,
      partial: 0,
      custom: 0,
      open: 0,
    };
    for (const item of results) {
      const label = item.classification.toLowerCase();
      if (label.includes("ootb")) counts.oob += 1;
      else if (label.includes("partial")) counts.partial += 1;
      else if (label.includes("open")) counts.open += 1;
      else counts.custom += 1;
    }
    return counts;
  }, [results]);

  const coverage = summary.total
    ? Math.round(((summary.oob + summary.partial) / summary.total) * 100)
    : 0;

  const badgeTone = (label: string) => {
    const normalized = label.toLowerCase();
    if (normalized.includes("ootb")) return "bg-mint/15 text-mint";
    if (normalized.includes("partial")) return "bg-amber/20 text-amber";
    if (normalized.includes("open")) return "bg-rose/20 text-rose";
    return "bg-signal/20 text-signal";
  };

  const getSources = (item: GapResult) => {
    const seen = new Set<string>();
    const sources: Array<{ title: string; url: string }> = [];
    for (const chunk of item.top_chunks) {
      const url = typeof chunk.metadata?.url === "string" ? chunk.metadata.url : "";
      if (!url || seen.has(url)) continue;
      seen.add(url);
      const title =
        (typeof chunk.metadata?.title === "string" && chunk.metadata.title) ||
        (typeof chunk.metadata?.source_id === "string" && chunk.metadata.source_id) ||
        "Source page";
      sources.push({ title, url });
    }
    return sources;
  };

  const handleAnalyze = async () => {
    setLoading(true);
    setError("");
    try {
      const payload = file
        ? await analyzeRequirementsFile(file)
        : await analyzeRequirementsText(text);
      setResults(payload.results);
      setFsd("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = async () => {
    setLoading(true);
    setError("");
    try {
      const payload = await generateFsd(results);
      setFsd(payload.fsd);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadDocx = async () => {
    setLoading(true);
    setError("");
    try {
      const blob = await generateFsdDocx(results);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "fsd.docx";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="app-shell min-h-screen px-6 py-10 text-paper">
      <section className="mx-auto flex max-w-6xl flex-col gap-10">
        <header className="flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl space-y-5">
            <p className="section-title">Competitive Readiness</p>
            <h1 className="font-display text-4xl leading-tight sm:text-5xl">
              Commerce delivery intelligence for teams who ship ahead of the market.
            </h1>
            <p className="text-lg text-slate/80">
              Centralize requirements intake, quantify OOTB coverage, and turn decisions into an
              executive-ready FSD with a single release-ready workflow.
            </p>
            <div className="flex flex-wrap gap-3">
              <span className="badge bg-white/10 text-slate">ChromaDB Index</span>
              <span className="badge bg-white/10 text-slate">Gemini 1.5 Flash</span>
              <span className="badge bg-white/10 text-slate">FastAPI Control Plane</span>
            </div>
          </div>
        </header>

        <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="panel p-6">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-2xl">Requirements Intake</h2>
              <button
                onClick={() => {
                  setText(SAMPLE);
                  setFile(null);
                }}
                className="rounded-full border border-obsidian/20 px-4 py-2 text-sm font-semibold"
              >
                Load sample
              </button>
            </div>
            <div className="mt-4 grid gap-4 text-obsidian/80">
              <textarea
                value={text}
                onChange={(event) => setText(event.target.value)}
                className="h-44 w-full rounded-2xl border border-obsidian/15 bg-white p-4 text-sm focus:outline-none focus:ring-2 focus:ring-gold/40"
                placeholder="Paste requirements, one per line."
              />
              <label className="flex items-center gap-3 rounded-2xl border border-dashed border-obsidian/30 bg-white p-4 text-sm">
                <input
                  type="file"
                  className="hidden"
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                />
                <span className="rounded-full bg-obsidian/10 px-3 py-1 text-xs font-semibold uppercase">
                  Upload
                </span>
                <span>{file ? file.name : "Word or PDF requirements file"}</span>
              </label>
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={handleAnalyze}
                  className="rounded-full bg-obsidian px-6 py-3 text-sm font-semibold text-paper shadow-glow"
                  disabled={loading}
                >
                  {loading ? "Analyzing..." : "Run gap analysis"}
                </button>
                <button
                  onClick={() => setFile(null)}
                  className="rounded-full border border-obsidian/20 px-6 py-3 text-sm"
                >
                  Clear file
                </button>
              </div>
              {error && <p className="text-sm text-rose">{error}</p>}
            </div>
          </div>

          <div className="card p-6">
            <h2 className="font-display text-2xl">Coverage Pulse</h2>
            <div className="mt-4 grid gap-3 text-sm">
              <div className="flex justify-between rounded-2xl bg-white/10 px-4 py-3">
                <span>Total Requirements</span>
                <span className="font-semibold text-paper">{summary.total}</span>
              </div>
              <div className="flex justify-between rounded-2xl bg-white/10 px-4 py-3">
                <span>OOTB Match</span>
                <span className="font-semibold text-mint">{summary.oob}</span>
              </div>
              <div className="flex justify-between rounded-2xl bg-white/10 px-4 py-3">
                <span>Partial Match</span>
                <span className="font-semibold text-amber">{summary.partial}</span>
              </div>
              <div className="flex justify-between rounded-2xl bg-white/10 px-4 py-3">
                <span>Custom Dev Required</span>
                <span className="font-semibold text-signal">{summary.custom}</span>
              </div>
              <div className="flex justify-between rounded-2xl bg-white/10 px-4 py-3">
                <span>Open Questions</span>
                <span className="font-semibold text-rose">{summary.open}</span>
              </div>
            </div>
            <button
              onClick={handleGenerate}
              disabled={loading || results.length === 0}
              className="mt-6 w-full rounded-full bg-gold px-6 py-3 text-sm font-semibold text-obsidian"
            >
              {loading ? "Generating..." : "Generate FSD Draft"}
            </button>
          </div>
        </section>

        <section className="card p-6">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="font-display text-2xl">Competitive Gap Findings</h2>
              <p className="text-sm text-slate/70">
                Prioritized requirements with confidence scoring and source evidence.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate/70">
              <span className="rounded-full border border-white/10 px-3 py-1">Auto-ranked by impact</span>
              <span className="rounded-full border border-white/10 px-3 py-1">Evidence-linked</span>
              <button
                onClick={() => setShowDebug((prev) => !prev)}
                className="rounded-full border border-white/10 px-3 py-1 text-xs"
              >
                {showDebug ? "Hide debug" : "Show debug"}
              </button>
            </div>
          </div>
          <div className="mt-4 grid gap-4">
            {results.length === 0 && (
              <p className="text-sm text-slate/70">Run the analysis to surface strategic gaps.</p>
            )}
            {results.map((item, index) => {
              const sources = getSources(item);
              const similarityPct =
                item.similarity_score != null ? Math.round(item.similarity_score * 100) : 0;

              return (
                <div
                  key={`${item.requirement}-${index}`}
                  className="rounded-2xl border border-white/10 bg-white/5 p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm font-semibold">{item.requirement}</p>
                    <span className={`badge ${badgeTone(item.classification)}`}>
                      {item.classification}
                    </span>
                  </div>
                  {sources.length > 0 && (
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate/70">
                      <span className="uppercase tracking-[0.2em] text-[0.6rem]">Sources</span>
                      {sources.map((source) => (
                        <a
                          key={source.url}
                          href={source.url}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-full border border-white/10 px-3 py-1 text-slate/80 hover:text-paper"
                        >
                          {source.title}
                        </a>
                      ))}
                    </div>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-slate/70">
                    <span>Confidence: {(item.confidence * 100).toFixed(0)}%</span>
                    <span>{item.rationale}</span>
                  </div>
                  {showDebug && (
                    <div className="mt-3 rounded-2xl border border-white/10 bg-white/5 p-3 text-xs text-slate/70">
                      <div className="flex flex-wrap items-center gap-4">
                        <span>Similarity score: {similarityPct}%</span>
                        <span>
                          LLM confidence:{" "}
                          {item.llm_confidence != null
                            ? `${Math.round(item.llm_confidence * 100)}%`
                            : "n/a"}
                        </span>
                        <span>LLM context: top 3 evidence chunks</span>
                      </div>
                      <div className="mt-2 text-[0.7rem] text-slate/60">LLM response</div>
                      <div className="mt-1 whitespace-pre-wrap text-[0.75rem] text-slate/80">
                        {item.llm_response || "n/a"}
                      </div>
                    </div>
                  )}
                  {item.top_chunks.length > 0 && (
                    <details className="mt-3 text-xs text-slate/70">
                      <summary className="cursor-pointer">Top evidence</summary>
                      <ul className="mt-2 grid gap-2">
                        {item.top_chunks.slice(0, 3).map((chunk, idx) => (
                          <li
                            key={`${item.requirement}-chunk-${idx}`}
                            className="rounded-xl border border-white/10 bg-white/5 p-3"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="text-[0.65rem] uppercase tracking-[0.2em] text-slate/60">
                                Chunk {idx + 1}
                              </span>
                              <span className="rounded-full border border-white/10 px-2 py-0.5 text-[0.6rem]">
                                Used in LLM
                              </span>
                            </div>
                            <p className="mt-2 line-clamp-4">{chunk.text}</p>
                            <p className="mt-2">Score: {(chunk.score * 100).toFixed(0)}%</p>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section className="panel p-6">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-2xl">FSD Executive Preview</h2>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => navigator.clipboard.writeText(fsd)}
                disabled={!fsd}
                className="rounded-full border border-obsidian/20 px-4 py-2 text-xs font-semibold"
              >
                Copy
              </button>
              <button
                onClick={handleDownloadDocx}
                disabled={loading || results.length === 0}
                className="rounded-full bg-obsidian px-4 py-2 text-xs font-semibold text-paper"
              >
                Download .docx
              </button>
            </div>
          </div>
          <pre className="mt-4 max-h-96 overflow-auto whitespace-pre-wrap rounded-2xl bg-obsidian/5 p-4 text-sm text-obsidian/80">
            {fsd || "Generate the FSD to view it here."}
          </pre>
        </section>
      </section>
    </main>
  );
}

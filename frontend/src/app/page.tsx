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
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_#fff,_#f4f1ec_45%,_#e9e2da_100%)] px-6 py-12 text-ink">
      <section className="mx-auto flex max-w-6xl flex-col gap-10">
        <header className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-4">
            <p className="section-title">SFRA AI Agent</p>
            <h1 className="font-display text-4xl leading-tight sm:text-5xl">
              Requirement gap analysis with FSD generation built for sprint demos.
            </h1>
            <p className="text-lg text-night/70">
              Upload a Word/PDF or paste requirements. The agent classifies OOTB coverage, flags
              custom work, and drafts a structured FSD.
            </p>
            <div className="flex flex-wrap gap-3">
              <span className="badge bg-ember/15 text-ember">ChromaDB</span>
              <span className="badge bg-tide/15 text-tide">Gemini 1.5 Flash</span>
              <span className="badge bg-night/10 text-night">FastAPI</span>
            </div>
          </div>
          <div className="card glass flex flex-col justify-between gap-4 p-6">
            <div>
              <p className="section-title">Sprint Milestone</p>
              <p className="mt-2 text-3xl font-display">Integration Checkpoint</p>
              <p className="text-night/60">Friday, Feb 27</p>
            </div>
            <div className="grid gap-2 text-sm text-night/70">
              <div className="flex justify-between">
                <span>Feature Complete</span>
                <span className="font-semibold">Mar 4</span>
              </div>
              <div className="flex justify-between">
                <span>Code Freeze</span>
                <span className="font-semibold">Mar 5</span>
              </div>
              <div className="flex justify-between">
                <span>Demo Day</span>
                <span className="font-semibold">Mar 8</span>
              </div>
            </div>
          </div>
        </header>

        <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="card p-6">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-2xl">Requirements Intake</h2>
              <button
                onClick={() => {
                  setText(SAMPLE);
                  setFile(null);
                }}
                className="rounded-full border border-black/10 px-4 py-2 text-sm"
              >
                Load sample
              </button>
            </div>
            <div className="mt-4 grid gap-4">
              <textarea
                value={text}
                onChange={(event) => setText(event.target.value)}
                className="h-44 w-full rounded-2xl border border-black/10 bg-white/70 p-4 text-sm focus:outline-none focus:ring-2 focus:ring-ember/40"
                placeholder="Paste requirements, one per line."
              />
              <label className="flex items-center gap-3 rounded-2xl border border-dashed border-black/20 bg-white/70 p-4 text-sm">
                <input
                  type="file"
                  className="hidden"
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                />
                <span className="rounded-full bg-night/10 px-3 py-1 text-xs font-semibold uppercase">
                  Upload
                </span>
                <span>{file ? file.name : "Word or PDF requirements file"}</span>
              </label>
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={handleAnalyze}
                  className="rounded-full bg-ember px-6 py-3 text-sm font-semibold text-white shadow-glow"
                  disabled={loading}
                >
                  {loading ? "Analyzing..." : "Run gap analysis"}
                </button>
                <button
                  onClick={() => setFile(null)}
                  className="rounded-full border border-black/10 px-6 py-3 text-sm"
                >
                  Clear file
                </button>
              </div>
              {error && <p className="text-sm text-red-600">{error}</p>}
            </div>
          </div>

          <div className="card p-6">
            <h2 className="font-display text-2xl">Coverage Summary</h2>
            <div className="mt-4 grid gap-3 text-sm">
              <div className="flex justify-between rounded-2xl bg-white/80 px-4 py-3">
                <span>Total Requirements</span>
                <span className="font-semibold">{summary.total}</span>
              </div>
              <div className="flex justify-between rounded-2xl bg-white/80 px-4 py-3">
                <span>OOTB Match</span>
                <span className="font-semibold">{summary.oob}</span>
              </div>
              <div className="flex justify-between rounded-2xl bg-white/80 px-4 py-3">
                <span>Partial Match</span>
                <span className="font-semibold">{summary.partial}</span>
              </div>
              <div className="flex justify-between rounded-2xl bg-white/80 px-4 py-3">
                <span>Custom Dev Required</span>
                <span className="font-semibold">{summary.custom}</span>
              </div>
              <div className="flex justify-between rounded-2xl bg-white/80 px-4 py-3">
                <span>Open Questions</span>
                <span className="font-semibold">{summary.open}</span>
              </div>
            </div>
            <button
              onClick={handleGenerate}
              disabled={loading || results.length === 0}
              className="mt-6 w-full rounded-full border border-night/20 px-6 py-3 text-sm font-semibold"
            >
              {loading ? "Generating..." : "Generate FSD Draft"}
            </button>
          </div>
        </section>

        <section className="card p-6">
          <h2 className="font-display text-2xl">Gap Analysis Results</h2>
          <div className="mt-4 grid gap-4">
            {results.length === 0 && (
              <p className="text-sm text-night/60">Run the analysis to see results.</p>
            )}
            {results.map((item, index) => (
              <div key={`${item.requirement}-${index}`} className="rounded-2xl border border-black/10 bg-white/80 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm font-semibold">{item.requirement}</p>
                  <span className="badge bg-night/10 text-night">{item.classification}</span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-night/70">
                  <span>Confidence: {(item.confidence * 100).toFixed(0)}%</span>
                  <span>{item.rationale}</span>
                </div>
                {item.top_chunks.length > 0 && (
                  <details className="mt-3 text-xs text-night/70">
                    <summary className="cursor-pointer">Top evidence</summary>
                    <ul className="mt-2 grid gap-2">
                      {item.top_chunks.slice(0, 3).map((chunk, idx) => (
                        <li key={`${item.requirement}-chunk-${idx}`} className="rounded-xl border border-black/10 p-3">
                          <p className="line-clamp-4">{chunk.text}</p>
                          <p className="mt-2">Score: {(chunk.score * 100).toFixed(0)}%</p>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="card p-6">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-2xl">FSD Preview</h2>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => navigator.clipboard.writeText(fsd)}
                disabled={!fsd}
                className="rounded-full border border-black/10 px-4 py-2 text-xs font-semibold"
              >
                Copy
              </button>
              <button
                onClick={handleDownloadDocx}
                disabled={loading || results.length === 0}
                className="rounded-full border border-black/10 px-4 py-2 text-xs font-semibold"
              >
                Download .docx
              </button>
            </div>
          </div>
          <pre className="mt-4 max-h-96 overflow-auto whitespace-pre-wrap rounded-2xl bg-white/80 p-4 text-sm text-night/80">
            {fsd || "Generate the FSD to view it here."}
          </pre>
        </section>
      </section>
    </main>
  );
}

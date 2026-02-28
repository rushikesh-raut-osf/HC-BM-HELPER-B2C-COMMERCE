/* eslint-disable react/no-unescaped-entities */
"use client";

import { useEffect, useMemo, useState } from "react";
import {
  analyzeRequirementsFile,
  analyzeRequirementsText,
  BaselineRemovedItem,
  BaselineSummary,
  generateFsd,
  generateFsdDocx,
  GapResult,
  saveBaseline,
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
  const [loadingMode, setLoadingMode] = useState<
    "analyze" | "generate" | "download" | "baseline" | null
  >(null);
  const [loadingMessage, setLoadingMessage] = useState("");
  const [error, setError] = useState("");
  const [showDebug, setShowDebug] = useState(false);
  const [baselineName, setBaselineName] = useState("");
  const [baselineSummary, setBaselineSummary] = useState<BaselineSummary | null>(null);
  const [baselineRemoved, setBaselineRemoved] = useState<BaselineRemovedItem[]>([]);
  const [baselineNotice, setBaselineNotice] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!loadingMode) {
      setLoadingMessage("");
      return;
    }

    const stepsByMode: Record<NonNullable<typeof loadingMode>, string[]> = {
      analyze: [
        "Analyzing requirements",
        "Fetching evidence sources",
        "Comparing SFRA coverage",
        "Scoring confidence signals",
      ],
      generate: ["Drafting FSD summary", "Mapping gaps to deliverables", "Formatting exec output"],
      download: ["Preparing .docx", "Packaging sources", "Finalizing download"],
      baseline: ["Saving baseline snapshot", "Scoring OOTB coverage", "Indexing baseline state"],
    };

    const steps = stepsByMode[loadingMode];
    let idx = 0;
    setLoadingMessage(steps[idx]);
    const interval = window.setInterval(() => {
      idx = (idx + 1) % steps.length;
      setLoadingMessage(steps[idx]);
    }, 1400);

    return () => window.clearInterval(interval);
  }, [loadingMode]);

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

  const badgeTone = (label: string) => {
    const normalized = label.toLowerCase();
    if (normalized.includes("ootb")) return "bg-mint/20 text-mint";
    if (normalized.includes("partial")) return "bg-amber/25 text-amber";
    if (normalized.includes("open")) return "bg-rose/20 text-rose";
    return "bg-signal/20 text-signal";
  };

  const baselineTone = (label: string) => {
    const normalized = label.toLowerCase();
    if (normalized === "unchanged") return "bg-mint/20 text-mint";
    if (normalized === "changed") return "bg-amber/25 text-amber";
    if (normalized === "new") return "bg-signal/20 text-signal";
    return "bg-obsidian/5 text-obsidian/60";
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
    setLoadingMode("analyze");
    setError("");
    setBaselineNotice("");
    try {
      const payload = file
        ? await analyzeRequirementsFile(file)
        : await analyzeRequirementsText(text, baselineName || undefined);
      setResults(payload.results);
      if ("baseline" in payload) {
        setBaselineSummary(payload.baseline ?? null);
        setBaselineRemoved(payload.baseline_removed ?? []);
      } else {
        setBaselineSummary(null);
        setBaselineRemoved([]);
      }
      setFsd("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
      setLoadingMode(null);
    }
  };

  const handleGenerate = async () => {
    setLoading(true);
    setLoadingMode("generate");
    setError("");
    setBaselineNotice("");
    try {
      const payload = await generateFsd(results);
      setFsd(payload.fsd);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
      setLoadingMode(null);
    }
  };

  const handleDownloadDocx = async () => {
    setLoading(true);
    setLoadingMode("download");
    setError("");
    setBaselineNotice("");
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
      setLoadingMode(null);
    }
  };

  const handleSaveBaseline = async () => {
    if (!baselineName.trim()) {
      setBaselineNotice("Add a baseline name before saving.");
      return;
    }
    setLoading(true);
    setLoadingMode("baseline");
    setError("");
    try {
      const saved = await saveBaseline(baselineName.trim(), text);
      setBaselineNotice(`Baseline "${saved.name}" saved with ${saved.total} requirements.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
      setLoadingMode(null);
    }
  };

  const filteredResults = results.filter((item) =>
    item.requirement.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <main className="app-shell min-h-screen px-4 py-8 text-obsidian sm:px-6">
      <section className="mx-auto flex max-w-7xl flex-col gap-6">
        <header className="glass-bar">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-signal to-mint" />
            <div>
              <p className="text-sm font-semibold text-obsidian/70">SFRA AI Agent</p>
              <p className="text-lg font-semibold">Requirements Intelligence</p>
            </div>
          </div>
          <nav className="hidden items-center gap-6 text-sm font-semibold text-obsidian/60 lg:flex">
            <button className="nav-pill">Upload</button>
            <button className="nav-pill nav-pill--active">Analysis</button>
            <button className="nav-pill">FSD Preview</button>
            <button className="nav-pill">Export</button>
          </nav>
          <div className="flex items-center gap-2">
            <button
              onClick={async () => {
                await fetch("/api/gate/logout", { method: "POST" });
                window.location.href = "/gate";
              }}
              className="rounded-full border border-obsidian/10 px-3 py-1 text-xs font-semibold text-obsidian/60"
            >
              Sign out
            </button>
            <button className="icon-chip">?</button>
            <button className="icon-chip">?</button>
            <div className="h-9 w-9 rounded-full bg-obsidian/10" />
          </div>
        </header>

        <section className="grid gap-6 lg:grid-cols-[1.05fr_1.4fr]">
          <div className="grid gap-6">
            <div className="card p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="section-title">Upload Requirement Documents</p>
                  <h2 className="font-display text-2xl">Drop your Word or PDF files here</h2>
                </div>
                <button
                  onClick={() => {
                    setText(SAMPLE);
                    setFile(null);
                  }}
                  className="rounded-full border border-obsidian/20 px-4 py-2 text-xs font-semibold"
                >
                  Load sample
                </button>
              </div>
              <div className="mt-5 grid gap-4">
                <div className="rounded-3xl border border-dashed border-obsidian/20 bg-obsidian/5 p-6 text-center">
                  <p className="text-base font-semibold text-obsidian/70">
                    Drop your Word or PDF files here or
                  </p>
                  <label className="mt-4 inline-flex cursor-pointer items-center gap-2 rounded-full border border-obsidian/20 bg-white px-4 py-2 text-xs font-semibold">
                    <input
                      type="file"
                      className="hidden"
                      onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                    />
                    Upload from device
                  </label>
                  <p className="mt-3 text-xs text-obsidian/50">
                    {file ? file.name : "No file selected"}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <input
                    value={baselineName}
                    onChange={(event) => setBaselineName(event.target.value)}
                    className="w-full rounded-2xl border border-obsidian/15 bg-white px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-signal/30 sm:w-64"
                    placeholder="Baseline name (e.g., Feb-25)"
                  />
                  <button
                    onClick={handleSaveBaseline}
                    className="rounded-full border border-obsidian/20 px-4 py-2 text-xs font-semibold"
                    disabled={loading || !text.trim()}
                  >
                    {loading && loadingMode === "baseline"
                      ? loadingMessage || "Saving..."
                      : "Save baseline"}
                  </button>
                  {baselineNotice && (
                    <span className="text-xs font-semibold text-obsidian/60">
                      {baselineNotice}
                    </span>
                  )}
                </div>

                <textarea
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  className="h-36 w-full rounded-2xl border border-obsidian/15 bg-white p-4 text-sm focus:outline-none focus:ring-2 focus:ring-signal/30"
                  placeholder="Paste requirements, one per line."
                />

                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={handleAnalyze}
                    className="rounded-full bg-signal px-6 py-3 text-sm font-semibold text-white shadow-glow"
                    disabled={loading}
                  >
                    {loading && loadingMode === "analyze"
                      ? loadingMessage || "Analyzing..."
                      : "Start Analysis"}
                  </button>
                  <button
                    onClick={() => setFile(null)}
                    className="rounded-full border border-obsidian/20 px-6 py-3 text-sm"
                  >
                    Clear file
                  </button>
                </div>

                {loading && loadingMode === "analyze" && (
                  <div className="flex items-center gap-2 text-xs font-semibold text-obsidian/60">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-signal" />
                    <span>{loadingMessage || "Processing"}</span>
                  </div>
                )}
                {error && <p className="text-sm text-rose">{error}</p>}
              </div>
            </div>

            <div className="card p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="section-title">Coverage Pulse</p>
                  <h3 className="font-display text-xl">OOTB readiness snapshot</h3>
                </div>
                <span className="rounded-full bg-mint/20 px-3 py-1 text-xs font-semibold text-mint">
                  {summary.total ? `${summary.total} reqs` : "No data"}
                </span>
              </div>
              <div className="mt-4 grid gap-3 text-sm">
                <div className="flex justify-between rounded-2xl bg-obsidian/5 px-4 py-3">
                  <span>Total Requirements</span>
                  <span className="font-semibold text-obsidian">{summary.total}</span>
                </div>
                <div className="flex justify-between rounded-2xl bg-obsidian/5 px-4 py-3">
                  <span>OOTB Match</span>
                  <span className="font-semibold text-mint">{summary.oob}</span>
                </div>
                <div className="flex justify-between rounded-2xl bg-obsidian/5 px-4 py-3">
                  <span>Partial Match</span>
                  <span className="font-semibold text-amber">{summary.partial}</span>
                </div>
                <div className="flex justify-between rounded-2xl bg-obsidian/5 px-4 py-3">
                  <span>Custom Dev Required</span>
                  <span className="font-semibold text-signal">{summary.custom}</span>
                </div>
                <div className="flex justify-between rounded-2xl bg-obsidian/5 px-4 py-3">
                  <span>Open Questions</span>
                  <span className="font-semibold text-rose">{summary.open}</span>
                </div>
              </div>
              <button
                onClick={handleGenerate}
                disabled={loading || results.length === 0}
                className="mt-6 w-full rounded-full bg-obsidian px-6 py-3 text-sm font-semibold text-white"
              >
                {loading && loadingMode === "generate"
                  ? loadingMessage || "Generating..."
                  : "Generate FSD Draft"}
              </button>
            </div>

            <div className="card p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="section-title">Functional Specification Document</p>
                  <h3 className="font-display text-xl">FSD Executive Preview</h3>
                </div>
                <div className="flex gap-2">
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
                    className="rounded-full bg-obsidian px-4 py-2 text-xs font-semibold text-white"
                  >
                    {loading && loadingMode === "download"
                      ? loadingMessage || "Preparing..."
                      : "Download .docx"}
                  </button>
                </div>
              </div>
              <div className="mt-4 grid gap-4 lg:grid-cols-[0.35fr_1fr]">
                <div className="rounded-2xl border border-obsidian/10 bg-obsidian/5 p-3 text-xs">
                  {[
                    "Overview",
                    "OOTB Coverage",
                    "Partial",
                    "Custom",
                    "Assumptions",
                    "Open Questions",
                    "Effort",
                  ].map((item, idx) => (
                    <div
                      key={item}
                      className={`flex items-center gap-2 rounded-xl px-3 py-2 text-obsidian/70 ${
                        idx === 0 ? "bg-white font-semibold" : ""
                      }`}
                    >
                      <span className="h-2 w-2 rounded-full bg-signal/40" />
                      {item}
                    </div>
                  ))}
                </div>
                <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-2xl border border-obsidian/10 bg-white p-4 text-sm text-obsidian/80">
                  {fsd || "Generate the FSD to view it here."}
                </pre>
              </div>
            </div>
          </div>

          <div className="grid gap-6">
            <div className="card p-6">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="section-title">Gap Analysis Results</p>
                  <h2 className="font-display text-2xl">Confidence-ranked coverage</h2>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-obsidian/60">
                  <span className="rounded-full border border-obsidian/10 px-3 py-1">
                    Auto-ranked by impact
                  </span>
                  <span className="rounded-full border border-obsidian/10 px-3 py-1">Evidence-linked</span>
                  <button
                    onClick={() => setShowDebug((prev) => !prev)}
                    className="rounded-full border border-obsidian/10 px-3 py-1 text-xs"
                  >
                    {showDebug ? "Hide debug" : "Show debug"}
                  </button>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <div className="flex flex-1 items-center gap-2 rounded-full border border-obsidian/15 bg-white px-4 py-2 text-sm">
                  <span className="text-obsidian/40">??</span>
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    className="w-full bg-transparent outline-none"
                    placeholder="Search requirements..."
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
                  <span className="rounded-full border border-obsidian/10 px-3 py-1">All</span>
                  <span className="rounded-full bg-mint/20 px-3 py-1 text-mint">OOTB</span>
                  <span className="rounded-full bg-amber/20 px-3 py-1 text-amber">Partial</span>
                  <span className="rounded-full bg-signal/20 px-3 py-1 text-signal">Custom</span>
                </div>
              </div>

              <div className="mt-4 grid gap-3">
                {baselineSummary && (
                  <div className="rounded-2xl border border-obsidian/10 bg-obsidian/5 p-4 text-xs text-obsidian/60">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold text-obsidian/80">
                        Baseline: {baselineSummary.name}
                      </span>
                      {baselineSummary.created_at && <span>Saved: {baselineSummary.created_at}</span>}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      <span>Added: {baselineSummary.added}</span>
                      <span>Changed: {baselineSummary.changed}</span>
                      <span>Unchanged: {baselineSummary.unchanged}</span>
                      <span>Removed: {baselineSummary.removed}</span>
                    </div>
                  </div>
                )}
                {baselineRemoved.length > 0 && (
                  <div className="rounded-2xl border border-obsidian/10 bg-obsidian/5 p-4 text-xs text-obsidian/60">
                    <div className="font-semibold text-obsidian/80">Removed from baseline</div>
                    <div className="mt-2 grid gap-2">
                      {baselineRemoved.map((item, idx) => (
                        <div key={`removed-${idx}`} className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full border border-obsidian/10 px-2 py-0.5 text-[0.6rem]">
                            Removed
                          </span>
                          <span>{item.requirement || "n/a"}</span>
                          {item.classification && (
                            <span className="text-[0.6rem] uppercase tracking-[0.2em] text-obsidian/50">
                              {item.classification}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="rounded-2xl border border-obsidian/10 bg-white">
                  <div className="sticky top-0 z-10 grid grid-cols-[1.7fr_0.7fr_0.7fr] items-center gap-4 border-b border-obsidian/10 bg-white/95 px-5 py-3 text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-obsidian/50 backdrop-blur">
                    <span>Requirement</span>
                    <span className="text-center">Classification</span>
                    <span className="text-right">Confidence</span>
                  </div>
                  <div className="max-h-[360px] overflow-auto">
                    {filteredResults.length === 0 && (
                      <p className="px-5 py-6 text-sm text-obsidian/60">
                        Run the analysis to surface strategic gaps.
                      </p>
                    )}
                    {filteredResults.map((item, index) => {
                      const sources = getSources(item);
                      const similarityPct =
                        item.similarity_score != null ? Math.round(item.similarity_score * 100) : 0;

                      return (
                        <div
                          key={`${item.requirement}-${index}`}
                          className="border-b border-obsidian/10 px-5 py-4 last:border-b-0 hover:bg-obsidian/5"
                        >
                          <div className="grid grid-cols-[1.7fr_0.7fr_0.7fr] items-start gap-4">
                            <div>
                              <p className="text-sm font-semibold text-obsidian">
                                {item.requirement}
                              </p>
                              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-obsidian/60">
                                {sources.length > 0 ? (
                                  sources.map((source) => (
                                    <a
                                      key={source.url}
                                      href={source.url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="rounded-full border border-obsidian/10 px-3 py-1 text-obsidian/70 hover:text-obsidian"
                                    >
                                      {source.title}
                                    </a>
                                  ))
                                ) : (
                                  <span className="rounded-full border border-obsidian/10 px-3 py-1 text-obsidian/50">
                                    No sources yet
                                  </span>
                                )}
                              </div>
                              {item.baseline_status && item.baseline_status !== "new" && (
                                <div className="mt-2 flex flex-wrap items-center gap-2 text-[0.7rem] text-obsidian/60">
                                  <span>Baseline: {item.baseline_classification || "n/a"}</span>
                                  {item.baseline_confidence != null && (
                                    <span>({Math.round(item.baseline_confidence * 100)}%)</span>
                                  )}
                                  {item.baseline_status === "changed" && item.baseline_requirement && (
                                    <span>Changed from: "{item.baseline_requirement}"</span>
                                  )}
                                </div>
                              )}
                            </div>
                            <div className="flex flex-col items-center gap-2">
                              {item.baseline_status && (
                                <span className={`badge ${baselineTone(item.baseline_status)}`}>
                                  {item.baseline_status}
                                </span>
                              )}
                              <span className={`badge ${badgeTone(item.classification)}`}>
                                {item.classification}
                              </span>
                            </div>
                            <div className="flex flex-col items-end gap-2 text-sm text-obsidian/70">
                              <div className="flex items-center justify-end gap-3">
                                <div
                                  className="relative h-10 w-10 rounded-full"
                                  style={{
                                    background: `conic-gradient(#0b0f14 ${Math.round(
                                      item.confidence * 100
                                    )}%, rgba(11, 15, 20, 0.12) 0)`,
                                  }}
                                >
                                  <div className="absolute inset-1 rounded-full bg-white" />
                                  <div className="absolute inset-0 flex items-center justify-center text-[0.65rem] font-semibold text-obsidian">
                                    {(item.confidence * 100).toFixed(0)}%
                                  </div>
                                </div>
                                <div className="text-right">
                                  <span className="text-base font-semibold text-obsidian">
                                    {(item.confidence * 100).toFixed(0)}%
                                  </span>
                                  <div className="text-[0.7rem] text-obsidian/50">Confidence</div>
                                </div>
                              </div>
                              <span className="text-xs text-obsidian/50">
                                Similarity {similarityPct}%
                              </span>
                            </div>
                          </div>
                          {showDebug && (
                            <div className="mt-3 rounded-2xl border border-obsidian/10 bg-obsidian/5 p-3 text-xs text-obsidian/60">
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
                              <div className="mt-2 text-[0.7rem] text-obsidian/50">LLM response</div>
                              <div className="mt-1 whitespace-pre-wrap text-[0.75rem] text-obsidian/70">
                                {item.llm_response || "n/a"}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            <div className="card p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="section-title">Export & Save FSD</p>
                  <h3 className="font-display text-xl">Share outputs with stakeholders</h3>
                </div>
                <button
                  onClick={handleDownloadDocx}
                  disabled={loading || results.length === 0}
                  className="rounded-full bg-signal px-4 py-2 text-xs font-semibold text-white"
                >
                  Download as Word
                </button>
              </div>
              <div className="mt-4 rounded-3xl border border-obsidian/10 bg-obsidian/5 p-6 text-center">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-mint/20 text-2xl">
                  ?
                </div>
                <h4 className="mt-4 text-lg font-semibold">FSD Export Ready</h4>
                <p className="mt-2 text-sm text-obsidian/60">
                  Generate and download the executive-ready Word document.
                </p>
                <button
                  onClick={handleDownloadDocx}
                  disabled={loading || results.length === 0}
                  className="mt-4 rounded-full bg-obsidian px-6 py-2 text-sm font-semibold text-white"
                >
                  {loading && loadingMode === "download"
                    ? loadingMessage || "Preparing..."
                    : "Export Now"}
                </button>
              </div>
              <div className="mt-4 grid gap-2 text-xs text-obsidian/60">
                <div className="flex items-center justify-between rounded-2xl border border-obsidian/10 bg-white px-4 py-3">
                  <span>FSD exported successfully</span>
                  <span>Just now</span>
                </div>
                <div className="flex items-center justify-between rounded-2xl border border-obsidian/10 bg-white px-4 py-3">
                  <span>Baseline snapshot saved</span>
                  <span>Today</span>
                </div>
                <div className="flex items-center justify-between rounded-2xl border border-obsidian/10 bg-white px-4 py-3">
                  <span>Confluence evidence linked</span>
                  <span>Today</span>
                </div>
              </div>
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}

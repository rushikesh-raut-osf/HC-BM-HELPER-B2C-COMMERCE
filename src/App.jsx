import { useMemo, useState, useEffect } from "react";

const BASELINE = {
  baselineName: "SFRA OOTB (Prototype Baseline)",
  features: [
    {
      id: "search",
      component: "Search",
      description: "Site search with suggestions and results filtering",
      keywords: ["search", "suggestions", "results", "filter", "category"]
    },
    {
      id: "plp",
      component: "Product Listing Page",
      description: "PLP with pagination, sorting, and refinements",
      keywords: ["plp", "listing", "pagination", "sorting", "refinement", "filters"]
    },
    {
      id: "pdp",
      component: "Product Detail Page",
      description: "PDP with variants, pricing, and add to cart",
      keywords: ["pdp", "product detail", "variants", "price", "add to cart"]
    },
    {
      id: "cart",
      component: "Cart",
      description: "Cart with quantity updates, promotions, and shipping estimates",
      keywords: ["cart", "quantity", "promotion", "shipping", "estimate"]
    },
    {
      id: "checkout",
      component: "Checkout",
      description: "Multi-step checkout with shipping and payment",
      keywords: ["checkout", "shipping", "payment", "address", "review"]
    },
    {
      id: "account",
      component: "Account",
      description: "Account registration, login, and profile management",
      keywords: ["account", "login", "register", "profile", "password"]
    },
    {
      id: "wishlist",
      component: "Wishlist",
      description: "Wishlist for saved items across sessions",
      keywords: ["wishlist", "saved items", "favorites", "wish list"]
    },
    {
      id: "promotions",
      component: "Promotions",
      description: "Promotions and discounts engine",
      keywords: ["promotion", "discount", "coupon", "deal", "campaign"]
    },
    {
      id: "inventory",
      component: "Inventory",
      description: "Inventory availability and backorder logic",
      keywords: ["inventory", "availability", "backorder", "stock", "in stock"]
    },
    {
      id: "orders",
      component: "Order History",
      description: "Customer order history and order details",
      keywords: ["order history", "order details", "reorder", "previous orders"]
    },
    {
      id: "returns",
      component: "Returns",
      description: "Returns flow with RMA and status tracking",
      keywords: ["returns", "rma", "refund", "return status"]
    },
    {
      id: "store-locator",
      component: "Store Locator",
      description: "Store locator with map and distance filters",
      keywords: ["store locator", "map", "distance", "pickup store"]
    },
    {
      id: "shipping-methods",
      component: "Shipping Methods",
      description: "Shipping methods including standard and express",
      keywords: ["shipping methods", "standard shipping", "express shipping"]
    },
    {
      id: "payments",
      component: "Payments",
      description: "Payment methods including credit cards and wallets",
      keywords: ["payment", "credit card", "apple pay", "wallet", "paypal"]
    },
    {
      id: "analytics",
      component: "Analytics",
      description: "Basic analytics events for funnels and conversion",
      keywords: ["analytics", "tracking", "events", "conversion"]
    }
  ]
};

const SAMPLE_INPUT = `Customer wants a wishlist on PDP and account.
PLP needs infinite scroll and custom sorting.
Checkout must support Apple Pay and gift messages.
Add store locator with map view.
Show inventory availability on PDP and cart.
Allow coupon stacking and promotion rules by customer group.`;

const normalizeLine = (line) => line.trim().replace(/^[-*.\\d)\\s]+/, "");

const extractEntries = (text) => {
  if (!text) return [];
  const lines = text
    .split(/\\r?\\n/)
    .map((line) => normalizeLine(line))
    .filter((line) => line.length > 3);
  if (lines.length > 0) return lines;

  return text
    .split(/\\.+\\s+/)
    .map((line) => normalizeLine(line))
    .filter((line) => line.length > 3);
};

const findBestMatch = (entry, baseline) => {
  const lowered = entry.toLowerCase();
  let best = null;
  let bestScore = 0;
  let matchedKeywords = [];
  for (const feature of baseline.features) {
    let score = 0;
    const localMatches = [];
    for (const keyword of feature.keywords) {
      if (lowered.includes(keyword.toLowerCase())) {
        score += 1;
        localMatches.push(keyword);
      }
    }
    if (score > bestScore) {
      bestScore = score;
      best = feature;
      matchedKeywords = localMatches;
    }
  }
  if (!best) return null;
  return { feature: best, score: bestScore, matchedKeywords };
};

const inferImpact = (type, text) => {
  if (type === "New") return "High";
  if (type === "Removed") return "Low";
  const lowered = text.toLowerCase();
  if (lowered.includes("custom") || lowered.includes("new") || lowered.includes("replace")) {
    return "High";
  }
  return "Medium";
};

const buildReport = (text) => {
  const entries = extractEntries(text);
  const matchedIds = new Set();
  const deviations = [];

  for (const entry of entries) {
    const match = findBestMatch(entry, BASELINE);
    if (match) {
      matchedIds.add(match.feature.id);
      deviations.push({
        type: "Modified",
        component: match.feature.component,
        description: entry,
        impact: inferImpact("Modified", entry),
        matches: match.matchedKeywords
      });
    } else {
      deviations.push({
        type: "New",
        component: "Unmapped",
        description: entry,
        impact: inferImpact("New", entry),
        matches: []
      });
    }
  }

  for (const feature of BASELINE.features) {
    if (!matchedIds.has(feature.id)) {
      deviations.push({
        type: "Removed",
        component: feature.component,
        description: feature.description,
        impact: inferImpact("Removed", feature.description),
        matches: []
      });
    }
  }

  const counts = deviations.reduce(
    (acc, item) => {
      acc.total += 1;
      acc[item.type] += 1;
      return acc;
    },
    { total: 0, New: 0, Modified: 0, Removed: 0 }
  );

  return {
    baseline: BASELINE.baselineName,
    counts,
    deviations
  };
};

const buildChangeReport = (previous, current) => {
  const previousReport = buildReport(previous);
  const currentReport = buildReport(current);

  const previousSet = new Set(
    previousReport.deviations.map((item) => `${item.type}::${item.component}::${item.description}`)
  );
  const currentSet = new Set(
    currentReport.deviations.map((item) => `${item.type}::${item.component}::${item.description}`)
  );

  const changes = [];
  for (const item of currentReport.deviations) {
    const key = `${item.type}::${item.component}::${item.description}`;
    if (!previousSet.has(key)) {
      changes.push({
        type: "New",
        component: item.component,
        description: item.description,
        impact: item.impact,
        rationale: "Added compared to previous snapshot"
      });
    }
  }

  for (const item of previousReport.deviations) {
    const key = `${item.type}::${item.component}::${item.description}`;
    if (!currentSet.has(key)) {
      changes.push({
        type: "Removed",
        component: item.component,
        description: item.description,
        impact: item.impact,
        rationale: "Removed compared to previous snapshot"
      });
    }
  }

  const counts = changes.reduce(
    (acc, item) => {
      acc.total += 1;
      acc[item.type] += 1;
      return acc;
    },
    { total: 0, New: 0, Modified: 0, Removed: 0 }
  );

  return {
    baseline: "Previous FSD vs Current FSD",
    counts,
    deviations: changes
  };
};

const buildFsdDraft = (report) => {
  const lines = [];
  lines.push("# FSD Draft (Auto)");
  lines.push("");
  lines.push(`Baseline: ${report.baseline}`);
  lines.push("");
  lines.push("## Deviations Summary");
  lines.push(`- Total: ${report.counts.total}`);
  lines.push(`- New: ${report.counts.New}`);
  lines.push(`- Modified: ${report.counts.Modified}`);
  lines.push(`- Removed: ${report.counts.Removed}`);
  lines.push("");
  lines.push("## Deviations Detail");
  for (const item of report.deviations) {
    lines.push(`- [${item.type}] ${item.component}: ${item.description} (Impact: ${item.impact})`);
  }
  lines.push("");
  lines.push("## Functional Requirements");
  lines.push("- TBD: Expand into full sections by component.");
  return lines.join("\\n");
};

const buildRationale = (item) => {
  if (item.type === "New") return "Not in baseline";
  if (item.type === "Removed") return "Baseline feature not requested";
  return "Baseline matched but modified";
};

const loadHistory = () => {
  try {
    return JSON.parse(localStorage.getItem("deviation-history")) || [];
  } catch (error) {
    return [];
  }
};

export default function App() {
  const [inputText, setInputText] = useState("");
  const [previousText, setPreviousText] = useState("");
  const [generateFsd, setGenerateFsd] = useState(true);
  const [compareEnabled, setCompareEnabled] = useState(false);
  const [report, setReport] = useState(null);
  const [viewLabel, setViewLabel] = useState("Baseline vs Current");
  const [history, setHistory] = useState(loadHistory());
  const [weights, setWeights] = useState({ High: 5, Medium: 3, Low: 1 });

  useEffect(() => {
    localStorage.setItem("deviation-history", JSON.stringify(history));
  }, [history]);

  const estimateTotal = useMemo(() => {
    if (!report) return 0;
    return report.deviations.reduce((sum, item) => {
      return sum + (weights[item.impact] ?? 0);
    }, 0);
  }, [report, weights]);

  const onAnalyze = () => {
    if (compareEnabled) {
      const nextReport = buildChangeReport(previousText, inputText);
      setReport(nextReport);
      setViewLabel("Previous vs Current");
    } else {
      const nextReport = buildReport(inputText);
      setReport(nextReport);
      setViewLabel("Baseline vs Current");
    }
  };

  const onClear = () => {
    setInputText("");
    setPreviousText("");
    setReport(null);
    setViewLabel("Baseline vs Current");
  };

  const onSaveSnapshot = () => {
    if (!inputText.trim()) return;
    const snapshot = {
      id: `snap-${Date.now()}`,
      createdAt: new Date().toISOString(),
      text: inputText
    };
    setHistory((prev) => [snapshot, ...prev].slice(0, 10));
  };

  const onClearHistory = () => {
    setHistory([]);
  };

  const onExport = (filename, content, type) => {
    if (!report) return;
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main className="page">
      <header className="hero">
        <div>
          <p className="eyebrow">Prototype Demo</p>
          <h1>Discovery &amp; FSD Deviation Agent</h1>
          <p className="lede">
            Paste requirements, FSD notes, or design summaries. The engine compares against an SFRA
            baseline and generates a deviation report for estimation.
          </p>
        </div>
        <div className="hero-card">
          <div className="metric">
            <span className="metric-label">Baseline</span>
            <span className="metric-value">{BASELINE.baselineName}</span>
          </div>
          <div className="metric">
            <span className="metric-label">Total Deviations</span>
            <span className="metric-value">{report ? report.counts.total : 0}</span>
          </div>
        </div>
      </header>

      <section className="panel">
        <div className="panel-header">
          <h2>Input</h2>
          <div className="controls">
            <label className="toggle">
              <input
                type="checkbox"
                checked={generateFsd}
                onChange={(event) => setGenerateFsd(event.target.checked)}
              />
              <span>Generate FSD draft</span>
            </label>
            <button className="btn ghost" onClick={() => setInputText(SAMPLE_INPUT)}>
              Load sample
            </button>
            <button className="btn ghost" onClick={onClear}>
              Clear
            </button>
            <button className="btn primary" onClick={onAnalyze}>
              Analyze deviations
            </button>
          </div>
        </div>
        <textarea
          placeholder="One requirement per line works best."
          rows={10}
          value={inputText}
          onChange={(event) => setInputText(event.target.value)}
        />
        <p className="hint">
          Tip: include lines like “Add store locator with map view” or “Checkout must support Apple
          Pay” to see strong matches.
        </p>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Compare To Previous FSD</h2>
          <div className="controls">
            <label className="toggle">
              <input
                type="checkbox"
                checked={compareEnabled}
                onChange={(event) => setCompareEnabled(event.target.checked)}
              />
              <span>Enable comparison</span>
            </label>
            <button className="btn ghost" onClick={() => setPreviousText(inputText)}>
              Copy current → previous
            </button>
          </div>
        </div>
        <textarea
          placeholder="Paste a previous FSD or requirements snapshot here."
          rows={8}
          value={previousText}
          onChange={(event) => setPreviousText(event.target.value)}
        />
        <p className="hint">
          When enabled, deviations will be shown as changes between the previous and current input.
        </p>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Deviation Summary</h2>
          <div className="summary">
            <div className="pill new">
              <span>New</span>
              <strong>{report ? report.counts.New : 0}</strong>
            </div>
            <div className="pill modified">
              <span>Modified</span>
              <strong>{report ? report.counts.Modified : 0}</strong>
            </div>
            <div className="pill removed">
              <span>Removed</span>
              <strong>{report ? report.counts.Removed : 0}</strong>
            </div>
          </div>
        </div>
        <div className="panel-subtle">
          <span className="label">View</span>
          <strong>{viewLabel}</strong>
        </div>
        <div className="estimation-card">
          <div>
            <p className="eyebrow">Estimation Model</p>
            <p className="hint">Adjust weights to match your team’s sizing.</p>
          </div>
          <div className="estimation-inputs">
            <label>
              High
              <input
                type="number"
                min="0"
                step="1"
                value={weights.High}
                onChange={(event) =>
                  setWeights((prev) => ({ ...prev, High: Number(event.target.value || 0) }))
                }
              />
            </label>
            <label>
              Medium
              <input
                type="number"
                min="0"
                step="1"
                value={weights.Medium}
                onChange={(event) =>
                  setWeights((prev) => ({ ...prev, Medium: Number(event.target.value || 0) }))
                }
              />
            </label>
            <label>
              Low
              <input
                type="number"
                min="0"
                step="1"
                value={weights.Low}
                onChange={(event) =>
                  setWeights((prev) => ({ ...prev, Low: Number(event.target.value || 0) }))
                }
              />
            </label>
          </div>
          <div className="estimation-total">
            <span className="label">Estimated Points</span>
            <strong>{estimateTotal}</strong>
          </div>
        </div>

        <div className="table">
          <div className="table-head">
            <span>Type</span>
            <span>Component</span>
            <span>Description</span>
            <span>Rationale</span>
            <span>Estimate</span>
            <span>Impact</span>
          </div>
          <div className="table-body">
            {!report || report.deviations.length === 0 ? (
              <p className="empty">Run an analysis to see deviations.</p>
            ) : (
              report.deviations.map((item, index) => (
                <div key={`${item.type}-${index}`} className="table-row">
                  <span className={`badge ${item.type.toLowerCase()}`}>{item.type}</span>
                  <span>{item.component}</span>
                  <span>{item.description}</span>
                  <span>{item.rationale || buildRationale(item)}</span>
                  <span>{weights[item.impact] ?? 0}</span>
                  <span className={`badge ${item.impact.toLowerCase()}`}>{item.impact}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>FSD Draft (Auto)</h2>
          <div className="controls">
            <button
              className="btn ghost"
              onClick={() =>
                onExport(
                  "deviation-report.json",
                  JSON.stringify(report, null, 2),
                  "application/json"
                )
              }
            >
              Export JSON
            </button>
            <button
              className="btn ghost"
              onClick={() => onExport("fsd-draft.md", buildFsdDraft(report), "text/markdown")}
            >
              Export Markdown
            </button>
          </div>
        </div>
        <pre className="code-block">
          {report && generateFsd ? buildFsdDraft(report) : "No draft generated yet."}
        </pre>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Version History</h2>
          <div className="controls">
            <button className="btn ghost" onClick={onSaveSnapshot}>
              Save snapshot
            </button>
            <button className="btn ghost" onClick={onClearHistory}>
              Clear history
            </button>
          </div>
        </div>
        <div className="history-list">
          {history.length === 0 ? (
            <p className="empty">No saved snapshots yet.</p>
          ) : (
            history.map((snap) => {
              const date = new Date(snap.createdAt);
              const preview = snap.text.split(/\\r?\\n/).slice(0, 3).join(" ");
              return (
                <div className="history-item" key={snap.id}>
                  <div className="history-meta">Saved {date.toLocaleString()}</div>
                  <div>{preview}</div>
                  <div className="history-actions">
                    <button className="btn ghost" onClick={() => setInputText(snap.text)}>
                      Load into current
                    </button>
                    <button
                      className="btn ghost"
                      onClick={() => {
                        setPreviousText(snap.text);
                        setCompareEnabled(true);
                      }}
                    >
                      Compare vs current
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>
    </main>
  );
}

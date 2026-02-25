const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";

export type GapResult = {
  requirement: string;
  classification: string;
  confidence: number;
  rationale: string;
  top_chunks: Array<{
    text: string;
    metadata: Record<string, string | number | null>;
    score: number;
  }>;
  similarity_score?: number | null;
  llm_confidence?: number | null;
  llm_response?: string | null;
  baseline_status?: string | null;
  baseline_requirement?: string | null;
  baseline_classification?: string | null;
  baseline_confidence?: number | null;
  baseline_similarity?: number | null;
};

export type BaselineSummary = {
  name: string;
  created_at?: string | null;
  added: number;
  changed: number;
  unchanged: number;
  removed: number;
};

export type BaselineRemovedItem = {
  requirement?: string | null;
  classification?: string | null;
  confidence?: number | null;
};

export async function analyzeRequirementsText(text: string, baselineName?: string) {
  const res = await fetch(`${API_BASE}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requirements_text: text, baseline_name: baselineName }),
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json() as Promise<{
    total: number;
    results: GapResult[];
    baseline?: BaselineSummary | null;
    baseline_removed?: BaselineRemovedItem[] | null;
  }>;
}

export async function analyzeRequirementsFile(file: File) {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_BASE}/analyze-file`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json() as Promise<{ total: number; results: GapResult[] }>;
}

export async function saveBaseline(name: string, text: string) {
  const res = await fetch(`${API_BASE}/save-baseline`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ baseline_name: name, requirements_text: text }),
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json() as Promise<{ name: string; created_at: string; total: number }>;
}

export async function generateFsd(results: GapResult[]) {
  const res = await fetch(`${API_BASE}/generate-fsd`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ gap_results: results }),
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json() as Promise<{ fsd: string }>;
}

export async function generateFsdDocx(results: GapResult[]) {
  const res = await fetch(`${API_BASE}/generate-fsd-docx`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ gap_results: results }),
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.blob();
}

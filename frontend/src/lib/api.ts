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
};

export async function analyzeRequirementsText(text: string) {
  const res = await fetch(`${API_BASE}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requirements_text: text }),
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json() as Promise<{ total: number; results: GapResult[] }>;
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

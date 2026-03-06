const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";

export type GapResult = {
  requirement: string;
  classification: string;
  confidence: number;
  rationale: string;
  clarifying_questions?: string[] | null;
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

export type FollowupHistoryItem = {
  question: string;
  answer: string;
};

export type FollowupStepOption = {
  label: string;
  recommended: boolean;
};

export type FollowupStepResponse = {
  question: string;
  options: FollowupStepOption[];
  allow_custom: boolean;
  is_terminal: boolean;
};

export type ConfluenceSpace = {
  key: string;
  name: string;
};

export type ConfluenceFolder = {
  id: string;
  title: string;
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

export async function analyzeSingleRequirement(text: string) {
  const res = await fetch(`${API_BASE}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requirements_list: [text] }),
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

export async function fetchFollowupStep(
  requirement: string,
  history: FollowupHistoryItem[],
  stepIndex: number,
  maxSteps = 3
) {
  const res = await fetch(`${API_BASE}/requirements/followup-step`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requirement,
      history,
      step_index: stepIndex,
      max_steps: maxSteps,
    }),
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json() as Promise<FollowupStepResponse>;
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
  return res.json() as Promise<{
    total: number;
    results: GapResult[];
    baseline?: BaselineSummary | null;
    baseline_removed?: BaselineRemovedItem[] | null;
  }>;
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

export async function generateFsdDocxFromText(fsdText: string) {
  const res = await fetch(`${API_BASE}/generate-fsd-docx-text`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fsd_text: fsdText }),
  });
  if (res.status === 404) {
    throw new Error("FSD_TEXT_EXPORT_NOT_FOUND");
  }
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.blob();
}

export async function fetchConfluenceSpaces() {
  const res = await fetch(`${API_BASE}/confluence/spaces`);
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json() as Promise<ConfluenceSpace[]>;
}

export async function fetchConfluenceFolders(spaceKey: string) {
  const res = await fetch(`${API_BASE}/confluence/folders/${encodeURIComponent(spaceKey)}`);
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json() as Promise<ConfluenceFolder[]>;
}

export async function checkConfluenceDuplicate(spaceKey: string, parentId: string, title: string) {
  const res = await fetch(`${API_BASE}/confluence/check-duplicate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ space_key: spaceKey, parent_id: parentId, title }),
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json() as Promise<{ exists: boolean; page_id?: string | null }>;
}

export async function saveFsdToConfluence(
  results: GapResult[],
  spaceKey: string,
  parentId: string,
  title: string
) {
  const res = await fetch(`${API_BASE}/confluence/save-fsd`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      gap_results: results,
      space_key: spaceKey,
      parent_id: parentId,
      title,
    }),
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json() as Promise<{ page_id: string; title: string; url: string }>;
}

export async function saveFsdTextToConfluence(
  fsdText: string,
  spaceKey: string,
  parentId: string,
  title: string
) {
  const res = await fetch(`${API_BASE}/confluence/save-fsd-text`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fsd_text: fsdText,
      space_key: spaceKey,
      parent_id: parentId,
      title,
    }),
  });
  if (res.status === 404) {
    throw new Error("FSD_TEXT_SAVE_NOT_FOUND");
  }
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json() as Promise<{ page_id: string; title: string; url: string }>;
}

export async function ingestConfluence() {
  const res = await fetch(`${API_BASE}/ingest-confluence`, {
    method: "POST",
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json() as Promise<{ pages: number; chunks: number }>;
}

export type IngestStartResponse = {
  job_id: string;
  status: string;
};

export type IngestSourceLink = {
  url: string;
  note?: string;
};

export type IngestStartRequest = {
  baseline_links?: IngestSourceLink[];
  include_confluence?: boolean;
  crawl_depth?: number;
  max_pages?: number;
};

export type IngestStatusResponse = {
  job_id: string;
  status: "queued" | "running" | "completed" | "failed";
  stage?: string | null;
  progress: number;
  pages_total: number;
  pages_processed: number;
  pages_indexed: number;
  pages_skipped: number;
  web_pages_indexed?: number;
  web_pages_skipped?: number;
  chunks: number;
  started_at?: number | null;
  finished_at?: number | null;
  error?: string | null;
};

export async function startConfluenceIngest(payload?: IngestStartRequest) {
  const res = await fetch(`${API_BASE}/ingest-confluence/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {}),
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json() as Promise<IngestStartResponse>;
}

export async function getConfluenceIngestStatus(jobId: string) {
  const res = await fetch(`${API_BASE}/ingest-confluence/status/${encodeURIComponent(jobId)}`);
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json() as Promise<IngestStatusResponse>;
}

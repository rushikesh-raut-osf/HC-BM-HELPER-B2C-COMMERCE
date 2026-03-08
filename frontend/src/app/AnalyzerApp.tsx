/* eslint-disable react/no-unescaped-entities */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import MDEditor from "@uiw/react-md-editor";
import {
  ConfluenceFolder,
  IngestStatusResponse,
  ConfluenceSpace,
  FollowupStepOption,
  FollowupStepResponse,
  GapResult,
  analyzeSingleRequirement,
  checkConfluenceDuplicate,
  fetchFollowupStep,
  fetchConfluenceFolders,
  fetchConfluenceSpaces,
  generateFsd,
  generateFsdDocx,
  generateFsdDocxFromText,
  ingestConfluence,
  getConfluenceIngestStatus,
  fetchWorkspaceState,
  saveWorkspaceState,
  startConfluenceIngest,
  saveFsdToConfluence,
  saveFsdTextToConfluence,
} from "@/lib/api";

type UploadState = "uploaded";

type AttachmentMeta = {
  id: string;
  name: string;
  size: number;
  type: string;
  uploadedAt: string;
  uploadState: UploadState;
};

type FsdSidebarItem = {
  id: string;
  messageId: string;
  createdAt: string;
  pinned: boolean;
  requirementText: string;
  clarifications: Array<{ question: string; answer: string }>;
  finalSummary: string;
  response: string;
  evidence: Array<{ title: string; url?: string; source?: string; sourceId?: string; score?: number }>;
  effort: "Short" | "Medium" | "Long";
  requirements: string[];
  classifications: string[];
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  createdAt: string;
  text: string;
  kind?: "normal" | "guided_prompt" | "guided_answer" | "analysis_result";
  cycleId?: string;
  detailedResult?: {
    classification: string;
    why: string;
    confidence: number;
    implementationMode?: string | null;
    coverageStatus?: string | null;
    projectMatchStatus?: string | null;
    gaps?: string[] | null;
    sfraBaselineReference?: { sentence: string; url?: string; title?: string } | null;
    references: Array<{ title: string; url?: string; source?: string; sourceId?: string; score?: number }>;
  };
  attachments?: AttachmentMeta[];
  analysisResults?: GapResult[];
};

type GuidedAnswer = {
  question: string;
  answer: string;
  source: "option" | "custom";
};

type GuidedCycle = {
  id: string;
  baseRequirement: string;
  status: "guided" | "analyzing" | "analyzed" | "cancelled";
  currentStepIndex: number;
  maxSteps: number;
  currentQuestion?: string;
  currentOptions?: FollowupStepOption[];
  answers: GuidedAnswer[];
  isTerminal?: boolean;
};

type ChatThread = {
  id: string;
  title: string;
  updatedAt: string;
  projectTag?: string | null;
  messages: ChatMessage[];
};

type DataSourceLink = {
  id: string;
  url: string;
  note: string;
};

const ANALYSIS_STEPS = [
  "Analyzing scope",
  "Mapping Baseline Requirements",
  "Comparing Project FSD",
  "Finalizing",
];

const STARTER_PROMPTS = [
  "Add a recommended product carousel on homepage using Einstein data.",
  "Enable configurable image carousel in homepage with PNG/JPEG/SVG support.",
  "Add checkout address validation with clear error handling requirements.",
];

const GUIDED_MAX_STEPS = 3;
const DATA_SOURCE_STORAGE_KEY = "scout.dataSources.v1";
const DEFAULT_PROJECT_NAME = "General";
const DEFAULT_BASELINE_LINKS: DataSourceLink[] = [
  {
    id: "sfcc-rhino-inquisitor",
    url: "https://www.rhino-inquisitor.com/salesforce-b2c-commerce-cloud-documentation/",
    note: "Complete SFCC documentation overview. Crawl navigation and related in-content links.",
  },
  {
    id: "sfcc-help-overview",
    url: "https://help.salesforce.com/s/articleView?id=cc.b2c_getting_started.htm&type=5",
    note: "B2C Commerce overview baseline. crawl complete TOC hierarchy, subpages, and related links.",
  },
  {
    id: "sfcc-infocenter",
    url: "https://sfcclearning.com/infocenter/",
    note: "Supplementary infocenter baseline. Crawl section navigation and linked related content.",
  },
  {
    id: "sfra-feature-list",
    url: "https://developer.salesforce.com/docs/commerce/sfra/guide/sfra-feature-list.html",
    note: "Primary SFRA feature coverage baseline; include linked SFRA subpages.",
  },
  {
    id: "bm-merchandising",
    url: "https://help.salesforce.com/s/articleView?id=cc.b2c_merchandising_your_site.htm&type=5",
    note: "Business Manager feature baseline; include related subpages.",
  },
  {
    id: "sfra-learn-more",
    url: "https://developer.salesforce.com/docs/commerce/sfra/guide/sfra-learn-more.html",
    note: "Technical implementation baseline; include linked SFRA technical pages.",
  },
];

const FALLBACK_GUIDED_STEPS: FollowupStepResponse[] = [
  {
    question: "What exact scope and page context should this requirement apply to?",
    options: [
      { label: "Homepage module only", recommended: true },
      { label: "PLP/PDP and homepage consistency", recommended: false },
      { label: "Site-wide reusable component", recommended: false },
    ],
    allow_custom: true,
    is_terminal: false,
  },
  {
    question: "What behavior or rule should be strictly enforced?",
    options: [
      { label: "Business Manager configurable behavior", recommended: true },
      { label: "Hardcoded implementation for launch speed", recommended: false },
      { label: "Configurable + validation safeguards", recommended: false },
    ],
    allow_custom: true,
    is_terminal: false,
  },
  {
    question: "What data source and acceptance criteria should drive this requirement?",
    options: [
      { label: "Use existing SFRA/OOTB source first", recommended: true },
      { label: "Use external/custom API integration", recommended: false },
      { label: "Need both OOTB and project-specific FSD mapping", recommended: false },
    ],
    allow_custom: true,
    is_terminal: true,
  },
];

const parseFollowUpReplyText = (text: string) => {
  const marker = "Reply to follow-up:";
  if (!text.startsWith(marker)) return null;
  const body = text.slice(marker.length).trim();
  const newlineIdx = body.indexOf("\n");
  if (newlineIdx < 0) return null;
  const question = body.slice(0, newlineIdx).trim();
  const answer = body.slice(newlineIdx + 1).trim();
  if (!question || !answer) return null;
  return { question, answer };
};

const ensureSentence = (text: string) => {
  const trimmed = text.trim();
  if (!trimmed) return "";
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
};

const cleanRequirementText = (text: string) => text.replace(/^Requirement:\s*/i, "").trim();

const splitRequirementContext = (text: string) => {
  const cleaned = cleanRequirementText(text);
  if (!cleaned) return { primary: "", extras: [] as string[] };
  const sentences = cleaned
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (sentences.length <= 1) {
    return { primary: cleaned, extras: [] as string[] };
  }
  return { primary: sentences[0], extras: sentences.slice(1) };
};

const buildConsolidatedRequirementText = (baseRequirement: string, answers: GuidedAnswer[]) => {
  const lines: string[] = [];
  if (answers.length === 0) {
    lines.push(`Requirement: ${ensureSentence(baseRequirement)}`);
  } else {
    lines.push("Clarifications:");
    answers.forEach((entry, index) => {
      lines.push(`Q${index + 1}: ${entry.question}`);
      lines.push(`A${index + 1}: ${entry.answer}`);
    });
  }
  const summary = answers.map((entry) => entry.answer.trim()).filter(Boolean).join(" ");
  if (summary) {
    lines.push("");
    lines.push(`Final context summary: ${summary}`);
  }
  return lines.join("\n");
};

const parseConsolidatedClarifications = (text: string) => {
  const sourceText = text.replace(/\r/g, "").trim();
  if (!sourceText) return null;

  const normalized = sourceText.replace(/\n+/g, " ").replace(/\s+/g, " ").trim();
  const summaryCutoff = normalized.search(/final\s+context\s+summary\s*:/i);
  const qaScope = (summaryCutoff >= 0 ? normalized.slice(0, summaryCutoff) : normalized).trim();

  const qaByIndex = new Map<string, { question?: string; answer?: string }>();
  const tokenRegex = /(?:^|\s)(Q|A)\s*(\d+)\s*:\s*/gi;
  const matches = Array.from(qaScope.matchAll(tokenRegex));

  for (let i = 0; i < matches.length; i += 1) {
    const match = matches[i];
    const kind = (match[1] || "").toUpperCase();
    const idx = match[2] || "";
    const start = (match.index || 0) + match[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index || qaScope.length : qaScope.length;
    const content = qaScope.slice(start, end).trim();
    if (!kind || !idx || !content) continue;
    const current = qaByIndex.get(idx) || {};
    if (kind === "Q") current.question = content;
    else current.answer = content;
    qaByIndex.set(idx, current);
  }

  const pairs = Array.from(qaByIndex.entries())
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([, qa]) => ({
      question: qa.question?.trim() || "",
      answer: qa.answer?.trim() || "",
    }))
    .filter((entry) => entry.question || entry.answer);

  let summary = "";
  let summaryPoints: string[] = [];
  const summaryMatch = normalized.match(/final\s+context\s+summary\s*:\s*([\s\S]+)$/i);
  if (summaryMatch) {
    summary = summaryMatch[1].trim();
    summaryPoints = summary
      .split(/(?:\s*;\s*|\s+\|\s+|(?<=[.!?])\s+)/)
      .map((part) => part.trim())
      .filter(Boolean);
  }

  if (!pairs.length && !summary) return null;
  return { pairs, summary, summaryPoints };
};

const normalizeForMatch = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();

const estimateEffort = (text: string): "Short" | "Medium" | "Long" => {
  const length = text.trim().length;
  if (length < 260) return "Short";
  if (length < 650) return "Medium";
  return "Long";
};

const formatTime = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const firstMeaningfulLine = (text: string) => {
  const line = text
    .split("\n")
    .map((part) => part.trim())
    .find(Boolean);
  return line || "New scope discussion";
};

const classifyTone = (label: string) => {
  const normalized = label.toLowerCase();
  if (normalized.includes("ootb")) return "bg-mint/20 text-mint";
  if (normalized.includes("partial")) return "bg-amber/25 text-amber";
  if (normalized.includes("open")) return "bg-rose/20 text-rose";
  return "bg-signal/20 text-signal";
};

const confidenceToPercent = (value: number) => {
  if (!Number.isFinite(value)) return null;
  if (value <= 1) return Math.max(0, Math.min(100, Math.round(value * 100)));
  return Math.max(0, Math.min(100, Math.round(value)));
};

const classificationBadgeLabel = (classification: string, confidence: number) => {
  const percent = confidenceToPercent(confidence);
  if (!classification.toLowerCase().includes("partial") || percent === null) return classification;
  return `${classification} (${percent}%)`;
};

const prettyFlowValue = (value?: string | null) => {
  if (!value) return "Not available";
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
};

const tokenizeText = (value: string) =>
  value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2);

const lexicalOverlap = (a: string, b: string) => {
  const aTokens = new Set(tokenizeText(a));
  const bTokens = new Set(tokenizeText(b));
  if (!aTokens.size || !bTokens.size) return 0;
  let intersection = 0;
  aTokens.forEach((token) => {
    if (bTokens.has(token)) intersection += 1;
  });
  const union = new Set([...aTokens, ...bTokens]).size;
  return union ? intersection / union : 0;
};

const bestMatchingSentence = (requirement: string, text: string) => {
  const candidates = text
    .split(/[\n\r]+|(?<=[.!?])\s+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 20);
  if (!candidates.length) return "";
  let best = candidates[0];
  let bestScore = lexicalOverlap(requirement, best);
  for (const candidate of candidates.slice(1)) {
    const score = lexicalOverlap(requirement, candidate);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best.slice(0, 320);
};

const getSfraBaselineReference = (item?: GapResult) => {
  if (!item) return null;
  const requirement = item.requirement || "";
  let best:
    | {
        text: string;
        url?: string;
        title?: string;
        score: number;
      }
    | undefined;

  for (const chunk of item.top_chunks || []) {
    const meta = chunk.metadata || {};
    const source = typeof meta.source === "string" ? meta.source.toLowerCase() : "";
    const sourceId = typeof meta.source_id === "string" ? meta.source_id.toLowerCase() : "";
    const url = typeof meta.url === "string" ? meta.url : "";
    const isBaseline =
      source === "baseline_web" ||
      source === "sfcc" ||
      sourceId.includes("developer.salesforce.com/docs/commerce/sfra") ||
      url.toLowerCase().includes("developer.salesforce.com/docs/commerce/sfra");
    if (!isBaseline) continue;
    const text = typeof chunk.text === "string" ? chunk.text : "";
    const overlap = lexicalOverlap(requirement, text);
    const score = overlap + (typeof chunk.score === "number" ? chunk.score * 0.2 : 0);
    if (!best || score > best.score) {
      best = {
        text,
        url: url || undefined,
        title: typeof meta.title === "string" ? meta.title : undefined,
        score,
      };
    }
  }

  if (!best) return null;
  const sentence = bestMatchingSentence(requirement, best.text) || best.text.slice(0, 320);
  if (!sentence.trim()) return null;
  return { sentence: sentence.trim(), url: best.url, title: best.title };
};

const statusCounts = (results: GapResult[]) => {
  const counts = { total: results.length, ootb: 0, partial: 0, custom: 0, open: 0 };
  for (const item of results) {
    const label = item.classification.toLowerCase();
    if (label.includes("ootb")) counts.ootb += 1;
    else if (label.includes("partial")) counts.partial += 1;
    else if (label.includes("open")) counts.open += 1;
    else counts.custom += 1;
  }
  return counts;
};

const getSources = (item: GapResult) => {
  const seen = new Set<string>();
  const sources: Array<{ title: string; url?: string; source?: string; sourceId?: string; score?: number }> = [];
  for (const chunk of item.top_chunks || []) {
    const url = typeof chunk.metadata?.url === "string" ? chunk.metadata.url : "";
    const source = typeof chunk.metadata?.source === "string" ? chunk.metadata.source : "";
    const sourceId = typeof chunk.metadata?.source_id === "string" ? chunk.metadata.source_id : "";
    const dedupeKey = url || `${source}:${sourceId}`;
    if (!dedupeKey || seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    const title =
      (typeof chunk.metadata?.title === "string" && chunk.metadata.title) ||
      sourceId ||
      "Source page";
    sources.push({
      title,
      url: url || undefined,
      source: source || undefined,
      sourceId: sourceId || undefined,
      score: typeof chunk.score === "number" ? chunk.score : undefined,
    });
  }
  return sources;
};

const getProjectsFromResult = (item: GapResult) => {
  const projects = new Set<string>();
  for (const chunk of item.top_chunks || []) {
    const meta = chunk.metadata || {};
    const project = typeof meta.project === "string" ? meta.project : "";
    if (project.trim()) projects.add(project.trim());
  }
  return Array.from(projects);
};

const getProjectsFromThread = (thread: ChatThread) => {
  const projects = new Set<string>();
  if (thread.projectTag?.trim()) {
    projects.add(thread.projectTag.trim());
  }
  for (const message of thread.messages) {
    for (const item of message.analysisResults || []) {
      for (const project of getProjectsFromResult(item)) projects.add(project);
    }
  }
  return Array.from(projects);
};

const getPrimaryThreadProject = (thread: ChatThread) => thread.projectTag?.trim() || DEFAULT_PROJECT_NAME;

const lineToHeading = (line: string) => {
  const trimmed = line.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("#")) {
    return trimmed.replace(/^#{1,6}\s*/, "").trim();
  }
  if (trimmed.endsWith(":") && trimmed.length < 140) {
    return trimmed.slice(0, -1).trim();
  }
  return "";
};

const createThread = (seed?: string, projectTag?: string | null): ChatThread => {
  const now = new Date().toISOString();
  const title = seed ? firstMeaningfulLine(seed).slice(0, 60) : "New scope discussion";
  const normalizedProjectTag = projectTag?.trim() || DEFAULT_PROJECT_NAME;
  return {
    id: crypto.randomUUID(),
    title,
    updatedAt: now,
    projectTag: normalizedProjectTag,
    messages: [
      {
        id: crypto.randomUUID(),
        role: "assistant",
        createdAt: now,
        text: "Share your requirement scope. I will analyze SFRA coverage and highlight gaps.",
      },
    ],
  };
};

export default function AnalyzerApp() {
  const [threads, setThreads] = useState<ChatThread[]>([createThread()]);
  const [activeThreadId, setActiveThreadId] = useState<string>(threads[0].id);
  const [projects, setProjects] = useState<string[]>([]);
  const [composer, setComposer] = useState("");
  const [attachments, setAttachments] = useState<AttachmentMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [isChatAnalyzing, setIsChatAnalyzing] = useState(false);
  const [analysisStepIndex, setAnalysisStepIndex] = useState(0);
  const [error, setError] = useState("");
  const [actionNotice, setActionNotice] = useState("");
  const [isFsdPreviewOpen, setIsFsdPreviewOpen] = useState(false);
  const [fsdPreview, setFsdPreview] = useState("");
  const [fsdPreviewDraft, setFsdPreviewDraft] = useState("");
  const [isFsdPreviewEditing, setIsFsdPreviewEditing] = useState(false);
  const [fsdPreviewLoading, setFsdPreviewLoading] = useState(false);
  const [fsdSelectionsByThread, setFsdSelectionsByThread] = useState<Record<string, FsdSidebarItem[]>>({});
  const [addedMessageIdsByThread, setAddedMessageIdsByThread] = useState<Record<string, string[]>>({});

  const [isHistoryCollapsed, setIsHistoryCollapsed] = useState(false);
  const [isMobileHistoryOpen, setIsMobileHistoryOpen] = useState(false);
  const [isMobileSummaryOpen, setIsMobileSummaryOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [isDataSourceOpen, setIsDataSourceOpen] = useState(false);
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(true);
  const [isConfluenceModalOpen, setIsConfluenceModalOpen] = useState(false);
  const [confluenceLoading, setConfluenceLoading] = useState(false);
  const [confluenceSpaces, setConfluenceSpaces] = useState<ConfluenceSpace[]>([]);
  const [confluenceFolders, setConfluenceFolders] = useState<ConfluenceFolder[]>([]);
  const [confluenceSpaceKey, setConfluenceSpaceKey] = useState("");
  const [confluenceParentId, setConfluenceParentId] = useState("");
  const [confluenceTitle, setConfluenceTitle] = useState("");
  const [confluenceError, setConfluenceError] = useState("");
  const [confluenceDuplicateWarning, setConfluenceDuplicateWarning] = useState("");
  const [renamingThreadId, setRenamingThreadId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [renameProjectDraft, setRenameProjectDraft] = useState("");
  const [pendingDeleteThreadId, setPendingDeleteThreadId] = useState<string | null>(null);
  const [deletingThreadId, setDeletingThreadId] = useState<string | null>(null);
  const [introAnimationThreadId, setIntroAnimationThreadId] = useState<string | null>(null);
  const [guidedCycleByThread, setGuidedCycleByThread] = useState<Record<string, GuidedCycle | null>>({});
  const [guidedCustomDraft, setGuidedCustomDraft] = useState("");
  const [guidedLoading, setGuidedLoading] = useState(false);
  const [guidedBootstrapping, setGuidedBootstrapping] = useState(false);
  const [selectedGuidedOption, setSelectedGuidedOption] = useState<string>("");
  const [recentlyAddedToSidebar, setRecentlyAddedToSidebar] = useState<{
    threadId: string;
    messageId: string;
  } | null>(null);
  const [threadSearch, setThreadSearch] = useState("");
  const [projectFilter, setProjectFilter] = useState<string>("All");
  const [isAddProjectOpen, setIsAddProjectOpen] = useState(false);
  const [newProjectDraft, setNewProjectDraft] = useState("");
  const [newThreadTitleDraft, setNewThreadTitleDraft] = useState("");
  const [newThreadProjectDraft, setNewThreadProjectDraft] = useState("");
  const [expandedAnalysisKeys, setExpandedAnalysisKeys] = useState<Set<string>>(new Set());
  const [expandedSummaryItemIds, setExpandedSummaryItemIds] = useState<Set<string>>(new Set());
  const [baselineLinks, setBaselineLinks] = useState<DataSourceLink[]>(DEFAULT_BASELINE_LINKS);
  const [newBaselineUrl, setNewBaselineUrl] = useState("");
  const [newBaselineNote, setNewBaselineNote] = useState("");
  const [isIngestingDataSources, setIsIngestingDataSources] = useState(false);
  const [dataSourceError, setDataSourceError] = useState("");
  const [dataSourceNotice, setDataSourceNotice] = useState("");
  const [ingestProgress, setIngestProgress] = useState(0);
  const [ingestStartedAt, setIngestStartedAt] = useState<number | null>(null);
  const [ingestStatusText, setIngestStatusText] = useState("");
  const [ingestJobId, setIngestJobId] = useState<string | null>(null);
  const [sessionEmail, setSessionEmail] = useState("");
  const [workspaceLoaded, setWorkspaceLoaded] = useState(false);

  const historyDrawerRef = useRef<HTMLDivElement | null>(null);
  const summaryDrawerRef = useRef<HTMLDivElement | null>(null);
  const settingsMenuRef = useRef<HTMLDivElement | null>(null);
  const profileMenuRef = useRef<HTMLDivElement | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const ingestStatusPollRef = useRef<number | null>(null);
  const workspaceSyncTimerRef = useRef<number | null>(null);

  const activeThread = useMemo(
    () => threads.find((thread) => thread.id === activeThreadId) ?? threads[0],
    [threads, activeThreadId]
  );

  const latestAnalysisResults = useMemo(() => {
    const messages = activeThread?.messages || [];
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].analysisResults?.length) return messages[i].analysisResults || [];
    }
    return [] as GapResult[];
  }, [activeThread]);

  const isDiscussionIdle = useMemo(() => {
    const msgs = activeThread?.messages || [];
    if (msgs.length !== 1) return false;
    return msgs[0].role === "assistant" && !msgs[0].analysisResults?.length;
  }, [activeThread]);

  const activeGuidedCycle = useMemo(
    () => (activeThread ? guidedCycleByThread[activeThread.id] || null : null),
    [guidedCycleByThread, activeThread]
  );
  const isGuidedInputLocked = activeGuidedCycle?.status === "guided";

  const activeFsdSelections = useMemo(
    () => fsdSelectionsByThread[activeThreadId] || [],
    [fsdSelectionsByThread, activeThreadId]
  );
  const selectedGapResults = useMemo(() => {
    if (!activeThread) return [] as GapResult[];
    const deduped = new Map<string, GapResult>();
    const messageById = new Map(activeThread.messages.map((message) => [message.id, message]));

    for (const item of activeFsdSelections) {
      const sourceMessage = messageById.get(item.messageId);
      const fromAnalysis = sourceMessage?.analysisResults || [];
      if (fromAnalysis.length) {
        for (const result of fromAnalysis) {
          const key = normalizeForMatch(result.requirement || `${item.messageId}-${result.classification}`);
          if (!deduped.has(key)) deduped.set(key, result);
        }
        continue;
      }

      const requirementParts = [item.requirementText.trim()];
      if (item.finalSummary.trim()) requirementParts.push(item.finalSummary.trim());
      for (const clarification of item.clarifications) {
        if (!clarification.question.trim() || !clarification.answer.trim()) continue;
        requirementParts.push(`${clarification.question.trim()}: ${clarification.answer.trim()}`);
      }
      const requirement = requirementParts.filter(Boolean).join("\n");
      const fallbackClassification = item.classifications[0] || "Open Question";
      const key = normalizeForMatch(requirement || item.id);
      if (!deduped.has(key)) {
        deduped.set(key, {
          requirement: requirement || "Requirement captured from discussion",
          classification: fallbackClassification,
          confidence: 0.5,
          rationale: item.response || "Generated from selected FSD point.",
          top_chunks: [],
          gaps: null,
        });
      }
    }
    return Array.from(deduped.values());
  }, [activeFsdSelections, activeThread]);
  const activeAddedMessageIds = useMemo(
    () => new Set(addedMessageIdsByThread[activeThreadId] || []),
    [addedMessageIdsByThread, activeThreadId]
  );
  const fsdOutline = useMemo(() => {
    const lines = fsdPreviewDraft
      .split("\n")
      .map((line) => lineToHeading(line))
      .filter(Boolean);
    return lines.slice(0, 8);
  }, [fsdPreviewDraft]);

  const fsdCoverageCounts = useMemo(() => {
    const counts = { total: 0, ootb: 0, partial: 0, custom: 0, open: 0 };
    for (const item of activeFsdSelections) {
      for (const classification of item.classifications || []) {
        const label = classification.toLowerCase();
        counts.total += 1;
        if (label.includes("ootb")) counts.ootb += 1;
        else if (label.includes("partial")) counts.partial += 1;
        else if (label.includes("open")) counts.open += 1;
        else counts.custom += 1;
      }
    }
    return counts;
  }, [activeFsdSelections]);
  const isCoverageEmpty = useMemo(
    () => activeFsdSelections.length === 0 || fsdCoverageCounts.total === 0,
    [activeFsdSelections.length, fsdCoverageCounts.total]
  );

  const summaryPercentages = useMemo(() => {
    const total = fsdCoverageCounts.total || 1;
    return {
      ootb: Math.round((fsdCoverageCounts.ootb / total) * 100),
      partial: Math.round((fsdCoverageCounts.partial / total) * 100),
      custom: Math.round((fsdCoverageCounts.custom / total) * 100),
      open: Math.round((fsdCoverageCounts.open / total) * 100),
    };
  }, [fsdCoverageCounts]);

  const sortedFsdSelections = useMemo(
    () =>
      activeFsdSelections
        .map((item, index) => ({ item, index }))
        .sort((a, b) => {
          if (a.item.pinned !== b.item.pinned) return a.item.pinned ? -1 : 1;
          return a.index - b.index;
        })
        .map(({ item }) => item),
    [activeFsdSelections]
  );

  const filteredThreads = useMemo(() => {
    const query = threadSearch.trim().toLowerCase();
    if (!query) return threads;
    return threads.filter((thread) => {
      const projects = getProjectsFromThread(thread).join(" ").toLowerCase();
      const text = thread.messages.map((message) => message.text).join(" ").toLowerCase();
      const title = thread.title.toLowerCase();
      return title.includes(query) || projects.includes(query) || text.includes(query);
    });
  }, [threadSearch, threads]);

  const projectFilteredThreads = useMemo(() => {
    if (projectFilter === "All") return filteredThreads;
    return filteredThreads.filter((thread) => getPrimaryThreadProject(thread) === projectFilter);
  }, [filteredThreads, projectFilter]);

  const knownProjects = useMemo(() => {
    const set = new Set<string>();
    for (const project of projects) {
      if (project.trim()) set.add(project.trim());
    }
    for (const thread of threads) {
      for (const project of getProjectsFromThread(thread)) {
        if (project.trim()) set.add(project.trim());
      }
    }
    set.add(DEFAULT_PROJECT_NAME);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [threads, projects]);

  const groupedThreads = useMemo(() => {
    const groups = new Map<string, ChatThread[]>();
    if (projectFilter === "All") {
      for (const project of knownProjects) {
        groups.set(project, []);
      }
    }
    for (const thread of projectFilteredThreads) {
      const key = getPrimaryThreadProject(thread);
      const items = groups.get(key) || [];
      items.push(thread);
      groups.set(key, items);
    }
    return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [projectFilteredThreads, knownProjects, projectFilter]);

  const closeOverlays = () => {
    setIsMobileHistoryOpen(false);
    setIsMobileSummaryOpen(false);
    setIsProfileOpen(false);
    setIsSettingsOpen(false);
  };

  useEffect(() => {
    let cancelled = false;
    const loadSession = async () => {
      try {
        const res = await fetch("/api/gate/me");
        if (!res.ok) return;
        const payload = (await res.json()) as { email?: string };
        const email = (payload.email || "").trim().toLowerCase();
        if (!cancelled) setSessionEmail(email);
      } catch {
        // Keep empty session email on failure.
      }
    };
    void loadSession();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!sessionEmail) return;
    let cancelled = false;
    const loadWorkspace = async () => {
      try {
        const payload = await fetchWorkspaceState(sessionEmail);
        if (cancelled) return;
        const loadedProjects = Array.isArray(payload.projects)
          ? payload.projects
              .map((project) => (typeof project === "string" ? project.trim() : ""))
              .filter(Boolean)
          : [];
        const loadedThreads: ChatThread[] = (payload.threads || [])
          .map((thread) => {
            const now = thread.updated_at || new Date().toISOString();
            const messages = Array.isArray(thread.messages)
              ? (thread.messages.filter((item) => !!item && typeof item === "object") as ChatMessage[])
              : [];
            const fallbackAssistant: ChatMessage = {
              id: crypto.randomUUID(),
              role: "assistant",
              createdAt: now,
              text: "Share your requirement scope. I will analyze SFRA coverage and highlight gaps.",
            };
            return {
              id: thread.id,
              title: thread.title || "New scope discussion",
              updatedAt: now,
              projectTag:
                typeof thread.project_id === "string" && thread.project_id.trim()
                  ? thread.project_id.trim()
                  : DEFAULT_PROJECT_NAME,
              messages:
                messages.length > 0
                  ? messages
                  : [fallbackAssistant],
            };
          })
          .filter((thread) => !!thread.id);
        const loadedBaselineLinks: DataSourceLink[] | null = Array.isArray(payload.baseline_links)
          ? payload.baseline_links
              .map((item) => ({
                id:
                  typeof item?.id === "string" && item.id.trim()
                    ? item.id.trim()
                    : crypto.randomUUID(),
                url: typeof item?.url === "string" ? item.url.trim() : "",
                note: typeof item?.note === "string" ? item.note.trim() : "",
              }))
              .filter((item) => !!item.url)
          : null;
        let fallbackLocalBaselineLinks: DataSourceLink[] = [];
        if (loadedBaselineLinks !== null && loadedBaselineLinks.length === 0) {
          try {
            const raw = localStorage.getItem(DATA_SOURCE_STORAGE_KEY);
            if (raw) {
              const parsed = JSON.parse(raw) as { baselineLinks?: DataSourceLink[] };
              if (Array.isArray(parsed.baselineLinks)) {
                fallbackLocalBaselineLinks = parsed.baselineLinks
                  .map((item) => ({
                    id:
                      typeof item?.id === "string" && item.id.trim()
                        ? item.id.trim()
                        : crypto.randomUUID(),
                    url: typeof item?.url === "string" ? item.url.trim() : "",
                    note: typeof item?.note === "string" ? item.note.trim() : "",
                  }))
                  .filter((item) => !!item.url);
              }
            }
          } catch {
            fallbackLocalBaselineLinks = [];
          }
        }

        setProjects(
          loadedProjects.some((project) => project.toLowerCase() === DEFAULT_PROJECT_NAME.toLowerCase())
            ? loadedProjects
            : [DEFAULT_PROJECT_NAME, ...loadedProjects]
        );
        if (loadedThreads.length > 0) {
          setThreads(loadedThreads);
          setActiveThreadId(loadedThreads[0].id);
        }
        if (loadedBaselineLinks && loadedBaselineLinks.length > 0) {
          setBaselineLinks(loadedBaselineLinks);
        } else if (fallbackLocalBaselineLinks.length > 0) {
          setBaselineLinks(fallbackLocalBaselineLinks);
        } else if (loadedBaselineLinks !== null) {
          setBaselineLinks(DEFAULT_BASELINE_LINKS);
        }
      } catch {
        // Keep in-memory defaults when backend state is unavailable.
      } finally {
        if (!cancelled) setWorkspaceLoaded(true);
      }
    };

    void loadWorkspace();
    return () => {
      cancelled = true;
    };
  }, [sessionEmail]);

  useEffect(() => {
    if (!workspaceLoaded || !sessionEmail) return;
    if (workspaceSyncTimerRef.current) {
      window.clearTimeout(workspaceSyncTimerRef.current);
    }
    workspaceSyncTimerRef.current = window.setTimeout(() => {
      void saveWorkspaceState({
        projects,
        threads: threads.map((thread) => ({
          id: thread.id,
          title: thread.title,
          updated_at: thread.updatedAt,
          project_id: thread.projectTag || DEFAULT_PROJECT_NAME,
          messages: thread.messages as Array<Record<string, unknown>>,
        })),
        baseline_links: baselineLinks.map((item) => ({
          id: item.id,
          url: item.url.trim(),
          note: item.note.trim(),
        })).filter((item) => !!item.url),
      }, sessionEmail).catch(() => {
        // Keep UX non-blocking if persistence fails.
      });
    }, 600);

    return () => {
      if (workspaceSyncTimerRef.current) {
        window.clearTimeout(workspaceSyncTimerRef.current);
      }
    };
  }, [projects, threads, baselineLinks, workspaceLoaded, sessionEmail]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (activeThread && activeGuidedCycle?.status === "guided") {
          setGuidedCycleByThread((prev) => ({
            ...prev,
            [activeThread.id]: { ...activeGuidedCycle, status: "cancelled" },
          }));
        }
        closeOverlays();
        setIsConfluenceModalOpen(false);
        setIsOnboardingOpen(false);
        setIsHelpOpen(false);
        setIsDataSourceOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeGuidedCycle, activeThread]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(DATA_SOURCE_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        baselineLinks?: DataSourceLink[];
      };
      if (parsed.baselineLinks?.length) {
        setBaselineLinks(
          parsed.baselineLinks.map((item) => ({
            id: item.id || crypto.randomUUID(),
            url: item.url || "",
            note: item.note || "",
          }))
        );
      }
    } catch {
      // Ignore storage parse errors and continue with defaults.
    }
  }, []);

  useEffect(() => {
    const payload = {
      baselineLinks,
    };
    localStorage.setItem(DATA_SOURCE_STORAGE_KEY, JSON.stringify(payload));
  }, [baselineLinks]);

  useEffect(() => {
    chatScrollRef.current?.scrollTo({ top: chatScrollRef.current.scrollHeight, behavior: "smooth" });
  }, [activeThread?.messages]);

  useEffect(() => {
    const validKeys = new Set<string>();
    for (const thread of threads) {
      for (const message of thread.messages) {
        const total = message.analysisResults?.length || 0;
        for (let i = 0; i < total; i += 1) {
          validKeys.add(`${thread.id}:${message.id}:${i}`);
        }
      }
    }
    setExpandedAnalysisKeys((prev) => {
      const next = new Set<string>();
      for (const key of prev) {
        if (validKeys.has(key)) next.add(key);
      }
      return next;
    });
  }, [threads]);

  useEffect(() => {
    if (!isChatAnalyzing) {
      setAnalysisStepIndex(0);
      return;
    }
    const interval = window.setInterval(() => {
      setAnalysisStepIndex((prev) => {
        if (prev >= ANALYSIS_STEPS.length - 1) return prev;
        return prev + 1;
      });
    }, 1400);
    return () => window.clearInterval(interval);
  }, [isChatAnalyzing]);

  useEffect(() => {
    const onClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (settingsMenuRef.current && !settingsMenuRef.current.contains(target)) {
        setIsSettingsOpen(false);
      }
      if (profileMenuRef.current && !profileMenuRef.current.contains(target)) {
        setIsProfileOpen(false);
      }
    };

    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  useEffect(() => {
    const trapFocus = (container: HTMLDivElement | null, active: boolean) => {
      if (!container || !active) return;
      const focusable = container.querySelectorAll<HTMLElement>(
        'button, [href], input, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable.length) return;
      focusable[0].focus();

      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key !== "Tab") return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      };

      container.addEventListener("keydown", onKeyDown);
      return () => container.removeEventListener("keydown", onKeyDown);
    };

    const cleanupHistory = trapFocus(historyDrawerRef.current, isMobileHistoryOpen);
    const cleanupSummary = trapFocus(summaryDrawerRef.current, isMobileSummaryOpen);

    return () => {
      cleanupHistory?.();
      cleanupSummary?.();
    };
  }, [isMobileHistoryOpen, isMobileSummaryOpen]);

  useEffect(() => {
    return () => {
      if (ingestStatusPollRef.current) {
        window.clearInterval(ingestStatusPollRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!actionNotice) return;
    const timeout = window.setTimeout(() => {
      setActionNotice("");
    }, 5000);
    return () => window.clearTimeout(timeout);
  }, [actionNotice]);

  const handleSignOut = async () => {
    await fetch("/api/gate/logout", { method: "POST" });
    window.location.href = "/gate";
  };

  const startNewThread = () => {
    const cleanedTitle = newThreadTitleDraft.trim();
    const cleanedProject = newThreadProjectDraft.trim();
    const fallbackProject =
      projectFilter !== "All"
        ? projectFilter
        : activeThread?.projectTag || DEFAULT_PROJECT_NAME;
    const thread = createThread(cleanedTitle || undefined, cleanedProject || fallbackProject);
    if (thread.projectTag?.trim()) {
      setProjects((prev) => {
        const exists = prev.some((project) => project.toLowerCase() === thread.projectTag!.toLowerCase());
        if (exists) return prev;
        return [...prev, thread.projectTag!];
      });
    }
    setThreads((prev) => [thread, ...prev]);
    setActiveThreadId(thread.id);
    setIntroAnimationThreadId(thread.id);
    setNewThreadTitleDraft("");
    setNewThreadProjectDraft("");
    setComposer("");
    setAttachments([]);
    setError("");
    setGuidedCustomDraft("");
    setSelectedGuidedOption("");
    closeOverlays();
    window.setTimeout(() => {
      setIntroAnimationThreadId((current) => (current === thread.id ? null : current));
    }, 950);
  };

  const addProject = () => {
    const cleaned = newProjectDraft.trim();
    if (!cleaned) return;
    setProjects((prev) => {
      const exists = prev.some((project) => project.toLowerCase() === cleaned.toLowerCase());
      if (exists) return prev;
      return [...prev, cleaned];
    });
    setNewThreadProjectDraft(cleaned);
    setNewProjectDraft("");
    setIsAddProjectOpen(false);
  };

  const startThreadInProject = (projectName: string) => {
    const thread = createThread(undefined, projectName);
    setThreads((prev) => [thread, ...prev]);
    setActiveThreadId(thread.id);
    setIntroAnimationThreadId(thread.id);
    setComposer("");
    setAttachments([]);
    setError("");
    setGuidedCustomDraft("");
    setSelectedGuidedOption("");
    closeOverlays();
    window.setTimeout(() => {
      setIntroAnimationThreadId((current) => (current === thread.id ? null : current));
    }, 950);
  };

  const handleDeleteProject = (projectName: string) => {
    if (projectName.trim().toLowerCase() === DEFAULT_PROJECT_NAME.toLowerCase()) return;
    const confirmed = window.confirm(`Delete project "${projectName}"? Threads will be kept and moved to ${DEFAULT_PROJECT_NAME}.`);
    if (!confirmed) return;
    const normalizedProject = projectName.trim().toLowerCase();

    setProjects((prev) => {
      const filtered = prev.filter((project) => project.trim().toLowerCase() !== normalizedProject);
      const hasDefault = filtered.some((project) => project.trim().toLowerCase() === DEFAULT_PROJECT_NAME.toLowerCase());
      return hasDefault ? filtered : [DEFAULT_PROJECT_NAME, ...filtered];
    });
    setThreads((prev) =>
      prev.map((thread) =>
        (() => {
          let changed = false;
          let nextProjectTag = thread.projectTag;
          if (thread.projectTag?.trim().toLowerCase() === normalizedProject) {
            nextProjectTag = DEFAULT_PROJECT_NAME;
            changed = true;
          }

          const nextMessages = thread.messages.map((message) => {
            if (!message.analysisResults?.length) return message;
            let messageChanged = false;
            const nextResults = message.analysisResults.map((item) => {
              if (!item.top_chunks?.length) return item;
              let itemChanged = false;
              const nextChunks = item.top_chunks.map((chunk) => {
                const metadata = chunk.metadata || {};
                const metaProject = typeof metadata.project === "string" ? metadata.project.trim().toLowerCase() : "";
                const metaSpaceKey = typeof metadata.space_key === "string" ? metadata.space_key.trim().toLowerCase() : "";
                if (metaProject !== normalizedProject && metaSpaceKey !== normalizedProject) {
                  return chunk;
                }
                itemChanged = true;
                const nextMetadata = { ...metadata };
                if (metaProject === normalizedProject) nextMetadata.project = "";
                if (metaSpaceKey === normalizedProject) nextMetadata.space_key = "";
                return { ...chunk, metadata: nextMetadata };
              });
              if (!itemChanged) return item;
              messageChanged = true;
              return { ...item, top_chunks: nextChunks };
            });
            if (!messageChanged) return message;
            changed = true;
            return { ...message, analysisResults: nextResults };
          });

          if (!changed) return thread;
          return {
            ...thread,
            projectTag: nextProjectTag,
            messages: nextMessages,
            updatedAt: new Date().toISOString(),
          };
        })()
      )
    );
    setProjectFilter((prev) => (prev.trim().toLowerCase() === normalizedProject ? "All" : prev));
    setActionNotice(`Deleted project "${projectName}".`);
  };

  const handleRenameThread = (threadId: string) => {
    const current = threads.find((thread) => thread.id === threadId);
    if (!current) return;
    setRenamingThreadId(threadId);
    setRenameDraft(current.title);
    setRenameProjectDraft(current.projectTag || "");
  };

  const handleSaveThreadRename = (threadId: string) => {
    const cleaned = renameDraft.trim();
    if (!cleaned) return;
    const cleanedProject = renameProjectDraft.trim();
    const normalizedProject = cleanedProject || DEFAULT_PROJECT_NAME;
    setProjects((prev) => {
      const exists = prev.some((project) => project.toLowerCase() === normalizedProject.toLowerCase());
      if (exists) return prev;
      return [...prev, normalizedProject];
    });
    setThreads((prev) =>
      prev.map((thread) =>
        thread.id === threadId
          ? {
              ...thread,
              title: cleaned.slice(0, 80),
              projectTag: normalizedProject,
              updatedAt: new Date().toISOString(),
            }
          : thread
      )
    );
    setRenamingThreadId(null);
    setRenameDraft("");
    setRenameProjectDraft("");
  };

  const removeThread = (threadId: string) => {
    setThreads((prev) => {
      const remaining = prev.filter((thread) => thread.id !== threadId);
      if (remaining.length === 0) {
        const replacement = createThread();
        setActiveThreadId(replacement.id);
        return [replacement];
      }
      if (activeThreadId === threadId) {
        setActiveThreadId(remaining[0].id);
      }
      return remaining;
    });
  };

  const handleDeleteThread = (threadId: string) => {
    setPendingDeleteThreadId(threadId);
    if (renamingThreadId === threadId) {
      setRenamingThreadId(null);
      setRenameDraft("");
      setRenameProjectDraft("");
    }
  };

  const handleConfirmDeleteThread = (threadId: string) => {
    setPendingDeleteThreadId(null);
    setDeletingThreadId(threadId);
    window.setTimeout(() => {
      removeThread(threadId);
      setFsdSelectionsByThread((prev) => {
        const next = { ...prev };
        delete next[threadId];
        return next;
      });
      setGuidedCycleByThread((prev) => {
        const next = { ...prev };
        delete next[threadId];
        return next;
      });
      setAddedMessageIdsByThread((prev) => {
        const next = { ...prev };
        delete next[threadId];
        return next;
      });
      setDeletingThreadId((current) => (current === threadId ? null : current));
    }, 650);
  };

  const handleAddToFsd = (message: ChatMessage) => {
    if (!activeThread) return;
    if (activeAddedMessageIds.has(message.id)) return;

    const messageIndex = activeThread.messages.findIndex((msg) => msg.id === message.id);
    const primaryResult = (message.analysisResults || [])[0];
    const requirementBlob = primaryResult?.requirement || "";
    const parsedRequirement = parseConsolidatedClarifications(requirementBlob);
    const requirementSeed = (() => {
      for (let i = messageIndex - 1; i >= 0; i -= 1) {
        const prev = activeThread.messages[i];
        if (prev.role !== "user") continue;
        if (prev.kind === "normal") return prev.text.trim();
      }
      return "";
    })();
    const requirementText = requirementSeed || "Requirement captured from discussion";
    const clarifications = parsedRequirement?.pairs || [];
    const finalSummary = parsedRequirement?.summary || "";
    const evidence = primaryResult ? getSources(primaryResult).slice(0, 4) : [];
    const classifications = Array.from(
      new Set((message.analysisResults || []).map((item) => item.classification).filter(Boolean))
    );
    const analysisText = primaryResult?.rationale?.trim() || message.text.trim();
    const effort = estimateEffort(`${requirementText} ${analysisText}`);

    const newItem: FsdSidebarItem = {
      id: `fsd-${message.id}-${Date.now()}`,
      messageId: message.id,
      createdAt: new Date().toISOString(),
      pinned: false,
      requirementText,
      clarifications,
      finalSummary,
      response: analysisText || "Analysis captured from AI response.",
      evidence,
      effort,
      requirements: requirementText ? [requirementText] : [],
      classifications,
    };

    setFsdSelectionsByThread((prev) => {
      const current = prev[activeThread.id] || [];
      const duplicate = current.find(
        (item) => normalizeForMatch(item.requirementText) === normalizeForMatch(newItem.requirementText)
      );
      if (duplicate) {
        const shouldMerge = window.confirm(
          "A similar FSD point already exists.\n\nClick OK to merge with existing point, or Cancel to keep both."
        );
        if (shouldMerge) {
          const merged: FsdSidebarItem = {
            ...duplicate,
            clarifications: [
              ...duplicate.clarifications,
              ...newItem.clarifications.filter(
                (entry) =>
                  !duplicate.clarifications.some(
                    (old) =>
                      normalizeForMatch(old.question) === normalizeForMatch(entry.question) &&
                      normalizeForMatch(old.answer) === normalizeForMatch(entry.answer)
                  )
              ),
            ],
            finalSummary: duplicate.finalSummary || newItem.finalSummary,
            response: `${duplicate.response}\n\n${newItem.response}`.trim(),
            evidence: [...duplicate.evidence, ...newItem.evidence].slice(0, 6),
            classifications: Array.from(new Set([...duplicate.classifications, ...newItem.classifications])),
            effort: estimateEffort(`${duplicate.response}\n${newItem.response}`),
          };
          return {
            ...prev,
            [activeThread.id]: current.map((item) => (item.id === duplicate.id ? merged : item)),
          };
        }
      }
      return { ...prev, [activeThread.id]: [...current, newItem] };
    });

    setAddedMessageIdsByThread((prev) => {
      const current = prev[activeThread.id] || [];
      return { ...prev, [activeThread.id]: [...current, message.id] };
    });
    setRecentlyAddedToSidebar({ threadId: activeThread.id, messageId: message.id });
    window.setTimeout(() => {
      setRecentlyAddedToSidebar((current) =>
        current?.threadId === activeThread.id && current?.messageId === message.id ? null : current
      );
    }, 2800);
  };

  const handleRemoveFromFsd = (itemId: string, messageId: string) => {
    if (!activeThread) return;
    setFsdSelectionsByThread((prev) => {
      const current = prev[activeThread.id] || [];
      return { ...prev, [activeThread.id]: current.filter((item) => item.id !== itemId) };
    });
    setAddedMessageIdsByThread((prev) => {
      const current = prev[activeThread.id] || [];
      return { ...prev, [activeThread.id]: current.filter((id) => id !== messageId) };
    });
  };

  const toggleSummaryItemExpansion = (itemId: string) => {
    setExpandedSummaryItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  const setThreadMessages = (threadId: string, updater: (messages: ChatMessage[]) => ChatMessage[]) => {
    setThreads((prev) =>
      prev.map((thread) => {
        if (thread.id !== threadId) return thread;
        const nextMessages = updater(thread.messages);
        return { ...thread, messages: nextMessages, updatedAt: new Date().toISOString() };
      })
    );
  };

  const handleAttachFiles = (files: FileList | null) => {
    if (!files?.length) return;
    const now = new Date().toISOString();
    const incoming = Array.from(files).map((file) => ({
      id: crypto.randomUUID(),
      name: file.name,
      size: file.size,
      type: file.type || "application/octet-stream",
      uploadedAt: now,
      uploadState: "uploaded" as const,
    }));
    setAttachments((prev) => [...prev, ...incoming]);
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((item) => item.id !== id));
  };

  const patchGuidedCycle = (threadId: string, updater: (cycle: GuidedCycle | null) => GuidedCycle | null) => {
    setGuidedCycleByThread((prev) => ({ ...prev, [threadId]: updater(prev[threadId] || null) }));
  };

  const loadGuidedStep = async (threadId: string, cycle: GuidedCycle, stepIndex: number) => {
    setGuidedLoading(true);
    try {
      const step = await fetchFollowupStep(
        cycle.baseRequirement,
        cycle.answers.map((item) => ({ question: item.question, answer: item.answer })),
        stepIndex,
        cycle.maxSteps
      );
      patchGuidedCycle(threadId, (current) =>
        current && current.id === cycle.id
          ? {
              ...current,
              currentStepIndex: stepIndex,
              currentQuestion: step.question,
              currentOptions: step.options,
              isTerminal: step.is_terminal,
              status: "guided",
            }
          : current
      );
    } catch {
      const fallback = FALLBACK_GUIDED_STEPS[Math.min(stepIndex, FALLBACK_GUIDED_STEPS.length - 1)];
      patchGuidedCycle(threadId, (current) =>
        current && current.id === cycle.id
          ? {
              ...current,
              currentStepIndex: stepIndex,
              currentQuestion: fallback.question,
              currentOptions: fallback.options,
              isTerminal: stepIndex >= cycle.maxSteps - 1,
              status: "guided",
            }
          : current
      );
    } finally {
      setGuidedLoading(false);
    }
  };

  const startGuidedCycle = async (scopeTextInput: string, messageAttachments: AttachmentMeta[]) => {
    if (!activeThread) return;
    const scopeText = scopeTextInput.trim();
    if (!scopeText && messageAttachments.length === 0) return false;

    setError("");
    setActionNotice("");

    const now = new Date().toISOString();
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      kind: "normal",
      createdAt: now,
      text: scopeText || "Uploaded context files",
      attachments: messageAttachments.length ? messageAttachments : undefined,
    };
    setThreadMessages(activeThread.id, (messages) => [...messages, userMessage]);

    if (activeThread.messages.length <= 1 && scopeText) {
      setThreads((prev) =>
        prev.map((thread) =>
          thread.id === activeThread.id
            ? { ...thread, title: firstMeaningfulLine(scopeText).slice(0, 60), updatedAt: now }
            : thread
        )
      );
    }

    const cycle: GuidedCycle = {
      id: crypto.randomUUID(),
      baseRequirement: scopeText || "Requirement context from uploaded files",
      status: "guided",
      currentStepIndex: 0,
      maxSteps: GUIDED_MAX_STEPS,
      answers: [],
      currentQuestion: undefined,
      currentOptions: [],
      isTerminal: false,
    };
    setGuidedBootstrapping(true);
    setGuidedCustomDraft("");
    setSelectedGuidedOption("");
    try {
      const step = await fetchFollowupStep(cycle.baseRequirement, [], 0, cycle.maxSteps);
      patchGuidedCycle(activeThread.id, () => ({
        ...cycle,
        currentStepIndex: 0,
        currentQuestion: step.question,
        currentOptions: step.options,
        isTerminal: step.is_terminal,
      }));
    } catch {
      const fallback = FALLBACK_GUIDED_STEPS[0];
      patchGuidedCycle(activeThread.id, () => ({
        ...cycle,
        currentStepIndex: 0,
        currentQuestion: fallback.question,
        currentOptions: fallback.options,
        isTerminal: fallback.is_terminal,
      }));
    } finally {
      setGuidedBootstrapping(false);
    }
    return true;
  };

  const handleGuidedNext = async () => {
    if (!activeThread || !activeGuidedCycle || activeGuidedCycle.status !== "guided") return;
    const chosen = selectedGuidedOption.trim();
    const custom = guidedCustomDraft.trim();
    const answerText = custom || chosen;
    if (!answerText) {
      setError("Select an option or enter custom input before moving to next step.");
      return;
    }

    const questionText = activeGuidedCycle.currentQuestion || `Follow-up ${activeGuidedCycle.currentStepIndex + 1}`;
    const answer: GuidedAnswer = {
      question: questionText,
      answer: answerText,
      source: custom ? "custom" : "option",
    };

    const nextAnswers = [...activeGuidedCycle.answers, answer];

    patchGuidedCycle(activeThread.id, (current) =>
      current && current.id === activeGuidedCycle.id ? { ...current, answers: nextAnswers } : current
    );
    const nextStep = activeGuidedCycle.currentStepIndex + 1;
    if (nextStep >= activeGuidedCycle.maxSteps || activeGuidedCycle.isTerminal) {
      patchGuidedCycle(activeThread.id, (current) =>
        current && current.id === activeGuidedCycle.id
          ? { ...current, answers: nextAnswers, isTerminal: true, currentQuestion: undefined, currentOptions: [] }
          : current
      );
      setGuidedCustomDraft("");
      setSelectedGuidedOption("");
      return;
    }

    await loadGuidedStep(
      activeThread.id,
      {
        ...activeGuidedCycle,
        answers: nextAnswers,
      },
      nextStep
    );
    setGuidedCustomDraft("");
    setSelectedGuidedOption("");
  };

  const handleDismissGuided = () => {
    if (!activeThread || !activeGuidedCycle) return;
    patchGuidedCycle(activeThread.id, (current) =>
      current && current.id === activeGuidedCycle.id ? { ...current, status: "cancelled" } : current
    );
    setSelectedGuidedOption("");
    setGuidedCustomDraft("");
  };

  const handleAnalyzeNow = async () => {
    if (!activeThread || !activeGuidedCycle) return;
    const pendingCustom = guidedCustomDraft.trim();
    const pendingOption = selectedGuidedOption.trim();
    const pendingAnswerText = pendingCustom || pendingOption;
    const shouldAppendPending =
      activeGuidedCycle.status === "guided" &&
      !!activeGuidedCycle.currentQuestion &&
      !!pendingAnswerText &&
      !activeGuidedCycle.answers.some(
        (entry) =>
          entry.question === activeGuidedCycle.currentQuestion && entry.answer.trim() === pendingAnswerText
      );
    const answersForAnalysis = shouldAppendPending
      ? [
          ...activeGuidedCycle.answers,
          {
            question: activeGuidedCycle.currentQuestion || `Follow-up ${activeGuidedCycle.currentStepIndex + 1}`,
            answer: pendingAnswerText,
            source: pendingCustom ? "custom" : "option",
          } satisfies GuidedAnswer,
        ]
      : activeGuidedCycle.answers;
    const consolidated = buildConsolidatedRequirementText(activeGuidedCycle.baseRequirement, answersForAnalysis);

    patchGuidedCycle(activeThread.id, (current) =>
      current && current.id === activeGuidedCycle.id
        ? {
            ...current,
            status: "analyzing",
            answers: answersForAnalysis,
          }
        : current
    );
    setLoading(true);
    setIsChatAnalyzing(true);
    setError("");
    setActionNotice("");

    try {
      setThreadMessages(activeThread.id, (messages) => [
        ...messages,
        {
          id: crypto.randomUUID(),
          role: "user",
          kind: "guided_answer",
          cycleId: activeGuidedCycle.id,
          createdAt: new Date().toISOString(),
          text: consolidated,
        },
      ]);
      const payload = await analyzeSingleRequirement(consolidated);
      const primary = payload.results[0];
      const references = primary ? getSources(primary).slice(0, 3) : [];
      const sfraBaselineReference = primary ? getSfraBaselineReference(primary) : null;
      const detailedMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        kind: "analysis_result",
        cycleId: activeGuidedCycle.id,
        createdAt: new Date().toISOString(),
        text: primary
          ? `Analysis completed: ${primary.rationale || primary.classification}.`
          : "Analysis completed.",
        analysisResults: payload.results,
        detailedResult: primary
          ? {
              classification: primary.classification,
              why: primary.rationale,
              confidence: primary.confidence,
              implementationMode: primary.implementation_mode ?? null,
              coverageStatus: primary.coverage_status ?? null,
              projectMatchStatus: primary.project_match_status ?? null,
              gaps: primary.gaps ?? null,
              sfraBaselineReference,
              references,
            }
          : undefined,
      };
      setThreadMessages(activeThread.id, (messages) => [...messages, detailedMessage]);
      patchGuidedCycle(activeThread.id, (current) =>
        current && current.id === activeGuidedCycle.id ? { ...current, status: "analyzed" } : current
      );
      setGuidedCustomDraft("");
      setSelectedGuidedOption("");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong.";
      setError(message);
      setThreadMessages(activeThread.id, (messages) => [
        ...messages,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          createdAt: new Date().toISOString(),
          text: `I could not run analysis: ${message}`,
        },
      ]);
      patchGuidedCycle(activeThread.id, (current) =>
        current && current.id === activeGuidedCycle.id ? { ...current, status: "guided" } : current
      );
    } finally {
      setLoading(false);
      setIsChatAnalyzing(false);
    }
  };

  const handleSend = async () => {
    if (activeGuidedCycle && activeGuidedCycle.status === "guided") {
      setError("Use the guided follow-up card to continue, or click Analyze now.");
      return;
    }
    const messageAttachments = attachments;
    const scopeText = composer;
    const started = await startGuidedCycle(scopeText, messageAttachments);
    if (started) {
      setComposer("");
      setAttachments([]);
    }
  };

  const handleExportDocx = async () => {
    const exportText = fsdPreviewDraft.trim() || fsdPreview.trim();
    if (!exportText) {
      setError("Preview FSD before exporting.");
      return;
    }

    setLoading(true);
    setError("");
    setActionNotice("");

    try {
      const blob = await generateFsdDocxFromText(exportText);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "fsd.docx";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setActionNotice("FSD .docx downloaded.");
    } catch (err) {
      if (
        err instanceof Error &&
        err.message === "FSD_TEXT_EXPORT_NOT_FOUND" &&
        (selectedGapResults.length || latestAnalysisResults.length)
      ) {
        try {
          const fallbackResults = selectedGapResults.length ? selectedGapResults : latestAnalysisResults;
          const legacyBlob = await generateFsdDocx(fallbackResults);
          const url = URL.createObjectURL(legacyBlob);
          const link = document.createElement("a");
          link.href = url;
          link.download = "fsd.docx";
          document.body.appendChild(link);
          link.click();
          link.remove();
          URL.revokeObjectURL(url);
          setActionNotice("FSD exported. Edited preview is not supported by current backend yet.");
          return;
        } catch (fallbackErr) {
          setError(fallbackErr instanceof Error ? fallbackErr.message : "Something went wrong.");
          return;
        }
      }
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  const handleOpenFsdPreview = async () => {
    if (!selectedGapResults.length) {
      setError("Add at least one finalized point to FSD before previewing.");
      return;
    }

    setFsdPreviewLoading(true);
    setError("");
    setActionNotice("");
    try {
      const payload = await generateFsd(selectedGapResults);
      const nextPreview = payload.fsd || "";
      setFsdPreview(nextPreview);
      setFsdPreviewDraft(nextPreview);
      setIsFsdPreviewEditing(false);
      setIsFsdPreviewOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to generate FSD preview.");
    } finally {
      setFsdPreviewLoading(false);
    }
  };

  const openConfluenceModal = async () => {
    const saveText = fsdPreviewDraft.trim() || fsdPreview.trim();
    if (!saveText) {
      setError("Preview FSD before saving to Confluence.");
      return;
    }
    const defaultTitle = `${activeThread?.title || "FSD"} - ${new Date().toISOString().slice(0, 10)}`;
    setConfluenceTitle(defaultTitle);
    setConfluenceError("");
    setConfluenceDuplicateWarning("");
    setIsConfluenceModalOpen(true);
    setConfluenceLoading(true);
    try {
      const spaces = await fetchConfluenceSpaces();
      setConfluenceSpaces(spaces);
      if (spaces.length) {
        const initialSpace = spaces[0].key;
        setConfluenceSpaceKey(initialSpace);
        const folders = await fetchConfluenceFolders(initialSpace);
        setConfluenceFolders(folders);
        setConfluenceParentId(folders[0]?.id || "");
      } else {
        setConfluenceSpaceKey("");
        setConfluenceFolders([]);
        setConfluenceParentId("");
      }
    } catch (err) {
      setConfluenceError(err instanceof Error ? err.message : "Unable to load Confluence metadata.");
    } finally {
      setConfluenceLoading(false);
    }
  };

  const handleSpaceChange = async (nextSpace: string) => {
    setConfluenceSpaceKey(nextSpace);
    setConfluenceParentId("");
    setConfluenceFolders([]);
    setConfluenceDuplicateWarning("");
    if (!nextSpace) return;

    setConfluenceLoading(true);
    setConfluenceError("");
    try {
      const folders = await fetchConfluenceFolders(nextSpace);
      setConfluenceFolders(folders);
      setConfluenceParentId(folders[0]?.id || "");
    } catch (err) {
      setConfluenceError(err instanceof Error ? err.message : "Unable to load folders.");
    } finally {
      setConfluenceLoading(false);
    }
  };

  const handleConfluenceSave = async () => {
    const spaceKey = confluenceSpaceKey.trim();
    const parentId = confluenceParentId.trim();
    const title = confluenceTitle.trim();

    if (!spaceKey || !parentId || !title) {
      setConfluenceError("Space, folder, and filename are required.");
      return;
    }
    const saveText = fsdPreviewDraft.trim() || fsdPreview.trim();
    if (!saveText) {
      setConfluenceError("No preview content found to save.");
      return;
    }

    setConfluenceLoading(true);
    setConfluenceError("");
    setConfluenceDuplicateWarning("");
    setActionNotice("");

    try {
      const dup = await checkConfluenceDuplicate(spaceKey, parentId, title);
      if (dup.exists) {
        setConfluenceDuplicateWarning(
          "A page with this filename already exists in the selected folder. Choose a different filename."
        );
        return;
      }

      try {
        const saved = await saveFsdTextToConfluence(saveText, spaceKey, parentId, title);
        setActionNotice(`Saved to Confluence: ${saved.title}`);
        setIsConfluenceModalOpen(false);
      } catch (err) {
        if (
          err instanceof Error &&
          err.message === "FSD_TEXT_SAVE_NOT_FOUND" &&
          (selectedGapResults.length || latestAnalysisResults.length)
        ) {
          const fallbackResults = selectedGapResults.length ? selectedGapResults : latestAnalysisResults;
          const saved = await saveFsdToConfluence(fallbackResults, spaceKey, parentId, title);
          setActionNotice(`Saved to Confluence: ${saved.title} (edited preview not supported by current backend).`);
          setIsConfluenceModalOpen(false);
          return;
        }
        throw err;
      }
    } catch (err) {
      setConfluenceError(err instanceof Error ? err.message : "Unable to save to Confluence.");
    } finally {
      setConfluenceLoading(false);
    }
  };

  const handleAddBaselineLink = () => {
    const url = newBaselineUrl.trim();
    if (!url) {
      setDataSourceError("Source URL is required.");
      return;
    }
    setBaselineLinks((prev) => [...prev, { id: crypto.randomUUID(), url, note: newBaselineNote.trim() }]);
    setNewBaselineUrl("");
    setNewBaselineNote("");
    setDataSourceError("");
  };

  const handleRemoveBaselineLink = (id: string) => {
    setBaselineLinks((prev) => prev.filter((item) => item.id !== id));
  };

  const handleUpdateBaselineLink = (id: string, field: "url" | "note", value: string) => {
    setBaselineLinks((prev) =>
      prev.map((item) => (item.id === id ? { ...item, [field]: value } : item))
    );
  };

  const handleIngestDataSources = async () => {
    if (ingestStatusPollRef.current) window.clearInterval(ingestStatusPollRef.current);
    setIsIngestingDataSources(true);
    setDataSourceError("");
    setDataSourceNotice("");
    setIngestProgress(0);
    setIngestStartedAt(Date.now());
    setIngestStatusText("Queued for ingestion...");
    setActionNotice("Ingestion started.");
    try {
      let started: { job_id: string; status: string } | null = null;
      try {
        started = await startConfluenceIngest({
          baseline_links: baselineLinks
            .map((item) => ({ url: item.url.trim(), note: item.note.trim() }))
            .filter((item) => Boolean(item.url)),
          include_confluence: true,
          crawl_depth: 2,
          max_pages: 220,
        });
      } catch (startErr) {
        const message = startErr instanceof Error ? startErr.message : "";
        const isNotFound = message.includes("Not Found") || message.includes("404");
        if (!isNotFound) throw startErr;

        // Fallback for older backend versions that only expose sync ingest endpoint.
        setIngestStatusText("Running ingestion on legacy endpoint...");
        setIngestProgress(35);
        const legacy = await ingestConfluence();
        setIngestProgress(100);
        setIngestStatusText("Ingestion completed.");
        setDataSourceNotice(
          `Ingestion completed: ${legacy.pages} pages scanned, ${legacy.pages} indexed, 0 skipped, ${legacy.chunks} chunks stored.`
        );
        setActionNotice(`Data ingestion completed: ${legacy.pages}/${legacy.pages} pages indexed, ${legacy.chunks} chunks.`);
        setIsIngestingDataSources(false);
        return;
      }

      if (!started) {
        throw new Error("Failed to start ingestion job.");
      }
      setIngestJobId(started.job_id);
      const pollStatus = async () => {
        const status = await getConfluenceIngestStatus(started.job_id);
        setIngestStatusText(status.stage || "");
        setIngestProgress(Math.max(0, Math.min(100, Math.round(status.progress || 0))));
        if (status.started_at) {
          setIngestStartedAt(Math.round(status.started_at * 1000));
        }

        if (status.status === "completed") {
          if (ingestStatusPollRef.current) {
            window.clearInterval(ingestStatusPollRef.current);
            ingestStatusPollRef.current = null;
          }
          handleIngestCompleted(status);
          return;
        }
        if (status.status === "failed") {
          if (ingestStatusPollRef.current) {
            window.clearInterval(ingestStatusPollRef.current);
            ingestStatusPollRef.current = null;
          }
          throw new Error(status.error || "Ingestion failed.");
        }
      };

      const handleIngestCompleted = (status: IngestStatusResponse) => {
        setIngestProgress(100);
        setIngestStatusText("Ingestion completed.");
        const webIndexed = status.web_pages_indexed || 0;
        const webSkipped = status.web_pages_skipped || 0;
        setDataSourceNotice(
          `Ingestion completed: Confluence ${status.pages_processed}/${status.pages_total} processed (${status.pages_indexed} indexed, ${status.pages_skipped} skipped), Web ${webIndexed} indexed (${webSkipped} skipped), ${status.chunks} chunks stored.`
        );
        setActionNotice(
          `Data ingestion completed: Confluence ${status.pages_processed}/${status.pages_total} processed (${status.pages_indexed} indexed), Web ${webIndexed}, ${status.chunks} chunks.`
        );
        setIsIngestingDataSources(false);
      };

      try {
        await pollStatus();
      } catch (pollError) {
        setIsIngestingDataSources(false);
        throw pollError;
      }

      ingestStatusPollRef.current = window.setInterval(() => {
        void pollStatus().catch((pollError) => {
          if (ingestStatusPollRef.current) {
            window.clearInterval(ingestStatusPollRef.current);
            ingestStatusPollRef.current = null;
          }
          setIsIngestingDataSources(false);
          setIngestStatusText("Ingestion failed.");
          setDataSourceError(pollError instanceof Error ? pollError.message : "Unable to ingest sources.");
        });
      }, 1500);
    } catch (err) {
      if (ingestStatusPollRef.current) {
        window.clearInterval(ingestStatusPollRef.current);
        ingestStatusPollRef.current = null;
      }
      setIngestStatusText("Ingestion failed. Please review the error and retry.");
      setDataSourceError(err instanceof Error ? err.message : "Unable to ingest sources.");
      setIsIngestingDataSources(false);
    }
  };

  return (
    <main className="workspace-shell min-h-screen text-obsidian">
      <header className="top-nav glass-bar" role="navigation" aria-label="Main navigation">
        <div className="flex items-center gap-3">
          <button
            className="icon-chip lg:hidden"
            onClick={() => setIsMobileHistoryOpen(true)}
            aria-label="Open chat history"
          >
            ?
          </button>
          <div className="workspace-brand" aria-label="SCOUT - SFRA AI Agent Requirements Intelligence">
            <img src="/scout-logo.png" alt="SCOUT" className="workspace-brand-logo" />
            <span className="workspace-brand-tagline">Build on clarity.</span>
            <span className="sr-only">SFRA AI Agent Requirements Intelligence</span>
          </div>
        </div>

        {actionNotice && (
          <div className="top-nav-notice" role="status" aria-live="polite">
            <p className="top-nav-notice-text">
              <span>{actionNotice}</span>
              <button
                className="top-nav-notice-close"
                onClick={() => setActionNotice("")}
                aria-label="Dismiss notice"
              >
                x
              </button>
            </p>
          </div>
        )}

        <div className="flex items-center gap-2">
          <button
            className="rounded-full px-2 py-1 text-xs font-semibold text-obsidian/80 underline decoration-obsidian/45 underline-offset-2 hover:text-obsidian"
            onClick={() => {
              setIsHelpOpen(true);
              setIsSettingsOpen(false);
              setIsProfileOpen(false);
            }}
          >
            Help
          </button>

          <div className="relative" ref={settingsMenuRef}>
            <button
              className="settings-btn inline-flex items-center gap-2 rounded-full border border-obsidian/10 bg-obsidian/5 px-4 py-2 text-xs font-semibold text-obsidian/70"
              onClick={() => {
                setIsSettingsOpen((prev) => !prev);
                setIsProfileOpen(false);
              }}
              aria-haspopup="menu"
              aria-expanded={isSettingsOpen}
            >
              <svg
                viewBox="0 0 24 24"
                aria-hidden="true"
                className="h-3.5 w-3.5 text-obsidian/70"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
              >
                <circle cx="12" cy="12" r="3.2" />
                <path d="M12 2.8v2.3M12 18.9v2.3M4.9 4.9l1.7 1.7M17.4 17.4l1.7 1.7M2.8 12h2.3M18.9 12h2.3M4.9 19.1l1.7-1.7M17.4 6.6l1.7-1.7" />
              </svg>
              <span>Settings</span>
            </button>
            {isSettingsOpen && (
              <div className="workspace-menu" role="menu" aria-label="Settings menu">
                <button
                  className="workspace-menu-item"
                  role="menuitem"
                  onClick={() => {
                    setIsDataSourceOpen(true);
                    setIsSettingsOpen(false);
                    setIsProfileOpen(false);
                  }}
                >
                  Data Sources
                </button>
              </div>
            )}
          </div>

          <div className="relative" ref={profileMenuRef}>
            <button
              className="icon-chip profile-chip"
              onClick={() => {
                setIsProfileOpen((prev) => !prev);
                setIsSettingsOpen(false);
              }}
              aria-haspopup="menu"
              aria-expanded={isProfileOpen}
            >
              A
            </button>
            {isProfileOpen && (
              <div className="workspace-menu right-0" role="menu" aria-label="Profile menu">
                <div className="px-3 py-2">
                  <p className="text-sm font-semibold text-obsidian/80">OSF User</p>
                  <p className="text-xs text-obsidian/55">user@osf.digital</p>
                </div>
                <div className="my-1 border-t border-obsidian/10" />
                <button className="workspace-menu-item" role="menuitem" onClick={handleSignOut}>
                  Logout
                </button>
              </div>
            )}
          </div>

          <button
            className="icon-chip lg:hidden"
            onClick={() => setIsMobileSummaryOpen(true)}
            aria-label="Open summary panel"
          >
            ?
          </button>
        </div>
      </header>

      <section className={`workspace-grid ${isHistoryCollapsed ? "history-collapsed" : ""}`}>
        <aside
          className={`history-panel ${isMobileHistoryOpen ? "mobile-open" : ""}`}
          aria-label="Chat history"
          ref={historyDrawerRef}
        >
          {isHistoryCollapsed && (
            <div className="history-collapsed-only hidden lg:flex">
              <span className="history-collapsed-label" aria-hidden="true">
                THREADS
              </span>
              <button
                className="history-expand-fab"
                onClick={() => setIsHistoryCollapsed(false)}
                aria-label="Expand history"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" className="history-collapse-icon">
                  <path d="M10 6l6 6-6 6" />
                </svg>
              </button>
            </div>
          )}

          <div className={`history-content ${isHistoryCollapsed ? "lg:hidden" : ""}`}>
            <div className="history-header">
              <div className="flex w-full items-center justify-between gap-2">
                <h2 className={`section-title !tracking-[0.2em] ${!isHistoryCollapsed ? "threads-fall-in" : ""}`}>
                  <span className="section-title-with-icon">
                    <svg viewBox="0 0 24 24" aria-hidden="true" className="section-title-icon">
                      <path d="M5 7h14M5 12h14M5 17h10" />
                    </svg>
                    <span>Threads</span>
                  </span>
                </h2>
                <button
                  className={`history-folder-add-btn ${isAddProjectOpen ? "active" : ""}`}
                  onClick={() => setIsAddProjectOpen((prev) => !prev)}
                  data-tooltip={isAddProjectOpen ? "Close project panel" : "Add Project"}
                  aria-label={isAddProjectOpen ? "Close project panel" : "Add Project"}
                  type="button"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9">
                    <path d="M3.5 7.5h6l1.7 2h8.8v7.8a2 2 0 0 1-2 2H5.5a2 2 0 0 1-2-2V7.5Z" />
                    <path d="M12 12v5" />
                    <path d="M9.5 14.5h5" />
                  </svg>
                </button>
              </div>
              <button
                className="icon-chip lg:hidden"
                onClick={() => setIsMobileHistoryOpen(false)}
                aria-label="Close chat history"
              >
                x
              </button>
            </div>

            <div className="history-search-wrap">
              {isAddProjectOpen && (
                <div className="history-project-create-panel">
                  <div className="history-create-row">
                    <input
                      value={newProjectDraft}
                      onChange={(event) => setNewProjectDraft(event.target.value)}
                      className="history-search-input"
                      placeholder="Project name (e.g. SFCC)"
                      aria-label="New project name"
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          addProject();
                        }
                      }}
                    />
                    <button className="history-project-filter-chip active" onClick={addProject} type="button">
                      Add Project
                    </button>
                  </div>
                </div>
              )}
              <input
                value={threadSearch}
                onChange={(event) => setThreadSearch(event.target.value)}
                className="history-search-input"
                placeholder="Search thread or project..."
                aria-label="Search threads by project or title"
              />
              <div className="history-project-filters">
                <label htmlFor="project-filter-select" className="history-project-filter-label">
                  Filter by project
                </label>
                <select
                  id="project-filter-select"
                  value={projectFilter}
                  onChange={(event) => setProjectFilter(event.target.value)}
                  className="history-project-filter-select"
                  aria-label="Filter threads by project"
                >
                  {["All", ...knownProjects].map((project) => (
                    <option key={`project-filter-${project}`} value={project}>
                      {project}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div role="listbox" aria-label="Previous chats" className="history-list">
              {groupedThreads.map(([projectGroup, groupThreads]) => (
                <div key={`group-${projectGroup}`} className="grid gap-2">
                  <div className="history-project-group-head">
                    <p className="px-1 text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-obsidian/45">
                      {projectGroup}
                    </p>
                    <div className="history-project-actions">
                      {projectGroup.trim().toLowerCase() !== DEFAULT_PROJECT_NAME.toLowerCase() && (
                        <button
                          className="history-project-icon-btn delete"
                          type="button"
                          onClick={() => handleDeleteProject(projectGroup)}
                          aria-label={`Delete project ${projectGroup}`}
                          title={`Delete project ${projectGroup}`}
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true" className="h-3.5 w-3.5">
                            <path
                              d="M5 7h14M9 7V5h6v2m-7 0 1 12h6l1-12"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.9"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </button>
                      )}
                      <button
                        className="history-project-icon-btn"
                        type="button"
                        onClick={() => startThreadInProject(projectGroup)}
                        aria-label={`Add thread in ${projectGroup}`}
                        title={`Add thread in ${projectGroup}`}
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true" className="h-3.5 w-3.5">
                          <path
                            d="M12 5v14M5 12h14"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                    </div>
                  </div>
                  {groupThreads.map((thread) => {
                    const threadProjects = getProjectsFromThread(thread);
                    return (
                      <div
                        key={thread.id}
                        className={`history-thread ${thread.id === activeThread?.id ? "active" : ""}`}
                        title={thread.title}
                      >
                        {renamingThreadId === thread.id ? (
                          <div className="history-thread-edit">
                            <label className="history-thread-edit-label">Thread title</label>
                            <input
                              autoFocus
                              value={renameDraft}
                              onChange={(event) => setRenameDraft(event.target.value)}
                              className="history-thread-input"
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  handleSaveThreadRename(thread.id);
                                }
                                if (event.key === "Escape") {
                                  event.preventDefault();
                                  setRenamingThreadId(null);
                                  setRenameDraft("");
                                  setRenameProjectDraft("");
                                }
                              }}
                              aria-label="Rename thread"
                            />
                            <label className="history-thread-edit-label">Project</label>
                            <input
                              value={renameProjectDraft}
                              onChange={(event) => setRenameProjectDraft(event.target.value)}
                              className="history-thread-input"
                              placeholder="SFCC / SFDC / Custom"
                              aria-label="Set thread project"
                              list="known-projects"
                            />
                            <div className="history-thread-edit-actions">
                              <button
                                className="history-thread-save-text"
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  handleSaveThreadRename(thread.id);
                                }}
                                aria-label={`Save renamed thread ${thread.title}`}
                                type="button"
                              >
                                Save
                              </button>
                              <button
                                className="history-thread-cancel-text"
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  setRenamingThreadId(null);
                                  setRenameDraft("");
                                  setRenameProjectDraft("");
                                }}
                                type="button"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                        <button
                          className="history-thread-main"
                          onClick={() => {
                            if (pendingDeleteThreadId === thread.id) return;
                            setActiveThreadId(thread.id);
                            setIsMobileHistoryOpen(false);
                          }}
                          role="option"
                          aria-selected={thread.id === activeThread?.id}
                        >
                          {deletingThreadId === thread.id ? (
                            <div className="history-thread-danger confirm">
                              <span className="history-thread-danger-text">Thread deleted</span>
                            </div>
                          ) : pendingDeleteThreadId === thread.id ? (
                            <div className="history-thread-danger">
                              <span className="history-thread-danger-text">Are you sure?</span>
                              <div className="history-thread-danger-actions">
                                <button
                                  className="history-thread-danger-yes"
                                  onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    handleConfirmDeleteThread(thread.id);
                                  }}
                                  aria-label={`Confirm delete ${thread.title}`}
                                >
                                  Yes
                                </button>
                                <button
                                  className="history-thread-danger-no"
                                  onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    setPendingDeleteThreadId(null);
                                  }}
                                  aria-label={`Cancel delete ${thread.title}`}
                                >
                                  No
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="grid gap-1">
                              <span className="history-thread-title">{thread.title}</span>
                              {(thread.projectTag || threadProjects.length > 0) && (
                                <div className="history-thread-projects">
                                  {[getPrimaryThreadProject(thread), ...threadProjects.filter((p) => p !== getPrimaryThreadProject(thread))]
                                    .slice(0, 2)
                                    .map((project) => (
                                    <span key={`${thread.id}-project-${project}`} className="history-thread-project-chip">
                                      {project}
                                    </span>
                                  ))}
                                  {threadProjects.length > 2 && (
                                    <span className="history-thread-project-more">+{threadProjects.length - 2}</span>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </button>
                        )}
                        {!isHistoryCollapsed && pendingDeleteThreadId !== thread.id && deletingThreadId !== thread.id && (
                          <div className="history-thread-meta">
                            <span className="history-thread-time">{formatDateTime(thread.updatedAt)}</span>
                            {renamingThreadId !== thread.id && (
                              <div className="history-thread-links">
                                <button
                                  className="history-thread-icon-btn"
                                  onClick={() => handleRenameThread(thread.id)}
                                  aria-label={`Rename ${thread.title}`}
                                  title="Rename"
                                >
                                  <svg viewBox="0 0 24 24" aria-hidden="true" className="h-3.5 w-3.5">
                                    <path
                                      d="M4 20h4l10-10-4-4L4 16v4Z"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth="1.9"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    />
                                    <path
                                      d="M12.8 7.2l4 4"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth="1.9"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    />
                                  </svg>
                                </button>
                                <button
                                  className="history-thread-icon-btn delete"
                                  onClick={() => handleDeleteThread(thread.id)}
                                  aria-label={`Delete ${thread.title}`}
                                  title="Delete"
                                >
                                  <svg viewBox="0 0 24 24" aria-hidden="true" className="h-3.5 w-3.5">
                                    <path
                                      d="M5 7h14M9 7V5h6v2m-7 0 1 12h6l1-12"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth="1.9"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    />
                                  </svg>
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
              <datalist id="known-projects">
                {knownProjects.map((project) => (
                  <option key={`known-project-${project}`} value={project} />
                ))}
              </datalist>
              {filteredThreads.length === 0 && (
                <div className="history-thread-empty">No matching threads or projects.</div>
              )}
            </div>
            <div className="history-footer hidden lg:block">
              <button
                className="history-collapse-btn"
                onClick={() => setIsHistoryCollapsed(true)}
                aria-label="Collapse history"
              >
                <span className="history-collapse-icon-wrap" aria-hidden="true">
                  <svg viewBox="0 0 24 24" className="history-collapse-icon">
                    <path d="M14 6l-6 6 6 6" />
                  </svg>
                </span>
                <span className="history-collapse-label">Collapse panel</span>
              </button>
            </div>
          </div>
        </aside>

        <section className="chat-panel" aria-label="Main chat panel">
          {isFsdPreviewOpen ? (
            <div className="fsd-preview-wrap">
              <div className="chat-panel-header flex items-center justify-between gap-3">
                <p className="section-title">FSD Preview</p>
                <button
                  className="preview-back-btn"
                  onClick={() => setIsFsdPreviewOpen(false)}
                  aria-label="Close FSD preview"
                >
                  ← Back to discussion
                </button>
              </div>
              <div className="fsd-preview-body">
                <div className="fsd-preview-outline">
                  <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-obsidian/55">
                    Outline
                  </p>
                  <div className="mt-2 grid gap-1 text-sm text-obsidian/75">
                    {fsdOutline.length > 0 ? (
                      fsdOutline.map((line, idx) => <p key={`outline-${idx}`}>{line}</p>)
                    ) : (
                      <p>No headings found yet.</p>
                    )}
                  </div>
                </div>
                <div className="fsd-preview-content">
                  <div className="fsd-preview-content-header">
                    <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-obsidian/55">
                      Content
                    </p>
                    <button
                      className="history-thread-link"
                      onClick={() => setIsFsdPreviewEditing((prev) => !prev)}
                    >
                      {isFsdPreviewEditing ? "Preview" : "Edit"}
                    </button>
                  </div>
                  {isFsdPreviewEditing ? (
                    <div className="fsd-preview-editor" data-color-mode="light">
                      <MDEditor
                        value={fsdPreviewDraft}
                        onChange={(value?: string) => setFsdPreviewDraft(value || "")}
                        preview="edit"
                        height={420}
                        visibleDragbar={false}
                      />
                    </div>
                  ) : (
                    <div className="fsd-preview-text fsd-markdown" data-color-mode="light">
                      <MDEditor.Markdown
                        source={fsdPreviewDraft.trim() ? fsdPreviewDraft : "No FSD content generated."}
                      />
                    </div>
                  )}
                </div>
              </div>
              <div className="fsd-preview-actions">
                <button
                  onClick={() => void handleExportDocx()}
                  disabled={loading || !fsdPreviewDraft.trim()}
                  className="rounded-full bg-mint px-4 py-2 text-[0.84rem] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading ? "Preparing..." : "Export FSD (.docx)"}
                </button>
                <button
                  onClick={() => void openConfluenceModal()}
                  disabled={loading || !fsdPreviewDraft.trim()}
                  className="rounded-full bg-signal px-4 py-2 text-[0.84rem] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Save to Confluence
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="chat-panel-header">
                <p className="section-title">
                  <span className="section-title-with-icon">
                    <svg viewBox="0 0 24 24" aria-hidden="true" className="section-title-icon">
                      <path d="M4 6h16v10H8l-4 4V6Z" />
                    </svg>
                    <span>Requirements Analysis</span>
                  </span>
                </p>
              </div>

              <div className={`chat-transcript ${isDiscussionIdle ? "chat-transcript-empty" : ""}`} ref={chatScrollRef}>
                <div className="chat-transcript-stack">
                {isDiscussionIdle && (
                  <div className="chat-empty-guide">
                    <div className="chat-empty-head">
                      <div className="chat-empty-intro-row">
                        <div className="chat-empty-left">
                          <img
                            src="/mascot/scout-brand-mascot-web2-transparent.png"
                            alt="Scout mascot"
                            className="chat-empty-mascot"
                          />
                        </div>
                        <div className="chat-empty-intro-copy">
                          <div className="chat-empty-kicker-row">
                            <p className="chat-empty-kicker">Start with a clear requirement</p>
                          </div>
                          <h3 className="chat-empty-title">Turn initial ideas into FSD-ready analysis</h3>
                          <p className="chat-empty-copy">
                            Share one concrete requirement with behavior, scope, and constraints or pick a sample to
                            experience the flow.
                          </p>
                          <div className="chat-empty-starters">
                            {STARTER_PROMPTS.map((prompt, idx) => (
                              <button
                                key={`starter-${idx}`}
                                className="chat-starter-chip"
                                onClick={() => {
                                  setComposer(prompt);
                                  setError("");
                                  window.setTimeout(() => composerRef.current?.focus(), 0);
                                }}
                              >
                                {prompt}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                {activeThread?.messages.map((message, index) => {
                  const followUpReply = message.role === "user" ? parseFollowUpReplyText(message.text) : null;
                  const parsedClarifications =
                    message.role === "user" && /clarifications\s*:/i.test(message.text)
                      ? parseConsolidatedClarifications(message.text)
                      : null;
                  if (followUpReply) {
                    return (
                      <div key={message.id} className="followup-message-stack">
                        <div className="followup-inline-card followup-inline-card--standalone">
                          <p className="followup-inline-label">Replying to follow-up</p>
                          <p className="followup-inline-question">{followUpReply.question}</p>
                        </div>
                        <article className="chat-bubble user chat-bubble-followup-attached">
                          <div className="chat-meta">
                            <span>You</span>
                            <span>{formatTime(message.createdAt)}</span>
                          </div>
                          <p className="chat-text followup-inline-answer">{followUpReply.answer}</p>
                        </article>
                      </div>
                    );
                  }

                  return (
                    <article
                      key={message.id}
                      className={`chat-bubble ${message.role} ${
                        message.role === "assistant" &&
                        index === 0 &&
                        activeThread?.id === introAnimationThreadId
                          ? "chat-bubble-intro"
                          : ""
                      } ${
                        message.role === "assistant" && index === 0
                          ? "chat-bubble-onboarding"
                          : ""
                      }`}
                    >
                      {(() => {
                        return (
                          <>
                      <div className="chat-meta">
                        {message.role === "user" ? (
                          <span>You</span>
                        ) : (
                          <span className="chat-author">
                            <img src="/scout-profile-icon.svg" alt="" className="chat-author-icon" aria-hidden="true" />
                            <span>AI Analyst</span>
                          </span>
                        )}
                        <span>{formatTime(message.createdAt)}</span>
                      </div>
                      {parsedClarifications ? (
                        <div className="clarification-structured">
                          <span className="clarification-kicker">Clarifications Captured</span>
                          <div className="clarification-qa-list">
                            {parsedClarifications.pairs.map((entry, idx) => (
                              <div key={`${message.id}-clar-${idx}`} className="clarification-qa-item">
                                {entry.question ? (
                                  <p className="clarification-q">
                                    <span className="clarification-label">{`Q${idx + 1}`}</span>
                                    {entry.question}
                                  </p>
                                ) : null}
                                {entry.answer ? (
                                  <p className="clarification-a">
                                    <span className="clarification-label">{`A${idx + 1}`}</span>
                                    {entry.answer}
                                  </p>
                                ) : null}
                              </div>
                            ))}
                          </div>
                          {parsedClarifications.summary ? (
                            <div className="clarification-summary">
                              <p className="clarification-summary-label">Final Context Summary</p>
                              {parsedClarifications.summaryPoints.length > 1 ? (
                                <ul className="clarification-summary-list">
                                  {parsedClarifications.summaryPoints.map((point, idx) => (
                                    <li key={`${message.id}-summary-${idx}`}>{point}</li>
                                  ))}
                                </ul>
                              ) : (
                                <p className="clarification-summary-text">{parsedClarifications.summary}</p>
                              )}
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <p className="chat-text">{message.text}</p>
                      )}
                          </>
                        );
                      })()}

                      {message.attachments?.length ? (
                        <div className="chat-attachments">
                          {message.attachments.map((item) => (
                            <span key={item.id} className="attachment-chip">
                              {item.name} ({Math.max(1, Math.round(item.size / 1024))} KB)
                            </span>
                          ))}
                        </div>
                      ) : null}

                      {message.detailedResult ? (
                        <div className="analysis-detailed-card">
                          {(() => {
                            return (
                              <>
                          <div className="analysis-item-header">
                            <span className="text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-obsidian/55">
                              Detailed Analysis
                            </span>
                            <span className={`badge ${classifyTone(message.detailedResult.classification)}`}>
                              {classificationBadgeLabel(
                                message.detailedResult.classification,
                                message.detailedResult.confidence
                              )}
                            </span>
                          </div>
                          <div className="analysis-response-box">
                            <ul className="mt-1 space-y-1 text-[0.78rem] text-obsidian/80">
                              <li>
                                <span className="font-semibold">Implementation mode:</span>{" "}
                                {prettyFlowValue(message.detailedResult.implementationMode)}
                              </li>
                              <li>
                                <span className="font-semibold">Coverage status:</span>{" "}
                                {prettyFlowValue(message.detailedResult.coverageStatus)}
                              </li>
                              <li>
                                <span className="font-semibold">Project match status:</span>{" "}
                                {prettyFlowValue(message.detailedResult.projectMatchStatus)}
                              </li>
                              <li>
                                <span className="font-semibold">SFRA baseline reference:</span>{" "}
                                {message.detailedResult.sfraBaselineReference ? (
                                  <>
                                    {message.detailedResult.sfraBaselineReference.sentence}{" "}
                                    {message.detailedResult.sfraBaselineReference.url ? (
                                      <a
                                        href={message.detailedResult.sfraBaselineReference.url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="analysis-inline-link"
                                      >
                                        (source)
                                      </a>
                                    ) : null}
                                  </>
                                ) : (
                                  "No direct SFRA baseline sentence match returned in this run."
                                )}
                              </li>
                            </ul>
                          </div>
                          {message.detailedResult.references.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {message.detailedResult.references.map((source) => (
                                source.url ? (
                                  <a
                                    key={`${source.url}-${source.title}`}
                                    href={source.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="rounded-full border border-obsidian/10 px-3 py-1 text-[0.65rem] text-obsidian/70"
                                  >
                                    {source.title}
                                  </a>
                                ) : (
                                  <span
                                    key={`${source.source || "source"}-${source.sourceId || source.title}`}
                                    className="rounded-full border border-obsidian/10 bg-white/70 px-3 py-1 text-[0.65rem] text-obsidian/70"
                                  >
                                    {source.title}
                                  </span>
                                )
                              ))}
                            </div>
                          )}
                              </>
                            );
                          })()}
                        </div>
                      ) : message.analysisResults?.length ? (
                        <div className="analysis-grid">
                          {message.analysisResults.map((item, analysisIndex) => (
                            <div key={`${item.requirement}-${analysisIndex}`} className="analysis-item">
                              {(() => {
                                const requirementContext = splitRequirementContext(item.requirement);
                                return (
                                  <>
                              <div className="analysis-item-header">
                                <span className="text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-obsidian/55">
                                  Requirement Context
                                </span>
                                <span className={`badge ${classifyTone(item.classification)}`}>
                                  {item.classification}
                                </span>
                              </div>
                              <div className="analysis-requirement-box">
                                <p className="text-xs leading-relaxed text-obsidian/64">
                                  {requirementContext.primary}
                                </p>
                                {requirementContext.extras.length > 0 && (
                                  <ul className="mt-2 list-disc pl-5 text-xs leading-relaxed text-obsidian/64">
                                    {requirementContext.extras.map((extra, extraIdx) => (
                                      <li key={`${item.requirement}-extra-${extraIdx}`}>{extra}</li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                              <div className="analysis-response-box">
                                <p className="analysis-response-label">Analysis Response</p>
                                <p className="mt-1 text-sm font-medium leading-relaxed text-obsidian/88">
                                  {item.rationale}
                                </p>
                              </div>
                                  </>
                                );
                              })()}
                              <div className="mt-2 flex flex-wrap gap-2">
                                {getSources(item).slice(0, 2).map((source) => (
                                  source.url ? (
                                    <a
                                      key={`${source.url}-${source.title}`}
                                      href={source.url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="rounded-full border border-obsidian/10 px-3 py-1 text-[0.65rem] text-obsidian/70"
                                    >
                                      {source.title}
                                    </a>
                                  ) : (
                                    <span
                                      key={`${source.source || "source"}-${source.sourceId || source.title}`}
                                      className="rounded-full border border-obsidian/10 bg-white/70 px-3 py-1 text-[0.65rem] text-obsidian/70"
                                    >
                                      {source.title}
                                    </span>
                                  )
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : null}
                      {message.role === "assistant" && index > 0 && message.analysisResults?.length && (
                        <div className="mt-3 flex justify-end">
                          {recentlyAddedToSidebar?.threadId === activeThreadId &&
                            recentlyAddedToSidebar?.messageId === message.id && (
                              <span className="mr-2 self-center text-[0.68rem] font-semibold text-signal chat-inline-toast">
                                Added to FSD
                              </span>
                            )}
                          <button
                            className="chat-fsd-btn"
                            onClick={() => handleAddToFsd(message)}
                            disabled={activeAddedMessageIds.has(message.id)}
                          >
                            <svg viewBox="0 0 24 24" aria-hidden="true" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M12 5v14M5 12h14" />
                            </svg>
                            <span>{activeAddedMessageIds.has(message.id) ? "Added to FSD" : "Add to FSD"}</span>
                          </button>
                        </div>
                      )}
                    </article>
                  );
                })}
                {isChatAnalyzing && (
                  <article className="chat-bubble assistant">
                    <div className="chat-meta">
                      <span className="chat-author">
                        <img src="/scout-profile-icon.svg" alt="" className="chat-author-icon" aria-hidden="true" />
                        <span>AI Analyst</span>
                      </span>
                    </div>
                    <div className="ai-loader-row">
                      <span className="ai-loader-icon" aria-hidden="true" />
                      <p className="chat-text ai-loader-text">{ANALYSIS_STEPS[analysisStepIndex]}...</p>
                    </div>
                  </article>
                )}
                </div>
              </div>

              <div
                className={`chat-composer-wrap ${isDiscussionIdle ? "chat-composer-wrap-highlight" : ""} ${
                  isGuidedInputLocked ? "chat-composer-wrap-guided" : ""
                }`}
              >
                {activeGuidedCycle &&
                  !guidedBootstrapping &&
                  (activeGuidedCycle.status === "guided" || activeGuidedCycle.status === "cancelled") && (
                    <div className="guided-card guided-card-in-composer">
                      {(() => {
                        const isGuidedStepLoading =
                          activeGuidedCycle.status === "guided" &&
                          guidedLoading &&
                          !activeGuidedCycle.currentQuestion &&
                          (activeGuidedCycle.currentOptions?.length || 0) === 0 &&
                          !activeGuidedCycle.isTerminal;
                        const isFinalGuidedStep =
                          activeGuidedCycle.status === "guided" &&
                          (activeGuidedCycle.isTerminal ||
                            activeGuidedCycle.currentStepIndex >= activeGuidedCycle.maxSteps - 1);
                        const isNextThinking =
                          activeGuidedCycle.status === "guided" &&
                          guidedLoading &&
                          !isFinalGuidedStep &&
                          !isGuidedStepLoading;
                        return (
                          <>
                      <div className="guided-card-head">
                        <p className="guided-kicker">
                          Guided Follow-up • Step{" "}
                          {Math.min(activeGuidedCycle.currentStepIndex + 1, activeGuidedCycle.maxSteps)} of{" "}
                          {activeGuidedCycle.maxSteps}
                        </p>
                        <button className="guided-dismiss" onClick={handleDismissGuided}>
                          Dismiss (Esc)
                        </button>
                      </div>
                      {isGuidedStepLoading ? (
                        <div className="guided-loading-stage" aria-live="polite">
                          <span className="guided-loading-icon" aria-hidden="true" />
                          <p className="guided-loading-text">Preparing next follow-up question...</p>
                        </div>
                      ) : activeGuidedCycle.status === "cancelled" ? (
                        <p className="guided-cancel-note">
                          Guided questions were dismissed. You can still analyze using collected context.
                        </p>
                      ) : activeGuidedCycle.isTerminal && !activeGuidedCycle.currentQuestion ? (
                        <p className="guided-cancel-note">
                          Follow-up context is complete. Click <strong>Analyze now</strong> to generate the final
                          response.
                        </p>
                      ) : (
                        <div
                          key={`${activeGuidedCycle.currentStepIndex}-${activeGuidedCycle.currentQuestion || "step"}`}
                          className="guided-step-stage"
                        >
                          <p className="guided-question">
                            {activeGuidedCycle.currentQuestion || "Loading follow-up question..."}
                          </p>
                          <div className="guided-options">
                            {(activeGuidedCycle.currentOptions || []).map((option, idx) => (
                              <button
                                key={`${option.label}-${idx}`}
                                className={`guided-option ${selectedGuidedOption === option.label ? "selected" : ""}`}
                                onClick={() => {
                                  setSelectedGuidedOption(option.label);
                                  setGuidedCustomDraft("");
                                }}
                                disabled={guidedLoading}
                              >
                                <span>{option.label}</span>
                                {option.recommended && <span className="guided-badge">Recommended</span>}
                              </button>
                            ))}
                          </div>
                          <div className="guided-custom-row">
                            <input
                              value={guidedCustomDraft}
                              onChange={(event) => {
                                setGuidedCustomDraft(event.target.value);
                                if (event.target.value.trim()) setSelectedGuidedOption("");
                              }}
                              placeholder="Or add custom input..."
                              className="guided-custom-input"
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  if (!guidedLoading) void handleGuidedNext();
                                }
                              }}
                            />
                          </div>
                        </div>
                      )}
                      <div className="guided-actions">
                        {activeGuidedCycle.status === "guided" && isFinalGuidedStep && !isGuidedStepLoading && (
                          <p className="guided-final-note">Click Analyze now to generate the final response.</p>
                        )}
                        {!isNextThinking && (
                          <button
                            className={`guided-analyze-btn ${isFinalGuidedStep ? "guided-analyze-btn-primary" : ""}`}
                            onClick={() => void handleAnalyzeNow()}
                            disabled={loading || guidedLoading || !activeGuidedCycle.baseRequirement}
                          >
                            <svg viewBox="0 0 24 24" aria-hidden="true" className="guided-btn-icon" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M14 5h5v5" />
                              <path d="M10 14L19 5" />
                              <path d="M19 14v5h-5" />
                              <path d="M5 10V5h5" />
                              <path d="M5 19l9-9" />
                            </svg>
                            <span>Analyze now</span>
                          </button>
                        )}
                        {activeGuidedCycle.status === "guided" && !isFinalGuidedStep && !isGuidedStepLoading && (
                          <button
                            className={`guided-next-btn ${isNextThinking ? "guided-next-thinking-shift" : ""}`}
                            onClick={() => void handleGuidedNext()}
                            disabled={guidedLoading}
                          >
                            {guidedLoading ? (
                              <span className="guided-next-loading">
                                <span className="guided-next-spinner" aria-hidden="true" />
                                <span>Thinking</span>
                              </span>
                            ) : (
                              <>
                                <span>Next</span>
                                <svg
                                  viewBox="0 0 24 24"
                                  aria-hidden="true"
                                  className="guided-btn-icon"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                >
                                  <path d="M5 12h14" />
                                  <path d="m13 5 7 7-7 7" />
                                </svg>
                              </>
                            )}
                          </button>
                        )}
                      </div>
                          </>
                        );
                      })()}
                    </div>
                  )}
                {isGuidedInputLocked ? (
                  <div className="chat-composer-backplate" aria-hidden="true" />
                ) : (
                  <>
                    <div className="chat-attachments-list">
                      {attachments.map((item) => (
                        <span key={item.id} className="attachment-chip">
                          {item.name}
                          <button
                            className="ml-2 text-obsidian/60"
                            onClick={() => removeAttachment(item.id)}
                            aria-label={`Remove ${item.name}`}
                          >
                            x
                          </button>
                        </span>
                      ))}
                    </div>
                    <div className="chat-composer" role="group" aria-label="Message composer">
                      <label className="composer-attach">
                        +
                        <input
                          type="file"
                          className="hidden"
                          multiple
                          onChange={(event) => handleAttachFiles(event.target.files)}
                        />
                      </label>
                      <textarea
                        ref={composerRef}
                        value={composer}
                        onChange={(event) => setComposer(event.target.value)}
                        className="composer-input"
                        placeholder="Discuss scope, requirements, assumptions, and constraints..."
                        disabled={guidedBootstrapping}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" && !event.shiftKey) {
                            event.preventDefault();
                            if (!loading) void handleSend();
                          }
                        }}
                      />
                      <button
                        onClick={() => void handleSend()}
                        className="composer-send"
                        disabled={loading || guidedBootstrapping || (!composer.trim() && attachments.length === 0)}
                      >
                        {guidedBootstrapping ? (
                          <>
                            <span className="composer-thinking-icon" aria-hidden="true">
                              <span className="composer-thinking-spinner" />
                            </span>
                            <span>Thinking</span>
                          </>
                        ) : (
                          <>
                            <svg viewBox="0 0 24 24" aria-hidden="true" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M3 11.5 21 3l-8.5 18-2.2-6.3L3 11.5Z" />
                              <path d="M10.3 14.7 21 3" />
                            </svg>
                            <span>Send</span>
                          </>
                        )}
                      </button>
                    </div>
                  </>
                )}
                <p className="mt-2 text-center text-[0.7rem] text-obsidian/55">
                  Responses can be inaccurate; please double check before finalizing.
                </p>
                {error && <p className="text-xs font-semibold text-rose">{error}</p>}
              </div>
            </>
          )}
        </section>

        <aside
          className={`summary-panel ${isMobileSummaryOpen ? "mobile-open" : ""}`}
          aria-label="Summary and analysis"
          ref={summaryDrawerRef}
        >
            <div className="summary-header">
              <div>
              <p className="section-title">
                <span className="section-title-with-icon">
                  <svg viewBox="0 0 24 24" aria-hidden="true" className="section-title-icon">
                    <path d="M7 4h8l4 4v12H7V4Zm8 0v4h4M9 12h8M9 15h8M9 18h5" />
                  </svg>
                  <span>FSD Builder</span>
                </span>
              </p>
              </div>
            <button
              className="icon-chip lg:hidden"
              onClick={() => setIsMobileSummaryOpen(false)}
              aria-label="Close summary panel"
            >
              x
            </button>
          </div>

          <div className={`summary-metrics ${isCoverageEmpty ? "is-empty" : ""}`}>
            <div className="summary-metrics-head">
              <p className="summary-metrics-title">Overall Coverage</p>
              <p className="summary-metrics-subtitle">Data from finalized points added to FSD.</p>
            </div>
            {isCoverageEmpty ? (
              <div className="summary-metric-empty">
                <span className="summary-metric-empty-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9">
                    <path d="M4 18h16" />
                    <path d="M7 18v-5" />
                    <path d="M12 18v-8" />
                    <path d="M17 18v-3" />
                  </svg>
                </span>
                <p>Coverage data will appear once FSD points are added.</p>
              </div>
            ) : (
              <>
                <div className="summary-metric summary-metric-total">
                  <span>Total</span>
                  <strong>{fsdCoverageCounts.total}</strong>
                </div>
                <div className="summary-metric summary-metric-ootb">
                  <div className="summary-metric-copy">
                    <span>OOTB</span>
                    <em>{fsdCoverageCounts.ootb} points</em>
                  </div>
                  <div
                    className="summary-metric-ring"
                    style={{
                      background: `conic-gradient(var(--ring-color) ${summaryPercentages.ootb * 3.6}deg, rgba(148, 163, 184, 0.2) 0deg)`,
                    }}
                  >
                    <span>{summaryPercentages.ootb}%</span>
                  </div>
                </div>
                <div className="summary-metric summary-metric-partial">
                  <div className="summary-metric-copy">
                    <span>Partial</span>
                    <em>{fsdCoverageCounts.partial} points</em>
                  </div>
                  <div
                    className="summary-metric-ring"
                    style={{
                      background: `conic-gradient(var(--ring-color) ${summaryPercentages.partial * 3.6}deg, rgba(148, 163, 184, 0.2) 0deg)`,
                    }}
                  >
                    <span>{summaryPercentages.partial}%</span>
                  </div>
                </div>
                <div className="summary-metric summary-metric-custom">
                  <div className="summary-metric-copy">
                    <span>Custom Dev</span>
                    <em>{fsdCoverageCounts.custom} points</em>
                  </div>
                  <div
                    className="summary-metric-ring"
                    style={{
                      background: `conic-gradient(var(--ring-color) ${summaryPercentages.custom * 3.6}deg, rgba(148, 163, 184, 0.2) 0deg)`,
                    }}
                  >
                    <span>{summaryPercentages.custom}%</span>
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="summary-insights">
            {activeFsdSelections.length === 0 ? (
              <div className="summary-empty-state">
                <span className="summary-empty-icon" aria-hidden="true">
                  <svg
                    viewBox="0 0 24 24"
                    className="h-5 w-5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.9"
                  >
                    <path d="M4 6.5c0-1.1.9-2 2-2h12c1.1 0 2 .9 2 2v8c0 1.1-.9 2-2 2H9l-4 3v-3H6c-1.1 0-2-.9-2-2v-8Z" />
                    <path d="M8 9h8M8 12h5" />
                  </svg>
                </span>
                <p className="summary-empty-title">No finalized FSD points yet</p>
                <p className="summary-empty-copy">
                  Start a discussion, validate responses, then add approved requirement-analysis pairs to build
                  your final document.
                </p>
                <div className="summary-empty-steps" aria-label="How to build FSD">
                  <span className="summary-empty-step">1. Discuss requirements</span>
                  <span className="summary-empty-step">2. Click Add to FSD</span>
                  <span className="summary-empty-step">3. Preview and export</span>
                </div>
              </div>
            ) : (
              <>
                {sortedFsdSelections.map((item) => {
                    const isExpanded = expandedSummaryItemIds.has(item.id);
                    return (
                      <div key={item.id} className="summary-card">
                        <div className="summary-card-head">
                          <div className="summary-card-title-wrap">
                            <p className="summary-card-title">
                              {item.requirementText || "Requirement captured from discussion"}
                            </p>
                            <p className="summary-card-meta">
                              {formatDateTime(item.createdAt)} • Effort: {item.effort}
                            </p>
                          </div>
                          <div className="summary-actions">
                            <button
                              className="summary-expand-link"
                              onClick={() => toggleSummaryItemExpansion(item.id)}
                              aria-label={isExpanded ? "Collapse FSD point" : "Expand FSD point"}
                              title={isExpanded ? "Collapse" : "Expand"}
                            >
                              <svg
                                viewBox="0 0 24 24"
                                aria-hidden="true"
                                className="h-3.5 w-3.5"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                              >
                                {isExpanded ? <path d="m7 14 5-5 5 5" /> : <path d="m7 10 5 5 5-5" />}
                              </svg>
                            </button>
                            <button
                              className="summary-remove-link"
                              onClick={() => handleRemoveFromFsd(item.id, item.messageId)}
                              aria-label="Remove FSD point"
                              title="Remove"
                            >
                              <svg
                                viewBox="0 0 24 24"
                                aria-hidden="true"
                                className="h-3.5 w-3.5"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                              >
                                <path d="M4 7h16" />
                                <path d="M9 7V5h6v2" />
                                <path d="M7 7l1 12h8l1-12" />
                                <path d="M10 11v5M14 11v5" />
                              </svg>
                            </button>
                          </div>
                        </div>

                        {isExpanded && (
                          <>
                            {item.clarifications.length > 0 && (
                              <div className="summary-section-box">
                                <p className="summary-section-label">Clarifications</p>
                                <ul className="summary-clarification-list">
                                  {item.clarifications.map((entry, idx) => (
                                    <li key={`${item.id}-clar-${idx}`}>
                                      <span className="summary-clarification-q">{entry.question}</span>
                                      <span className="summary-clarification-a">{entry.answer}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            <div className="summary-section-box">
                              <p className="summary-section-label">
                                {item.classifications[0]
                                  ? `Analysis • ${item.classifications[0]}`
                                  : "Analysis"}
                              </p>
                              <p className="summary-analysis-text">{item.response}</p>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
              </>
            )}
          </div>

          <div className="summary-export">
            <button
              onClick={() => void handleOpenFsdPreview()}
              disabled={fsdPreviewLoading || !selectedGapResults.length}
              className="fsd-sidebar-action-btn inline-flex w-full items-center justify-center gap-2 rounded-full bg-steel text-[0.84rem] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {fsdPreviewLoading ? (
                <>
                  <span className="preview-loader-icon" aria-hidden="true" />
                  <span className="preview-loader-text">Generating preview...</span>
                </>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" aria-hidden="true" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M15 18l-6-6 6-6" />
                  </svg>
                  <span>Preview FSD</span>
                </>
              )}
            </button>
            {fsdPreviewDraft.trim() && (
              <>
                <button
                  onClick={() => void handleExportDocx()}
                  disabled={loading || !fsdPreviewDraft.trim()}
                  className="fsd-sidebar-action-btn mt-2 inline-flex w-full items-center justify-center gap-2 rounded-full bg-mint text-[0.84rem] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading ? (
                    "Preparing..."
                  ) : (
                    <>
                      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 4v10" />
                        <path d="M8 10l4 4 4-4" />
                        <path d="M4 20h16" />
                      </svg>
                      <span>Export FSD (.docx)</span>
                    </>
                  )}
                </button>
                <button
                  onClick={() => void openConfluenceModal()}
                  disabled={loading || !fsdPreviewDraft.trim()}
                  className="fsd-sidebar-action-btn mt-2 inline-flex w-full items-center justify-center gap-2 rounded-full bg-signal text-[0.84rem] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M8 6h8l4 4v8H8V6Z" />
                    <path d="M16 6v4h4" />
                    <path d="M4 10h4v10h12" />
                  </svg>
                  <span>Save to Confluence</span>
                </button>
              </>
            )}
          </div>
          <p className="mt-2 pb-[5px] text-center text-[0.7rem] text-obsidian/55">
            Open preview to review outline and access export/save actions.
          </p>
        </aside>
      </section>

      {(isMobileHistoryOpen || isMobileSummaryOpen) && (
        <button className="mobile-overlay" aria-label="Close panels" onClick={closeOverlays} />
      )}

      {isConfluenceModalOpen && (
        <div className="workspace-modal-backdrop" role="dialog" aria-modal="true" aria-label="Save to Confluence">
          <div className="workspace-modal">
            <div className="workspace-modal-header">
              <h3 className="font-display text-xl text-obsidian">Save to Confluence</h3>
              <button
                className="icon-chip"
                onClick={() => setIsConfluenceModalOpen(false)}
                aria-label="Close save modal"
              >
                x
              </button>
            </div>

            <div className="workspace-modal-body">
              <label className="workspace-field">
                <span>Space</span>
                <select
                  value={confluenceSpaceKey}
                  onChange={(event) => void handleSpaceChange(event.target.value)}
                  className="workspace-input"
                  disabled={confluenceLoading}
                >
                  <option value="">Select a space</option>
                  {confluenceSpaces.map((space) => (
                    <option key={space.key} value={space.key}>
                      {space.name} ({space.key})
                    </option>
                  ))}
                </select>
              </label>

              <label className="workspace-field">
                <span>Folder</span>
                <select
                  value={confluenceParentId}
                  onChange={(event) => setConfluenceParentId(event.target.value)}
                  className="workspace-input"
                  disabled={confluenceLoading || !confluenceSpaceKey}
                >
                  <option value="">Select a folder</option>
                  {confluenceFolders.map((folder) => (
                    <option key={folder.id} value={folder.id}>
                      {folder.title}
                    </option>
                  ))}
                </select>
              </label>

              <label className="workspace-field">
                <span>Filename</span>
                <input
                  value={confluenceTitle}
                  onChange={(event) => {
                    setConfluenceTitle(event.target.value);
                    setConfluenceDuplicateWarning("");
                  }}
                  className="workspace-input"
                  placeholder="FSD - Checkout Enhancements"
                />
              </label>

              {confluenceDuplicateWarning && (
                <p className="text-xs font-semibold text-amber">{confluenceDuplicateWarning}</p>
              )}
              {confluenceError && <p className="text-xs font-semibold text-rose">{confluenceError}</p>}
            </div>

            <div className="workspace-modal-actions">
              <button
                className="rounded-full border border-obsidian/15 px-4 py-2 text-sm font-semibold text-obsidian/70"
                onClick={() => setIsConfluenceModalOpen(false)}
              >
                Cancel
              </button>
              <button
                className="rounded-full bg-signal px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                disabled={confluenceLoading}
                onClick={() => void handleConfluenceSave()}
              >
                {confluenceLoading ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {isHelpOpen && (
        <div className="workspace-modal-backdrop" role="dialog" aria-modal="true" aria-label="Help instructions">
          <div className="workspace-modal">
            <div className="workspace-modal-header">
              <h3 className="font-display text-xl text-obsidian">Help</h3>
              <button className="icon-chip" onClick={() => setIsHelpOpen(false)} aria-label="Close help">
                x
              </button>
            </div>
            <div className="workspace-modal-body">
              <p className="text-sm text-obsidian/75">
                Use this workspace to discuss requirements, capture finalized FSD points, and generate
                export-ready output.
              </p>
              <ol className="grid gap-2 text-sm text-obsidian/75">
                <li>1. Start a thread and discuss requirements with AI in the center panel.</li>
                <li>2. Use <span className="font-semibold">Add to FSD</span> on useful AI responses.</li>
                <li>3. Review selected points in the right panel and click <span className="font-semibold">Preview FSD</span>.</li>
                <li>4. From preview, export the file or save it to Confluence.</li>
              </ol>
            </div>
            <div className="workspace-modal-actions">
              <button
                className="rounded-full bg-obsidian px-5 py-2 text-sm font-semibold text-white"
                onClick={() => setIsHelpOpen(false)}
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}

      {isDataSourceOpen && (
        <div className="workspace-modal-backdrop" role="dialog" aria-modal="true" aria-label="Data source settings">
          <div className="workspace-modal datasource-modal">
            <div className="workspace-modal-header">
              <h3 className="text-lg font-semibold text-obsidian">Data Sources</h3>
              <button className="icon-chip" onClick={() => setIsDataSourceOpen(false)} aria-label="Close data sources">
                x
              </button>
            </div>
            <div className="workspace-modal-body">
              <section className="datasource-section">
                <div className="datasource-section-head">
                  <p className="text-sm font-semibold text-obsidian/80">SFRA Baseline Sources</p>
                  <p className="text-xs text-obsidian/60">
                    Add handpicked links and notes on what should be considered during analysis.
                  </p>
                </div>
                <div className="datasource-list">
                  {baselineLinks.map((item) => (
                    <div key={item.id} className="datasource-row">
                      <input
                        value={item.url}
                        onChange={(event) => handleUpdateBaselineLink(item.id, "url", event.target.value)}
                        className="workspace-input"
                        placeholder="https://..."
                      />
                      <textarea
                        value={item.note}
                        onChange={(event) => handleUpdateBaselineLink(item.id, "note", event.target.value)}
                        className="workspace-input datasource-note-input"
                        placeholder="What to consider from this source..."
                      />
                      <button
                        className="datasource-remove-btn"
                        onClick={() => handleRemoveBaselineLink(item.id)}
                        aria-label="Remove baseline source"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
                <div className="datasource-add-row">
                  <input
                    value={newBaselineUrl}
                    onChange={(event) => setNewBaselineUrl(event.target.value)}
                    className="workspace-input"
                    placeholder="Add source URL"
                  />
                  <input
                    value={newBaselineNote}
                    onChange={(event) => setNewBaselineNote(event.target.value)}
                    className="workspace-input"
                    placeholder="Add note for this source"
                  />
                  <button className="datasource-add-btn" onClick={handleAddBaselineLink}>
                    + Add
                  </button>
                </div>
              </section>

              {(isIngestingDataSources || ingestProgress > 0) && (
                <section className="datasource-ingest-progress">
                  <div className="datasource-ingest-head">
                    <p className="datasource-ingest-title">
                      Ingestion progress: {Math.max(0, Math.min(100, Math.round(ingestProgress)))}%
                    </p>
                    <p className="datasource-ingest-estimate">
                      {ingestStartedAt
                        ? `Elapsed ${Math.max(1, Math.floor((Date.now() - ingestStartedAt) / 1000))}s • Estimated 1-3 minutes for larger source sets`
                        : "Estimated 1-3 minutes for larger source sets"}
                    </p>
                  </div>
                  <div className="datasource-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ingestProgress)}>
                    <span className="datasource-progress-fill" style={{ width: `${Math.max(2, ingestProgress)}%` }} />
                  </div>
                  <p className="datasource-ingest-note">
                    {isIngestingDataSources ? "Ingestion is in progress. Estimated completion depends on source volume." : ingestStatusText}
                  </p>
                  {ingestJobId && <p className="datasource-ingest-jobid">Job ID: {ingestJobId}</p>}
                </section>
              )}
              {dataSourceNotice && <p className="text-xs font-semibold text-mint">{dataSourceNotice}</p>}
              {dataSourceError && <p className="text-xs font-semibold text-rose">{dataSourceError}</p>}
            </div>
            <div className="workspace-modal-actions">
              <button className="rounded-full border border-obsidian/15 px-4 py-2 text-sm" onClick={() => setIsDataSourceOpen(false)}>
                Close
              </button>
              <button
                className="rounded-full bg-signal px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                onClick={() => void handleIngestDataSources()}
                disabled={isIngestingDataSources}
              >
                {isIngestingDataSources ? "Ingesting..." : "Ingest"}
              </button>
            </div>
          </div>
        </div>
      )}

      {isOnboardingOpen && (
        <div
          className="workspace-modal-backdrop onboarding-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Welcome onboarding"
        >
          <div className="workspace-modal onboarding-modal">
            <div className="workspace-modal-header">
              <h3 className="font-display text-2xl text-obsidian">
                <span className="inline-flex items-center gap-2">
                  <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5 text-signal" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 3l2.2 4.6L19 9l-3.5 3.4.8 4.8-4.3-2.3-4.3 2.3.8-4.8L5 9l4.8-1.4L12 3Z" />
                  </svg>
                  <span>Welcome to Scout!</span>
                </span>
              </h3>
            </div>
            <div className="workspace-modal-body">
              <p className="text-sm leading-6 text-obsidian/75">
                This tool helps you discuss project scope with AI, analyze requirement coverage, and
                produce an FSD-ready output in one flow.
              </p>
              <div className="rounded-2xl border border-signal/20 bg-white p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-obsidian/55">
                  How to use
                </p>
                <ol className="mt-3 grid gap-2 text-sm text-obsidian/75">
                  <li>1. Start a new chat and share your requirement scope.</li>
                  <li>2. Review AI gap analysis in the main chat and summary panel.</li>
                  <li>3. Export FSD or save to Confluence when finalized.</li>
                </ol>
              </div>
            </div>
            <div className="workspace-modal-actions">
              <button
                className="inline-flex items-center gap-2 rounded-full bg-steel px-5 py-2 text-sm font-semibold text-white"
                onClick={() => setIsOnboardingOpen(false)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 3v6m0 0 3-3m-3 3-3-3" />
                  <path d="M5 13.5a7 7 0 1 0 14 0" />
                </svg>
                <span>Start Brainstorming</span>
              </button>
            </div>
          </div>
        </div>
      )}

      <footer className="workspace-footer" aria-label="Footer links">
        <span>© {new Date().getFullYear()} OSF Digital. All rights reserved.</span>
        <div className="workspace-footer-links">
          <a href="#" className="workspace-footer-link">
            Terms & Conditions
          </a>
          <a href="#" className="workspace-footer-link">
            Privacy
          </a>
          <a href="#" className="workspace-footer-link">
            Contact
          </a>
        </div>
      </footer>
    </main>
  );
}

/* eslint-disable react/no-unescaped-entities */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import MDEditor from "@uiw/react-md-editor";
import {
  ConfluenceFolder,
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
  response: string;
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
    references: Array<{ title: string; url: string }>;
    finalRequirement: string;
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
  messages: ChatMessage[];
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
  const lines = [`Requirement: ${ensureSentence(baseRequirement)}`];
  if (answers.length) {
    lines.push("Clarifications:");
    answers.forEach((entry, index) => {
      lines.push(`Q${index + 1}: ${entry.question}`);
      lines.push(`A${index + 1}: ${entry.answer}`);
    });
  }
  const summary = answers.map((entry) => entry.answer.trim()).filter(Boolean).join(" ");
  if (summary) {
    lines.push(`Final context summary: ${summary}`);
  }
  return lines.join("\n");
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
  const sources: Array<{ title: string; url: string }> = [];
  for (const chunk of item.top_chunks || []) {
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

const getProjectsFromResult = (item: GapResult) => {
  const projects = new Set<string>();
  for (const chunk of item.top_chunks || []) {
    const meta = chunk.metadata || {};
    const project =
      (typeof meta.project === "string" && meta.project) ||
      (typeof meta.space_key === "string" && meta.space_key) ||
      "";
    if (project.trim()) projects.add(project.trim());
  }
  return Array.from(projects);
};

const getProjectsFromThread = (thread: ChatThread) => {
  const projects = new Set<string>();
  for (const message of thread.messages) {
    for (const item of message.analysisResults || []) {
      for (const project of getProjectsFromResult(item)) projects.add(project);
    }
  }
  return Array.from(projects);
};

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

const createThread = (seed?: string): ChatThread => {
  const now = new Date().toISOString();
  const title = seed ? firstMeaningfulLine(seed).slice(0, 60) : "New scope discussion";
  return {
    id: crypto.randomUUID(),
    title,
    updatedAt: now,
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
  const [pendingDeleteThreadId, setPendingDeleteThreadId] = useState<string | null>(null);
  const [deletingThreadId, setDeletingThreadId] = useState<string | null>(null);
  const [introAnimationThreadId, setIntroAnimationThreadId] = useState<string | null>(null);
  const [guidedCycleByThread, setGuidedCycleByThread] = useState<Record<string, GuidedCycle | null>>({});
  const [guidedCustomDraft, setGuidedCustomDraft] = useState("");
  const [guidedLoading, setGuidedLoading] = useState(false);
  const [selectedGuidedOption, setSelectedGuidedOption] = useState<string>("");
  const [recentlyAddedToSidebar, setRecentlyAddedToSidebar] = useState<{
    threadId: string;
    messageId: string;
  } | null>(null);
  const [threadSearch, setThreadSearch] = useState("");
  const [expandedAnalysisKeys, setExpandedAnalysisKeys] = useState<Set<string>>(new Set());

  const historyDrawerRef = useRef<HTMLDivElement | null>(null);
  const summaryDrawerRef = useRef<HTMLDivElement | null>(null);
  const settingsMenuRef = useRef<HTMLDivElement | null>(null);
  const profileMenuRef = useRef<HTMLDivElement | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

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

  const activeFsdSelections = useMemo(
    () => fsdSelectionsByThread[activeThreadId] || [],
    [fsdSelectionsByThread, activeThreadId]
  );
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

  const latestCounts = useMemo(() => statusCounts(latestAnalysisResults), [latestAnalysisResults]);

  const summaryPercentages = useMemo(() => {
    const total = latestCounts.total || 1;
    return {
      ootb: Math.round((latestCounts.ootb / total) * 100),
      partial: Math.round((latestCounts.partial / total) * 100),
      custom: Math.round((latestCounts.custom / total) * 100),
      open: Math.round((latestCounts.open / total) * 100),
    };
  }, [latestCounts]);

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

  const closeOverlays = () => {
    setIsMobileHistoryOpen(false);
    setIsMobileSummaryOpen(false);
    setIsProfileOpen(false);
    setIsSettingsOpen(false);
  };

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
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeGuidedCycle, activeThread]);

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

  const handleSignOut = async () => {
    await fetch("/api/gate/logout", { method: "POST" });
    window.location.href = "/gate";
  };

  const startNewThread = () => {
    const thread = createThread();
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

  const handleRenameThread = (threadId: string) => {
    const current = threads.find((thread) => thread.id === threadId);
    if (!current) return;
    setRenamingThreadId(threadId);
    setRenameDraft(current.title);
  };

  const handleSaveThreadRename = (threadId: string) => {
    const cleaned = renameDraft.trim();
    if (!cleaned) return;
    setThreads((prev) =>
      prev.map((thread) =>
        thread.id === threadId
          ? { ...thread, title: cleaned.slice(0, 80), updatedAt: new Date().toISOString() }
          : thread
      )
    );
    setRenamingThreadId(null);
    setRenameDraft("");
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

    const uptoIndex = activeThread.messages.findIndex((msg) => msg.id === message.id);
    const consideredMessages =
      uptoIndex >= 0 ? activeThread.messages.slice(0, uptoIndex + 1) : activeThread.messages;
    const allAnalyzed = consideredMessages.flatMap((msg) => msg.analysisResults || []);
    const uniqueRequirements = Array.from(new Set(allAnalyzed.map((item) => item.requirement).filter(Boolean)));
    const uniqueClassifications = Array.from(
      new Set(allAnalyzed.map((item) => item.classification).filter(Boolean))
    );
    const consolidatedRationale = allAnalyzed
      .map((item) => item.rationale?.trim())
      .filter(Boolean)
      .join(" ");
    const userContext = consideredMessages
      .filter((msg) => msg.role === "user")
      .map((msg) => msg.text.trim())
      .filter(Boolean)
      .join(" ");
    const analysisText = [userContext ? `Context discussed: ${userContext}` : "", consolidatedRationale]
      .filter(Boolean)
      .join("\n\n")
      .trim();

    const newItem: FsdSidebarItem = {
      id: `fsd-${message.id}`,
      messageId: message.id,
      response: analysisText || message.text,
      requirements: uniqueRequirements,
      classifications: uniqueClassifications,
    };

    setFsdSelectionsByThread((prev) => {
      const current = prev[activeThread.id] || [];
      const exists = current.some((item) => item.messageId === message.id);
      if (exists) return prev;
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
    if (!scopeText && messageAttachments.length === 0) return;

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
    patchGuidedCycle(activeThread.id, () => cycle);
    setGuidedCustomDraft("");
    setSelectedGuidedOption("");
    await loadGuidedStep(activeThread.id, cycle, 0);
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
    setThreadMessages(activeThread.id, (messages) => [
      ...messages,
      {
        id: crypto.randomUUID(),
        role: "user",
        kind: "guided_answer",
        cycleId: activeGuidedCycle.id,
        createdAt: new Date().toISOString(),
        text: `Clarification: ${answer.question}\n${answer.answer}`,
      },
    ]);

    patchGuidedCycle(activeThread.id, (current) =>
      current && current.id === activeGuidedCycle.id ? { ...current, answers: nextAnswers } : current
    );
    setGuidedCustomDraft("");
    setSelectedGuidedOption("");

    const nextStep = activeGuidedCycle.currentStepIndex + 1;
    if (nextStep >= activeGuidedCycle.maxSteps || activeGuidedCycle.isTerminal) {
      patchGuidedCycle(activeThread.id, (current) =>
        current && current.id === activeGuidedCycle.id
          ? { ...current, answers: nextAnswers, isTerminal: true, currentQuestion: undefined, currentOptions: [] }
          : current
      );
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
    const consolidated = buildConsolidatedRequirementText(activeGuidedCycle.baseRequirement, activeGuidedCycle.answers);

    patchGuidedCycle(activeThread.id, (current) =>
      current && current.id === activeGuidedCycle.id ? { ...current, status: "analyzing" } : current
    );
    setLoading(true);
    setIsChatAnalyzing(true);
    setError("");
    setActionNotice("");

    try {
      const payload = await analyzeSingleRequirement(consolidated);
      const primary = payload.results[0];
      const references = primary ? getSources(primary).slice(0, 3) : [];
      const detailedMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        kind: "analysis_result",
        cycleId: activeGuidedCycle.id,
        createdAt: new Date().toISOString(),
        text: primary?.rationale || "Analysis completed.",
        analysisResults: payload.results,
        detailedResult: primary
          ? {
              classification: primary.classification,
              why: primary.rationale,
              confidence: primary.confidence,
              references,
              finalRequirement: consolidated,
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
    setComposer("");
    setAttachments([]);
    await startGuidedCycle(scopeText, messageAttachments);
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
      if (err instanceof Error && err.message === "FSD_TEXT_EXPORT_NOT_FOUND" && latestAnalysisResults.length) {
        try {
          const legacyBlob = await generateFsdDocx(latestAnalysisResults);
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
    if (!latestAnalysisResults.length) {
      setError("Analyze scope in chat before previewing FSD.");
      return;
    }

    setFsdPreviewLoading(true);
    setError("");
    setActionNotice("");
    try {
      const payload = await generateFsd(latestAnalysisResults);
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
        if (err instanceof Error && err.message === "FSD_TEXT_SAVE_NOT_FOUND" && latestAnalysisResults.length) {
          const saved = await saveFsdToConfluence(latestAnalysisResults, spaceKey, parentId, title);
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
                <button className="workspace-menu-item" role="menuitem" onClick={() => setIsSettingsOpen(false)}>
                  Theme tokens (locked)
                </button>
                <button className="workspace-menu-item" role="menuitem" onClick={() => setIsSettingsOpen(false)}>
                  Notification preferences
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
                  Threads
                </h2>
                <button
                  className="rounded-full border border-obsidian/15 bg-white px-2.5 py-1 text-[0.68rem] font-semibold text-obsidian/70"
                  onClick={startNewThread}
                >
                  + New
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
              <input
                value={threadSearch}
                onChange={(event) => setThreadSearch(event.target.value)}
                className="history-search-input"
                placeholder="Search thread or project..."
                aria-label="Search threads by project or title"
              />
            </div>

            <div role="listbox" aria-label="Previous chats" className="history-list">
              {filteredThreads.map((thread) => {
                const threadProjects = getProjectsFromThread(thread);
                return (
                  <div
                    key={thread.id}
                    className={`history-thread ${thread.id === activeThread?.id ? "active" : ""}`}
                    title={thread.title}
                  >
                  <button
                    className="history-thread-main"
                    onClick={() => {
                      if (renamingThreadId === thread.id || pendingDeleteThreadId === thread.id) return;
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
                    ) : renamingThreadId === thread.id ? (
                      <div className="history-thread-edit">
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
                            }
                          }}
                          aria-label="Rename thread"
                        />
                        <button
                          className="history-thread-save"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            handleSaveThreadRename(thread.id);
                          }}
                          aria-label={`Save renamed thread ${thread.title}`}
                        >
                          <svg
                            viewBox="0 0 24 24"
                            aria-hidden="true"
                            className="h-3.5 w-3.5"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.2"
                          >
                            <path d="M5 12.5l4.2 4.2L19 7" />
                          </svg>
                        </button>
                      </div>
                    ) : (
                      <div className="grid gap-1">
                        <span className="history-thread-title">{thread.title}</span>
                        {threadProjects.length > 0 && (
                          <div className="history-thread-projects">
                            {threadProjects.slice(0, 2).map((project) => (
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
                      {isFsdPreviewEditing ? "View mode" : "Edit mode"}
                    </button>
                  </div>
                  {isFsdPreviewEditing ? (
                    <div className="fsd-preview-editor" data-color-mode="light">
                      <MDEditor
                        value={fsdPreviewDraft}
                        onChange={(value) => setFsdPreviewDraft(value || "")}
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
                  className="rounded-full bg-mint px-5 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading ? "Preparing..." : "Export FSD (.docx)"}
                </button>
                <button
                  onClick={() => void openConfluenceModal()}
                  disabled={loading || !fsdPreviewDraft.trim()}
                  className="rounded-full bg-signal px-5 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Save to Confluence
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="chat-panel-header">
                <p className="section-title">Requirements Analysis</p>
              </div>

              <div className={`chat-transcript ${isDiscussionIdle ? "chat-transcript-empty" : ""}`} ref={chatScrollRef}>
                {isDiscussionIdle && (
                  <div className="chat-empty-guide">
                    <div className="chat-empty-head">
                      <div className="chat-empty-kicker-row">
                        <span className="chat-empty-idea-icon" aria-hidden="true">
                          <svg
                            viewBox="0 0 24 24"
                            className="h-3.5 w-3.5"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.9"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M8.2 10a3.8 3.8 0 1 1 7.6 0c0 1.4-.7 2.4-1.6 3.3-.6.6-1 1.2-1.1 2h-2.2c-.1-.8-.5-1.4-1.1-2C8.9 12.4 8.2 11.4 8.2 10Z" />
                            <path d="M9.8 18.1h4.4M10.5 20h3" />
                          </svg>
                        </span>
                        <p className="chat-empty-kicker">Start with a clear requirement</p>
                      </div>
                      <h3 className="chat-empty-title">Turn initial ideas into FSD-ready analysis</h3>
                      <p className="chat-empty-copy">
                        Share one concrete requirement with behavior, scope, and constraints to get higher quality
                        classification and rationale.
                      </p>
                    </div>
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
                )}
                {activeThread?.messages.map((message, index) => {
                  const followUpReply = message.role === "user" ? parseFollowUpReplyText(message.text) : null;
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
                        isDiscussionIdle && message.role === "assistant" && index === 0
                          ? "chat-bubble-onboarding"
                          : ""
                      }`}
                    >
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
                      <p className="chat-text">{message.text}</p>

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
                          <div className="analysis-item-header">
                            <span className="text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-obsidian/55">
                              Detailed Analysis
                            </span>
                            <span className={`badge ${classifyTone(message.detailedResult.classification)}`}>
                              {message.detailedResult.classification}
                            </span>
                          </div>
                          <div className="analysis-requirement-box">
                            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-obsidian/55">
                              Final Requirement
                            </p>
                            <p className="mt-1 text-xs leading-relaxed text-obsidian/72">
                              {message.detailedResult.finalRequirement}
                            </p>
                          </div>
                          <div className="analysis-response-box">
                            <p className="analysis-response-label">Why this classification</p>
                            <p className="mt-1 text-sm font-medium leading-relaxed text-obsidian/88">
                              {message.detailedResult.why}
                            </p>
                            <p className="mt-2 text-xs font-semibold uppercase tracking-[0.1em] text-obsidian/58">
                              Confidence: {Math.round(message.detailedResult.confidence * 100)}%
                            </p>
                          </div>
                          {message.detailedResult.references.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-2">
                              {message.detailedResult.references.map((source) => (
                                <a
                                  key={source.url}
                                  href={source.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="rounded-full border border-obsidian/10 px-3 py-1 text-[0.65rem] text-obsidian/70"
                                >
                                  {source.title}
                                </a>
                              ))}
                            </div>
                          )}
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
                                  <a
                                    key={source.url}
                                    href={source.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="rounded-full border border-obsidian/10 px-3 py-1 text-[0.65rem] text-obsidian/70"
                                  >
                                    {source.title}
                                  </a>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : null}
                      {message.role === "assistant" && index > 0 && message.analysisResults?.length && (
                        <div className="mt-3 flex justify-start">
                          <button
                            className="chat-fsd-btn"
                            onClick={() => handleAddToFsd(message)}
                            disabled={activeAddedMessageIds.has(message.id)}
                          >
                            {activeAddedMessageIds.has(message.id) ? "Added to FSD" : "Add to FSD"}
                          </button>
                          {recentlyAddedToSidebar?.threadId === activeThreadId &&
                            recentlyAddedToSidebar?.messageId === message.id && (
                              <span className="ml-2 self-center text-[0.68rem] font-semibold text-signal chat-inline-toast">
                                Added to summary sidebar
                              </span>
                            )}
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

              <div className={`chat-composer-wrap ${isDiscussionIdle ? "chat-composer-wrap-highlight" : ""}`}>
                {activeGuidedCycle &&
                  (activeGuidedCycle.status === "guided" || activeGuidedCycle.status === "cancelled") && (
                    <div className="guided-card guided-card-in-composer">
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
                      {activeGuidedCycle.status === "cancelled" ? (
                        <p className="guided-cancel-note">
                          Guided questions were dismissed. You can still analyze using collected context.
                        </p>
                      ) : (
                        <>
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
                        </>
                      )}
                      <div className="guided-actions">
                        {activeGuidedCycle.status === "guided" && (
                          <button
                            className="guided-next-btn"
                            onClick={() => void handleGuidedNext()}
                            disabled={guidedLoading}
                          >
                            {guidedLoading ? "Loading..." : "Next"}
                          </button>
                        )}
                        <button
                          className="guided-analyze-btn"
                          onClick={() => void handleAnalyzeNow()}
                          disabled={loading || !activeGuidedCycle.baseRequirement}
                        >
                          Analyze now
                        </button>
                      </div>
                    </div>
                  )}
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
                    placeholder={
                      activeGuidedCycle?.status === "guided"
                        ? "Use guided follow-up card above, or click Analyze now..."
                        : "Discuss scope, requirements, assumptions, and constraints..."
                    }
                    disabled={activeGuidedCycle?.status === "guided"}
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
                    disabled={loading || activeGuidedCycle?.status === "guided" || (!composer.trim() && attachments.length === 0)}
                  >
                    Send
                  </button>
                </div>
                <p className="mt-2 text-center text-[0.7rem] text-obsidian/55">
                  Responses can be inaccurate; please double check before finalizing.
                </p>
                {error && <p className="text-xs font-semibold text-rose">{error}</p>}
                {actionNotice && <p className="text-xs font-semibold text-obsidian/60">{actionNotice}</p>}
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
              <p className="section-title">FSD Builder</p>
            </div>
            <button
              className="icon-chip lg:hidden"
              onClick={() => setIsMobileSummaryOpen(false)}
              aria-label="Close summary panel"
            >
              x
            </button>
          </div>

          <div className="summary-metrics">
            <div className="summary-metric">
              <span>Total</span>
              <strong>{latestCounts.total}</strong>
            </div>
            <div className="summary-metric">
              <span>OOTB</span>
              <strong>
                {latestCounts.ootb} ({summaryPercentages.ootb}%)
              </strong>
            </div>
            <div className="summary-metric">
              <span>Partial</span>
              <strong>
                {latestCounts.partial} ({summaryPercentages.partial}%)
              </strong>
            </div>
            <div className="summary-metric">
              <span>Custom Dev</span>
              <strong>
                {latestCounts.custom} ({summaryPercentages.custom}%)
              </strong>
            </div>
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
              activeFsdSelections.map((item) => (
                <div key={item.id} className="summary-card">
                  <div className="flex items-center justify-between">
                    <div className="flex flex-wrap items-center gap-2">
                      {item.classifications.length > 0 ? (
                        item.classifications.map((classification, idx) => (
                          <span key={`${item.id}-class-${idx}`} className="badge bg-signal/20 text-signal">
                            {classification}
                          </span>
                        ))
                      ) : (
                        <span className="badge bg-obsidian/10 text-obsidian">Analysis</span>
                      )}
                    </div>
                    <button
                      className="history-thread-link delete"
                      onClick={() => handleRemoveFromFsd(item.id, item.messageId)}
                    >
                      Remove
                    </button>
                  </div>
                  <div className="mt-3 rounded-2xl border border-slate/30 bg-white/80 p-3">
                    <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-obsidian/55">
                      Requirement
                    </p>
                    <div className="mt-2 grid gap-1.5 text-sm text-obsidian/75">
                      {item.requirements.length > 0 ? (
                        item.requirements.map((requirement, idx) => (
                          <p key={`${item.id}-req-${idx}`}>{requirement}</p>
                        ))
                      ) : (
                        <p>No requirement extracted</p>
                      )}
                    </div>
                  </div>
                  <div className="mt-2 rounded-2xl border border-slate/30 bg-white/80 p-3">
                    <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-obsidian/55">
                      Analysis
                    </p>
                    <p className="mt-2 text-sm text-obsidian/75">{item.response}</p>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="summary-export">
            <button
              onClick={() => void handleOpenFsdPreview()}
              disabled={fsdPreviewLoading || !latestAnalysisResults.length}
              className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-steel px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {fsdPreviewLoading ? (
                <>
                  <span className="preview-loader-icon" aria-hidden="true" />
                  <span className="preview-loader-text">Generating preview...</span>
                </>
              ) : (
                "← Preview FSD"
              )}
            </button>
            {fsdPreviewDraft.trim() && (
              <>
                <button
                  onClick={() => void handleExportDocx()}
                  disabled={loading || !fsdPreviewDraft.trim()}
                  className="mt-2 w-full rounded-full bg-mint px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading ? "Preparing..." : "Export FSD (.docx)"}
                </button>
                <button
                  onClick={() => void openConfluenceModal()}
                  disabled={loading || !fsdPreviewDraft.trim()}
                  className="mt-2 w-full rounded-full bg-signal px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Save to Confluence
                </button>
              </>
            )}
            <p className="mt-2 text-center text-[0.7rem] text-obsidian/55">
              Open preview to review outline and access export/save actions.
            </p>
          </div>
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

      {isOnboardingOpen && (
        <div
          className="workspace-modal-backdrop onboarding-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Welcome onboarding"
        >
          <div className="workspace-modal onboarding-modal">
            <div className="workspace-modal-header">
              <h3 className="font-display text-2xl text-obsidian">Welcome to Scout!</h3>
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
                className="rounded-full bg-obsidian px-5 py-2 text-sm font-semibold text-white"
                onClick={() => setIsOnboardingOpen(false)}
              >
                Start Brainstorming
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

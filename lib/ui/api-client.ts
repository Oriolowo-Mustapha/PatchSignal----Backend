"use client";

import type { RemediationData, PullRequestState } from "@/lib/remediation/types";

export type { FilePatch, RemediationIteration, PullRequestState, RemediationData } from "@/lib/remediation/types";

export type HealthResponse = {
  ok: boolean;
  db: { ok: boolean; error?: string };
  runner: string;
  store: "postgres" | "memory";
};

export type UserProfile = {
  id: string;
  email: string;
  name: string | null;
  lastLoginAt?: string | null;
  createdAt: string;
};

export type AnalysisJobView = {
  id: string;
  status: string;
  error: string | null;
  updatedAt: string;
};

export type InvestigationSummary = {
  id: string;
  repoUrl: string;
  owner: string;
  repo: string;
  description: string;
  summary: string | null;
  stage: string;
  status: string;
  commitSha: string | null;
  modelId: string | null;
  createdAt: string;
  analysisJob: AnalysisJobView | null;
  latestClassification: { status: string; rule: string; justification: string } | null;
  attachmentCount: number;
  evidenceCount: number;
  blockingUnknowns: number;
};

export type AttachmentItem = {
  id?: string;
  publicId: string;
  secureUrl: string;
  mime: string;
  sizeBytes: number;
  width?: number | null;
  height?: number | null;
  geminiFileUri?: string | null;
};

export type InvestigationDetailRecord = {
  id: string;
  repoUrl: string;
  owner: string;
  repo: string;
  description: string;
  expected?: string | null;
  actual?: string | null;
  steps?: string | null;
  environment?: string | null;
  errorText?: string | null;
  commitSha?: string | null;
  controlSha?: string | null;
  stage: string;
  status: string;
  modelId?: string | null;
  summary?: string | null;
  candidateAreas?: { path: string; provenance?: string }[] | null;
  inspectionJson?: {
    defaultBranch?: string;
    sha?: string;
    fileCount?: number;
    paths?: string[];
    manifest?: string | null;
    pkg?: Record<string, unknown> | null;
    ecosystem?: string;
    remediation?: RemediationData;
  } | null;
  inspection?: {
    defaultBranch?: string;
    sha?: string;
    fileCount?: number;
    paths?: string[];
    manifest?: string | null;
    pkg?: Record<string, unknown> | null;
    ecosystem?: string;
    remediation?: RemediationData;
  } | null;
  analysisJob?: AnalysisJobView | null;
  evidence?:
    | { id?: string; text: string; provenance: string; source: string }[]
    | {
        summary?: string;
        evidence?: { text: string; provenance: string; source: string }[];
        unknowns?: { item?: string; question: string; blocking?: boolean }[];
        candidateAreas?: { path: string; provenance?: string }[];
        _cached?: boolean;
      };
  questions?: { id?: string; text: string; blocking: boolean }[];
  hypotheses?: {
    id: string;
    statement: string;
    triggerConditions: string;
    expectedFailure: string;
    evidenceNeeded: string;
    tests?: { id?: string; path: string; content: string; framework?: string }[];
    runs?: {
      id?: string;
      role: string;
      revisionSha?: string | null;
      imageDigest?: string | null;
      command?: string;
      exitCode?: number | null;
      outcome: string;
      durationMs?: number | null;
      stdout?: string | null;
      stderr?: string | null;
      truncated?: boolean;
    }[];
  }[];
  hypothesis?: {
    statement: string;
    triggerConditions: string;
    expectedFailure: string;
    evidenceNeeded: string;
    path: string;
    content: string;
    modelId?: string;
  };
  runs?: {
    target?: {
      exitCode?: number | null;
      durationMs?: number | null;
      outcome: string;
      stdout?: string;
      stderr?: string;
      imageDigest?: string;
      revisionSha?: string;
      command?: string;
    };
    control?: {
      exitCode?: number | null;
      durationMs?: number | null;
      outcome: string;
      stdout?: string;
      stderr?: string;
      imageDigest?: string;
      revisionSha?: string;
      command?: string;
    } | null;
  };
  classifications?: { status: string; rule: string; justification: string; decidedAt?: string }[];
  classification?: { status: string; rule: string; justification: string } | null;
  attachments?: AttachmentItem[];
  createdAt: string;
};

export type PackageResult = {
  markdown: string;
  issueUrl: string;
  copyToClipboard: boolean;
  readyToFile?: boolean;
  blockingUnknowns?: number;
};

const LEGACY_TOKEN_STORAGE_KEY = "ps_token_v1";

export function clearLegacyStoredToken() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(LEGACY_TOKEN_STORAGE_KEY);
  } catch {
    // Ignore storage access issues
  }
}

export class ApiRequestError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function requestJson<T>(url: string, init: RequestInit = {}, token?: string | null): Promise<T> {
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(url, {
    ...init,
    headers,
    credentials: "same-origin",
    cache: "no-store",
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string; code?: string } & T;
  if (!res.ok) {
    throw new ApiRequestError(res.status, data.error || `Request failed (${res.status})`, data.code);
  }
  return data;
}

export const apiClient = {
  health: () => requestJson<HealthResponse>("/api/health"),
  signup: (payload: { email: string; password: string; name?: string }) =>
    requestJson<UserProfile & { token?: string }>("/api/auth/signup", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  login: (payload: { email: string; password: string }) =>
    requestJson<UserProfile & { token?: string }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  logout: () => requestJson<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
  me: (token?: string | null) => requestJson<UserProfile>("/api/auth/me", {}, token),
  listInvestigations: (token?: string | null) =>
    requestJson<{ investigations: InvestigationSummary[] }>("/api/investigations", {}, token),
  createInvestigation: (formData: FormData, token?: string | null) =>
    requestJson<{ id: string; store: string; attachments: number }>(
      "/api/investigations",
      { method: "POST", body: formData },
      token
    ),
  getInvestigation: (id: string, token?: string | null) =>
    requestJson<InvestigationDetailRecord>(`/api/investigations/${id}`, {}, token),
  analyze: (id: string, token?: string | null) =>
    requestJson<{ id: string; analysisJob?: AnalysisJobView; status?: string }>(
      `/api/investigations/${id}/analyze`,
      { method: "POST" },
      token
    ),
  inspect: (id: string, token?: string | null) =>
    requestJson<Record<string, unknown>>(`/api/investigations/${id}/inspect`, { method: "POST" }, token),
  hypothesize: (
    id: string,
    body: {
      statement?: string;
      triggerConditions?: string;
      expectedFailure?: string;
      evidenceNeeded?: string;
      targetFile?: string;
      content?: string;
    },
    token?: string | null
  ) =>
    requestJson<Record<string, unknown>>(
      `/api/investigations/${id}/hypotheses`,
      { method: "POST", body: JSON.stringify(body) },
      token
    ),
  runSandbox: (id: string, body: Record<string, unknown>, token?: string | null) =>
    requestJson<Record<string, unknown>>(
      `/api/investigations/${id}/runs`,
      { method: "POST", body: JSON.stringify(body) },
      token
    ),
  remediate: (
    id: string,
    body: { maxAttempts?: number; customInstruction?: string } = {},
    token?: string | null
  ) =>
    requestJson<{ remediation: RemediationData }>(
      `/api/investigations/${id}/remediate`,
      { method: "POST", body: JSON.stringify(body) },
      token
    ),
  createPullRequest: (
    id: string,
    body: {
      approved: boolean;
      title?: string;
      body?: string;
      branchName?: string;
      baseBranch?: string;
      githubToken?: string;
    },
    token?: string | null
  ) =>
    requestJson<{ pr: PullRequestState; remediation: RemediationData }>(
      `/api/investigations/${id}/pr`,
      { method: "POST", body: JSON.stringify(body) },
      token
    ),
  getPackage: (id: string, token?: string | null) =>
    requestJson<PackageResult>(`/api/investigations/${id}/package`, {}, token),
};

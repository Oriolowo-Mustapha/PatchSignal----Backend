export type RemediationRuntime = "docker-container" | "remote-runner" | "local-sandbox";

export type FilePatch = {
  path: string;
  explanation: string;
  originalContent: string;
  content: string;
};

export type RemediationIteration = {
  attempt: number;
  timestamp: string;
  runtime: RemediationRuntime;
  dockerImage?: string;
  command: string;
  exitCode: number;
  outcome: "passed" | "failed" | "error" | "timeout";
  durationMs: number;
  stdout: string;
  stderr: string;
  summary: string;
  patches: FilePatch[];
};

export type CiCheckItem = {
  id: number;
  name: string;
  status: "queued" | "in_progress" | "completed" | "pending" | "waiting" | "requested";
  conclusion: string | null;
  htmlUrl?: string;
  summary?: string;
  failureSnippet?: string;
};

export type CiOverallStatus = "unknown" | "pending" | "passed" | "failed";

export type PullRequestState = {
  status: "awaiting_approval" | "created" | "failed";
  title: string;
  body: string;
  branchName: string;
  baseBranch: string;
  draft?: boolean;
  readyForReview?: boolean;
  prUrl?: string;
  prNumber?: number;
  headSha?: string;
  forkOwner?: string;
  createdAt?: string;
  ciStatus?: CiOverallStatus;
  ciCheckedAt?: string;
  ciChecks?: CiCheckItem[];
  ciFailureLog?: string;
  ciRepairRounds?: number;
  error?: string;
};

export type RemediationData = {
  status: "idle" | "running" | "succeeded" | "exhausted" | "failed";
  ecosystem?: string;
  diagnosis?: string;
  fixSummary?: string;
  verificationCommand?: string;
  maxAttempts: number;
  currentAttempt: number;
  patches: FilePatch[];
  iterations: RemediationIteration[];
  pr?: PullRequestState;
  error?: string;
  updatedAt: string;
};

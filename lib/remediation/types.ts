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

export type PullRequestState = {
  status: "awaiting_approval" | "created" | "failed";
  title: string;
  body: string;
  branchName: string;
  baseBranch: string;
  prUrl?: string;
  prNumber?: number;
  headSha?: string;
  forkOwner?: string;
  createdAt?: string;
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

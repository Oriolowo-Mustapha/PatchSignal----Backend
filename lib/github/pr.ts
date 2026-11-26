import { github } from "@/lib/github/client";
import type { CiCheckItem, CiOverallStatus, FilePatch } from "@/lib/remediation/types";

export class CreatePullRequestError extends Error {
  status: number;
  code: "GITHUB_WRITE_TOKEN_NEEDED" | "PR_CREATE_FAILED";

  constructor(
    message: string,
    status = 502,
    code: "GITHUB_WRITE_TOKEN_NEEDED" | "PR_CREATE_FAILED" = "PR_CREATE_FAILED"
  ) {
    super(message);
    this.name = "CreatePullRequestError";
    this.status = status;
    this.code = code;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isPermissionError(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  if (status === 401 || status === 403) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /Resource not accessible|Must have write access|Bad credentials|Requires authentication|403|401/i.test(
    msg
  );
}

export async function createFixPullRequest(input: {
  owner: string;
  repo: string;
  baseBranch?: string;
  branchName: string;
  title: string;
  body: string;
  patches: FilePatch[];
  draft?: boolean;
  githubToken?: string;
}): Promise<{
  prUrl: string;
  prNumber: number;
  branchName: string;
  baseBranch: string;
  headSha: string;
  draft: boolean;
  updatedExisting?: boolean;
  forkOwner?: string;
}> {
  const effectiveToken = input.githubToken?.trim() || undefined;
  const octokit = github(effectiveToken);

  try {
    const { data: repoMeta } = await octokit.rest.repos.get({
      owner: input.owner,
      repo: input.repo,
    });
    const baseBranch = input.baseBranch?.trim() || repoMeta.default_branch || "main";
    const canPushDirectly = Boolean(repoMeta.permissions?.push);

    let pushOwner = input.owner;
    let forkOwner: string | undefined;

    if (!canPushDirectly) {
      let currentLogin: string;
      try {
        const { data: me } = await octokit.rest.users.getAuthenticated();
        currentLogin = me.login;
      } catch (authErr) {
        throw new CreatePullRequestError(
          authErr instanceof Error
            ? `GitHub authentication with write permissions is required to fork/push (${authErr.message}). Provide a personal access token with Contents + Pull Requests write permissions.`
            : "GitHub write token required to create a fork and Pull Request.",
          403,
          "GITHUB_WRITE_TOKEN_NEEDED"
        );
      }

      if (currentLogin.toLowerCase() === input.owner.toLowerCase()) {
        pushOwner = input.owner;
      } else {
        const { data: fork } = await octokit.rest.repos.createFork({
          owner: input.owner,
          repo: input.repo,
        });
        forkOwner = fork.owner?.login || currentLogin;
        pushOwner = forkOwner;
        for (let i = 0; i < 6; i++) {
          try {
            await octokit.rest.git.getRef({
              owner: pushOwner,
              repo: input.repo,
              ref: `heads/${baseBranch}`,
            });
            break;
          } catch {
            await sleep(1500);
          }
        }
      }
    }

    const { data: baseRef } = await octokit.rest.git.getRef({
      owner: input.owner,
      repo: input.repo,
      ref: `heads/${baseBranch}`,
    });
    const baseCommitSha = baseRef.object.sha;
    const { data: baseCommit } = await octokit.rest.git.getCommit({
      owner: input.owner,
      repo: input.repo,
      commit_sha: baseCommitSha,
    });

    // Append onto existing branch if already pushed (e.g. CI repair round), else branch from baseBranch.
    let parentSha = baseCommitSha;
    let baseTreeSha = baseCommit.tree.sha;
    let branchExists = false;
    try {
      const { data: existingRef } = await octokit.rest.git.getRef({
        owner: pushOwner,
        repo: input.repo,
        ref: `heads/${input.branchName}`,
      });
      branchExists = true;
      parentSha = existingRef.object.sha;
      const { data: parentCommit } = await octokit.rest.git.getCommit({
        owner: pushOwner,
        repo: input.repo,
        commit_sha: parentSha,
      });
      baseTreeSha = parentCommit.tree.sha;
    } catch {
      // Branch does not exist yet
    }

    const treeEntries = await Promise.all(
      input.patches.map(async (p) => {
        const { data: blob } = await octokit.rest.git.createBlob({
          owner: pushOwner,
          repo: input.repo,
          content: p.content,
          encoding: "utf-8",
        });
        return {
          path: p.path,
          mode: "100644" as const,
          type: "blob" as const,
          sha: blob.sha,
        };
      })
    );

    const { data: newTree } = await octokit.rest.git.createTree({
      owner: pushOwner,
      repo: input.repo,
      base_tree: baseTreeSha,
      tree: treeEntries,
    });

    const { data: newCommit } = await octokit.rest.git.createCommit({
      owner: pushOwner,
      repo: input.repo,
      message: input.title,
      tree: newTree.sha,
      parents: [parentSha],
    });

    const fullRef = `refs/heads/${input.branchName}`;
    if (branchExists) {
      await octokit.rest.git.updateRef({
        owner: pushOwner,
        repo: input.repo,
        ref: `heads/${input.branchName}`,
        sha: newCommit.sha,
        force: false,
      });
    } else {
      await octokit.rest.git.createRef({
        owner: pushOwner,
        repo: input.repo,
        ref: fullRef,
        sha: newCommit.sha,
      });
    }

    const headRef = forkOwner ? `${forkOwner}:${input.branchName}` : input.branchName;
    const requestedDraft = input.draft ?? true;

    try {
      const { data: pr } = await octokit.rest.pulls.create({
        owner: input.owner,
        repo: input.repo,
        title: input.title,
        head: headRef,
        base: baseBranch,
        body: input.body,
        draft: requestedDraft,
      });
      return {
        prUrl: pr.html_url,
        prNumber: pr.number,
        branchName: input.branchName,
        baseBranch,
        headSha: newCommit.sha,
        draft: Boolean(pr.draft),
        updatedExisting: false,
        ...(forkOwner ? { forkOwner } : {}),
      };
    } catch (prErr) {
      const { data: existingList } = await octokit.rest.pulls.list({
        owner: input.owner,
        repo: input.repo,
        head: headRef,
        state: "open",
      });
      const existing = existingList[0];
      if (existing) {
        return {
          prUrl: existing.html_url,
          prNumber: existing.number,
          branchName: input.branchName,
          baseBranch,
          headSha: newCommit.sha,
          draft: Boolean(existing.draft),
          updatedExisting: true,
          ...(forkOwner ? { forkOwner } : {}),
        };
      }
      throw prErr;
    }
  } catch (err) {
    if (err instanceof CreatePullRequestError) throw err;
    if (isPermissionError(err)) {
      throw new CreatePullRequestError(
        "The configured GitHub token does not have write access to create branches/PRs on this repository. Supply a GitHub PAT with Contents & Pull Requests write permissions to continue.",
        403,
        "GITHUB_WRITE_TOKEN_NEEDED"
      );
    }
    throw new CreatePullRequestError(
      err instanceof Error ? err.message : "Failed to create Pull Request",
      502,
      "PR_CREATE_FAILED"
    );
  }
}

export function extractFailureLines(rawLog: string, maxChars = 4000): string {
  const cleaned = rawLog
    .replace(/\u001b\[[0-9;]*[A-Za-z]/g, "")
    .replace(/\r/g, "");
  const lines = cleaned
    .split("\n")
    .map((line) => line.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s*/, ""));

  const hitIndices: number[] = [];
  const failureRe =
    /error\s+[A-Z]+\d+|error:|failed!|failed\s+\d+|FAIL\b|Exception:|AssertionError|Expected:|Actual:|Process completed with exit code [1-9]|##\[error\]/i;
  for (let i = 0; i < lines.length; i++) {
    if (failureRe.test(lines[i])) {
      hitIndices.push(i);
    }
  }

  if (hitIndices.length === 0) {
    return lines.join("\n").slice(-maxChars).trim();
  }

  const keep = new Set<number>();
  for (const idx of hitIndices) {
    for (let k = Math.max(0, idx - 2); k <= Math.min(lines.length - 1, idx + 3); k++) {
      keep.add(k);
    }
  }

  const out: string[] = [];
  let prev = -2;
  for (const idx of Array.from(keep).sort((a, b) => a - b)) {
    if (prev >= 0 && idx > prev + 1) out.push("...");
    out.push(lines[idx]);
    prev = idx;
  }

  const joined = out.join("\n").trim();
  return joined.length <= maxChars ? joined : `${joined.slice(0, Math.floor(maxChars * 0.5))}\n...\n${joined.slice(-Math.floor(maxChars * 0.45))}`;
}

export async function fetchPullRequestChecks(input: {
  owner: string;
  repo: string;
  headSha: string;
  prCreatedAt?: string;
  githubToken?: string;
}): Promise<{
  ciStatus: CiOverallStatus;
  checks: CiCheckItem[];
  ciFailureLog?: string;
  checkedAt: string;
}> {
  const octokit = github(input.githubToken?.trim() || undefined);
  const { data } = await octokit.rest.checks.listForRef({
    owner: input.owner,
    repo: input.repo,
    ref: input.headSha,
    per_page: 50,
  });

  const checks: CiCheckItem[] = data.check_runs.map((run) => ({
    id: run.id,
    name: run.name,
    status: run.status,
    conclusion: run.conclusion ?? null,
    ...(run.html_url ? { htmlUrl: run.html_url } : {}),
    ...(run.output?.summary || run.output?.title
      ? { summary: (run.output.summary || run.output.title || "").slice(0, 500) }
      : {}),
  }));

  const failingConclusions = new Set(["failure", "timed_out", "action_required"]);
  const failedRuns = data.check_runs.filter(
    (run) => run.status === "completed" && run.conclusion && failingConclusions.has(run.conclusion)
  );
  const anyIncomplete = data.check_runs.some((run) => run.status !== "completed");

  let ciStatus: CiOverallStatus = "unknown";
  if (failedRuns.length > 0) {
    ciStatus = "failed";
  } else if (anyIncomplete) {
    ciStatus = "pending";
  } else if (checks.length > 0) {
    ciStatus = "passed";
  } else if (input.prCreatedAt && Date.now() - new Date(input.prCreatedAt).getTime() < 120_000) {
    ciStatus = "pending";
  }

  const snippets: string[] = [];
  for (const failed of failedRuns.slice(0, 2)) {
    let snippet = "";
    try {
      const logRes = await octokit.rest.actions.downloadJobLogsForWorkflowRun({
        owner: input.owner,
        repo: input.repo,
        job_id: failed.id,
      });
      if (typeof logRes.data === "string" && logRes.data.trim()) {
        snippet = extractFailureLines(logRes.data, 2200);
      }
    } catch {
      // Fine-grained tokens without Actions:Read or external checks won't allow raw job log downloads; fall back cleanly.
    }
    if (!snippet) {
      const fallback = [failed.output?.title, failed.output?.summary, failed.output?.text]
        .filter(Boolean)
        .join("\n")
        .trim();
      if (fallback) snippet = extractFailureLines(fallback, 1800);
    }
    if (snippet) {
      const matching = checks.find((c) => c.id === failed.id);
      if (matching) matching.failureSnippet = snippet;
      snippets.push(`=== ${failed.name} (${failed.conclusion ?? "failed"}) ===\n${snippet}`);
    }
  }

  const ciFailureLog = snippets.length > 0 ? snippets.join("\n\n").slice(0, 6000) : undefined;
  return {
    ciStatus,
    checks,
    ...(ciFailureLog ? { ciFailureLog } : {}),
    checkedAt: new Date().toISOString(),
  };
}

export async function markPullRequestReady(input: {
  owner: string;
  repo: string;
  prNumber: number;
  githubToken?: string;
}): Promise<{ readyForReview: boolean; draft: boolean }> {
  const octokit = github(input.githubToken?.trim() || undefined);
  const { data: pr } = await octokit.rest.pulls.get({
    owner: input.owner,
    repo: input.repo,
    pull_number: input.prNumber,
  });
  if (pr.draft) {
    await octokit.graphql(
      `mutation($id: ID!) {
        markPullRequestReadyForReview(input: { pullRequestId: $id }) {
          pullRequest { isDraft }
        }
      }`,
      { id: pr.node_id }
    );
  }
  return { readyForReview: true, draft: false };
}

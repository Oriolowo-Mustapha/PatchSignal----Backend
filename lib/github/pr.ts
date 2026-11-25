import { github } from "@/lib/github/client";
import type { FilePatch } from "@/lib/remediation/types";

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
  githubToken?: string;
}): Promise<{
  prUrl: string;
  prNumber: number;
  branchName: string;
  baseBranch: string;
  headSha: string;
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
      base_tree: baseCommit.tree.sha,
      tree: treeEntries,
    });

    const { data: newCommit } = await octokit.rest.git.createCommit({
      owner: pushOwner,
      repo: input.repo,
      message: input.title,
      tree: newTree.sha,
      parents: [baseCommitSha],
    });

    const fullRef = `refs/heads/${input.branchName}`;
    try {
      await octokit.rest.git.createRef({
        owner: pushOwner,
        repo: input.repo,
        ref: fullRef,
        sha: newCommit.sha,
      });
    } catch {
      await octokit.rest.git.updateRef({
        owner: pushOwner,
        repo: input.repo,
        ref: `heads/${input.branchName}`,
        sha: newCommit.sha,
        force: true,
      });
    }

    const headRef = forkOwner ? `${forkOwner}:${input.branchName}` : input.branchName;

    try {
      const { data: pr } = await octokit.rest.pulls.create({
        owner: input.owner,
        repo: input.repo,
        title: input.title,
        head: headRef,
        base: baseBranch,
        body: input.body,
      });
      return {
        prUrl: pr.html_url,
        prNumber: pr.number,
        branchName: input.branchName,
        baseBranch,
        headSha: newCommit.sha,
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

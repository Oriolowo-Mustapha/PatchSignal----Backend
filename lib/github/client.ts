import { Octokit } from "octokit";
import { config } from "@/lib/config";

export function github() {
  return new Octokit({ auth: config.githubToken || undefined });
}

export async function inspectRepo(owner: string, repo: string) {
  const octokit = github();
  const { data: meta } = await octokit.rest.repos.get({ owner, repo });
  const branch = meta.default_branch;
  const { data: commit } = await octokit.rest.repos.getCommit({ owner, repo, ref: branch });
  const sha = commit.sha;
  const { data: tree } = await octokit.rest.git.getTree({
    owner,
    repo,
    tree_sha: sha,
    recursive: "true",
  });
  const paths = (tree.tree ?? []).map((t) => t.path ?? "").filter(Boolean);
  const manifest =
    paths.find((p) => p === "package.json") ??
    paths.find((p) => p.endsWith("package.json")) ??
    null;
  let pkg: Record<string, unknown> | null = null;
  if (manifest) {
    try {
      const { data } = await octokit.rest.repos.getContent({ owner, repo, path: manifest, ref: sha });
      if (!Array.isArray(data) && data.type === "file" && data.content) {
        pkg = JSON.parse(Buffer.from(data.content, "base64").toString("utf8"));
      }
    } catch {
      pkg = null;
    }
  }
  const hasVitest =
    paths.some((p) => p.includes("vitest.config")) ||
    JSON.stringify(pkg ?? {}).includes("vitest");
  const ecosystem = hasVitest ? "node-vitest" : "unsupported";
  return { defaultBranch: branch, sha, fileCount: paths.length, paths: paths.slice(0, 500), manifest, pkg, ecosystem };
}

export async function fetchRepoFile(
  owner: string,
  repo: string,
  path: string,
  ref: string,
  maxBytes = 16_000
): Promise<string | null> {
  try {
    const octokit = github();
    const { data } = await octokit.rest.repos.getContent({ owner, repo, path, ref });
    if (Array.isArray(data) || data.type !== "file" || !data.content) return null;
    const buf = Buffer.from(data.content, "base64");
    if (buf.includes(0)) return null;
    const text = buf.toString("utf8");
    return text.length > maxBytes ? text.slice(0, maxBytes) : text;
  } catch {
    return null;
  }
}

export async function searchSimilarIssues(owner: string, repo: string, query: string) {
  const octokit = github();
  const { data } = await octokit.rest.search.issuesAndPullRequests({
    q: `repo:${owner}/${repo} ${query.slice(0, 120)}`,
    per_page: 3,
  });
  return data.items.map((i) => ({ title: i.title, url: i.html_url, reason: "text match (suggestion, not proof)" }));
}

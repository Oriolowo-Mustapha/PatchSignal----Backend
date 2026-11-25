import { Octokit } from "octokit";
import { config } from "@/lib/config";

export function github(overrideToken?: string) {
  const token = (overrideToken ?? config.githubToken ?? "").trim();
  return new Octokit({ auth: token || undefined });
}

export type RepoEcosystem =
  | "node-vitest"
  | "node"
  | "dotnet"
  | "python"
  | "go"
  | "rust"
  | "generic"
  | "unsupported";

export function detectEcosystem(
  paths: string[],
  pkg: Record<string, unknown> | null
): { ecosystem: RepoEcosystem; manifest: string | null } {
  const hasVitest =
    paths.some((p) => p.includes("vitest.config")) ||
    JSON.stringify(pkg ?? {}).includes("vitest");
  if (hasVitest) {
    const pkgPath =
      paths.find((p) => p === "package.json") ??
      paths.find((p) => p.endsWith("package.json")) ??
      null;
    return { ecosystem: "node-vitest", manifest: pkgPath };
  }

  const sln = paths.find((p) => /\.(sln|slnx)$/i.test(p));
  const csproj = paths.find((p) => /\.csproj$/i.test(p));
  if (sln || csproj) {
    return { ecosystem: "dotnet", manifest: sln ?? csproj ?? null };
  }

  const pkgPath =
    paths.find((p) => p === "package.json") ??
    paths.find((p) => p.endsWith("package.json")) ??
    null;
  if (pkgPath) {
    return { ecosystem: "node", manifest: pkgPath };
  }

  const pyManifest =
    paths.find((p) => p === "pyproject.toml" || p.endsWith("/pyproject.toml")) ??
    paths.find((p) => p === "requirements.txt" || p.endsWith("/requirements.txt")) ??
    paths.find((p) => p === "setup.py") ??
    null;
  if (pyManifest) {
    return { ecosystem: "python", manifest: pyManifest };
  }

  const goMod = paths.find((p) => p === "go.mod" || p.endsWith("/go.mod")) ?? null;
  if (goMod) {
    return { ecosystem: "go", manifest: goMod };
  }

  const cargoToml = paths.find((p) => p === "Cargo.toml" || p.endsWith("/Cargo.toml")) ?? null;
  if (cargoToml) {
    return { ecosystem: "rust", manifest: cargoToml };
  }

  if (paths.length > 0) {
    return { ecosystem: "generic", manifest: null };
  }
  return { ecosystem: "unsupported", manifest: null };
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
  const pkgPath =
    paths.find((p) => p === "package.json") ??
    paths.find((p) => p.endsWith("package.json")) ??
    null;
  let pkg: Record<string, unknown> | null = null;
  if (pkgPath) {
    try {
      const { data } = await octokit.rest.repos.getContent({ owner, repo, path: pkgPath, ref: sha });
      if (!Array.isArray(data) && data.type === "file" && data.content) {
        pkg = JSON.parse(Buffer.from(data.content, "base64").toString("utf8"));
      }
    } catch {
      pkg = null;
    }
  }
  const { ecosystem, manifest } = detectEcosystem(paths, pkg);
  return {
    defaultBranch: branch,
    sha,
    fileCount: paths.length,
    paths: paths.slice(0, 1500),
    manifest,
    pkg,
    ecosystem,
  };
}

export async function fetchRepoFileWithSha(
  owner: string,
  repo: string,
  path: string,
  ref: string,
  maxBytes = 40_000
): Promise<{ path: string; content: string; sha: string } | null> {
  try {
    const octokit = github();
    const { data } = await octokit.rest.repos.getContent({ owner, repo, path, ref });
    if (Array.isArray(data) || data.type !== "file" || !data.content) return null;
    const buf = Buffer.from(data.content, "base64");
    if (buf.includes(0)) return null;
    const text = buf.toString("utf8");
    return {
      path: data.path ?? path,
      content: text.length > maxBytes ? text.slice(0, maxBytes) : text,
      sha: data.sha,
    };
  } catch {
    return null;
  }
}

export async function fetchRepoFile(
  owner: string,
  repo: string,
  path: string,
  ref: string,
  maxBytes = 16_000
): Promise<string | null> {
  const res = await fetchRepoFileWithSha(owner, repo, path, ref, maxBytes);
  return res ? res.content : null;
}

export async function searchSimilarIssues(owner: string, repo: string, query: string) {
  const octokit = github();
  const { data } = await octokit.rest.search.issuesAndPullRequests({
    q: `repo:${owner}/${repo} ${query.slice(0, 120)}`,
    per_page: 3,
  });
  return data.items.map((i) => ({ title: i.title, url: i.html_url, reason: "text match (suggestion, not proof)" }));
}

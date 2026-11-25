// Standalone verification runner: POST /jobs with Bearer RUNNER_TOKEN.
// Docker via execFile only. Holds NO app keys. One job at a time (v0.1).
//
// Image contract: repo checked out at /repo with node_modules installed
// (deps at image build, never at run). Generated test files from the job
// spec are mounted read-only at /repo/tests/patchsignal/.
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, normalize } from "node:path";

const TOKEN = process.env.RUNNER_TOKEN ?? "";
const PORT = Number(process.env.RUNNER_PORT ?? 5001);
const ALLOWED = new Set(["vitest-json", "verify-patch"]);
const TIMEOUT_MS = 120_000;
const MOUNT_POINT = "/repo/tests/patchsignal";

let busy = false;

function run(
  cmd: string,
  args: string[],
  timeoutMs: number
): Promise<{ code: number; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => {
        const e = err as (NodeJS.ErrnoException & { killed?: boolean }) | null;
        // execFile timeout kills the CLI as SIGTERM (killed:true); the
        // container would otherwise be orphaned (--rm only applies on
        // clean CLI exit), so callers must `docker rm -f` by name.
        const timedOut =
          e?.code === "ETIMEDOUT" || e?.killed === true || e?.message?.includes("ETIMEDOUT") === true;
        resolve({
          code: typeof err?.code === "number" ? err.code : err ? 1 : 0,
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? ""),
          timedOut,
        });
      }
    );
  });
}

async function imageDigest(image: string): Promise<string> {
  if (image.includes("@sha256:")) return image.split("@sha256:")[1] ?? "";
  const { code, stdout } = await run("docker", ["image", "inspect", "--format={{.Id}}", image], 30000);
  return code === 0 ? stdout.trim().replace(/^sha256:/, "") : "";
}

function safeTestPath(p: string): string | null {
  const n = normalize(p).replace(/\\/g, "/");
  if (n.includes("..")) return null;
  if (!/^tests\/patchsignal\/[a-zA-Z0-9._-]+\.test\.ts$/.test(n)) return null;
  return n;
}

function extractVitestJson(stdout: string): string {
  const lastEnd = stdout.lastIndexOf("}");
  if (lastEnd === -1) return "";
  let idx = stdout.indexOf("{");
  let checks = 0;
  while (idx !== -1 && idx < lastEnd && checks < 25) {
    checks++;
    const slice = stdout.slice(idx, lastEnd + 1);
    if (slice.includes('"testResults"') || slice.includes('"numTotalTests"')) {
      try {
        const parsed = JSON.parse(slice) as Record<string, unknown>;
        if (parsed && typeof parsed === "object" && ("testResults" in parsed || "numTotalTests" in parsed)) {
          const serialized = JSON.stringify(parsed);
          return serialized.length > 32_000 ? serialized.slice(0, 32_000) : serialized;
        }
      } catch {
        // try next opening brace
      }
    }
    idx = stdout.indexOf("{", idx + 1);
  }
  return "";
}

const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, busy }));
    return;
  }
  if (req.method !== "POST" || req.url !== "/jobs") {
    res.writeHead(404).end("not found");
    return;
  }
  if (!TOKEN || req.headers.authorization !== `Bearer ${TOKEN}`) {
    res.writeHead(401).end("unauthorized");
    return;
  }
  if (busy) {
    res.writeHead(429).end("runner busy (one job at a time in v0.1)");
    return;
  }
  let body = "";
  for await (const c of req) body += c;
  let spec: {
    jobId: string;
    image: string;
    command: string;
    verifyCmd?: string;
    timeoutSec: number;
    files: { path: string; content: string }[];
    repo: { owner: string; name: string; sha: string };
  };
  try {
    spec = JSON.parse(body);
  } catch {
    res.writeHead(400).end("invalid JSON");
    return;
  }
  if (!ALLOWED.has(spec.command)) {
    res.writeHead(400).end("command not allowlisted");
    return;
  }
  if (!spec.image || !Array.isArray(spec.files) || spec.files.length === 0) {
    res.writeHead(400).end("image and files[] required");
    return;
  }

  busy = true;
  const started = Date.now();
  const tmp = await mkdtemp(join(tmpdir(), "ps-"));
  try {
    if (spec.command === "verify-patch") {
      const repoUrl = `https://github.com/${spec.repo.owner}/${spec.repo.name}.git`;
      await run("git", ["clone", "--depth", "1", repoUrl, tmp], 45_000);
      if (spec.repo.sha) {
        await run("git", ["-C", tmp, "checkout", spec.repo.sha], 15_000);
      }
      for (const f of spec.files) {
        const clean = normalize(f.path).replace(/\\/g, "/").replace(/^\.\//, "");
        if (!clean || clean.includes("..") || typeof f.content !== "string" || f.content.length > 200_000) {
          res.writeHead(400).end("bad file entry");
          return;
        }
        const dest = join(tmp, clean);
        await mkdir(dirname(dest), { recursive: true });
        await writeFile(dest, f.content, "utf8");
      }
      const name = `ps_${randomUUID().slice(0, 8)}`;
      const verifyCmd = (spec.verifyCmd || "npm test").split(/[\r\n;&|]/)[0]?.trim() || "npm test";
      const args = [
        "run", "--rm", "--name", name,
        "--cpus", "2",
        "--memory", "2048m",
        "--pids-limit", "512",
        "-v", `${tmp}:/workspace`,
        "-w", "/workspace",
        spec.image,
        "sh", "-lc", verifyCmd,
      ];
      const timeoutMs = Math.min((spec.timeoutSec || 120) * 1000, TIMEOUT_MS);
      const { code, stdout, stderr, timedOut } = await run("docker", args, timeoutMs + 5000);
      await run("docker", ["rm", "-f", name], 15000);
      const durationMs = Date.now() - started;
      const outcome = timedOut ? "timeout" : code === 0 ? "passed" : code > 0 && code < 125 ? "failed" : "error";
      const trunc = (s: string) => (s.length > 8000 ? s.slice(0, 8000) + "\n…[truncated]" : s);
      res.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          jobId: spec.jobId,
          exitCode: code,
          durationMs,
          outcome,
          stdout: trunc(stdout),
          stderr: trunc(stderr),
          imageDigest: await imageDigest(spec.image),
          truncated: stdout.length > 8000 || stderr.length > 8000,
        })
      );
      return;
    }

    const testRel = safeTestPath(spec.files[0]?.path ?? "");
    if (!testRel) {
      res.writeHead(400).end("files[0].path must be tests/patchsignal/*.test.ts");
      return;
    }
    for (const f of spec.files) {
      const rel = safeTestPath(f.path);
      if (!rel || typeof f.content !== "string" || f.content.length > 200_000) {
        res.writeHead(400).end("bad file entry");
        return;
      }
      const dest = join(tmp, rel.split("/").pop() as string);
      await writeFile(dest, f.content, "utf8");
    }
    const name = `ps_${randomUUID().slice(0, 8)}`;
    // --no-install: never reach the network for packages (there is none).
    const vitestCmd = `npx --no-install vitest run tests/patchsignal --reporter=json`;
    const args = [
      "run", "--rm", "--name", name,
      "--network", "none",
      "--user", "65532:65532",
      "--cap-drop", "ALL",
      "--cpus", "1",
      "--memory", "1024m",
      "--pids-limit", "256",
      "-v", `${tmp}:${MOUNT_POINT}:ro`,
      spec.image,
      "sh", "-c", vitestCmd,
    ];
    const timeoutMs = Math.min((spec.timeoutSec || 120) * 1000, TIMEOUT_MS);
    const { code, stdout, stderr, timedOut } = await run("docker", args, timeoutMs + 5000);
    // Belt and braces: remove the container even if the CLI was killed.
    await run("docker", ["rm", "-f", name], 15000);
    const durationMs = Date.now() - started;
    const outcome = timedOut ? "timeout" : code === 0 ? "passed" : code > 0 && code < 125 ? "failed" : "error";
    const trunc = (s: string) => (s.length > 8000 ? s.slice(0, 8000) + "\n…[truncated]" : s);
    res.writeHead(200, { "content-type": "application/json" }).end(
      JSON.stringify({
        jobId: spec.jobId,
        exitCode: code,
        durationMs,
        outcome,
        reportJson: extractVitestJson(stdout),
        stdout: trunc(stdout),
        stderr: trunc(stderr),
        imageDigest: await imageDigest(spec.image),
        truncated: stdout.length > 8000 || stderr.length > 8000,
      })
    );
  } catch (e) {
    res.writeHead(500).end(e instanceof Error ? e.message : "runner error");
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => undefined);
    busy = false;
  }
});

server.listen(PORT, () => console.log(`[runner] listening :${PORT}`));

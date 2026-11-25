import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { config } from "@/lib/config";
import type { FilePatch, RemediationRuntime } from "./types";

const MAX_OUTPUT = 8000;
const EXEC_TIMEOUT_MS = 120_000;

function runExec(
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv } = {}
): Promise<{ code: number; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      {
        cwd: opts.cwd,
        timeout: opts.timeoutMs ?? EXEC_TIMEOUT_MS,
        maxBuffer: 6 * 1024 * 1024,
        env: opts.env,
      },
      (err, stdout, stderr) => {
        const e = err as (NodeJS.ErrnoException & { killed?: boolean }) | null;
        const timedOut =
          e?.code === "ETIMEDOUT" ||
          e?.killed === true ||
          e?.message?.includes("ETIMEDOUT") === true;
        resolve({
          code: typeof e?.code === "number" ? e.code : err ? 1 : 0,
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? ""),
          timedOut,
        });
      }
    );
  });
}

function trunc(s: string): string {
  return s.length > MAX_OUTPUT ? `${s.slice(0, MAX_OUTPUT)}\n…[truncated]` : s;
}

const SAFE_COMMAND_HEADS = new Set([
  "dotnet",
  "npm",
  "npx",
  "node",
  "vitest",
  "tsc",
  "pytest",
  "python",
  "python3",
  "go",
  "cargo",
]);

export function sanitizeVerificationCommand(raw: string, fallback: string): string {
  const firstSegment = raw.trim().split(/[\r\n;&|]/)[0]?.trim() ?? "";
  const head = firstSegment.split(/\s+/)[0]?.toLowerCase() ?? "";
  if (firstSegment && SAFE_COMMAND_HEADS.has(head)) {
    return firstSegment;
  }
  return fallback;
}

function inferDockerImage(ecosystem: string, patches: FilePatch[], repoDirText?: string): string {
  if (ecosystem === "dotnet") {
    const combined = `${repoDirText ?? ""} ${patches.map((p) => p.content).join(" ")}`;
    if (/net10\.0/i.test(combined)) return "mcr.microsoft.com/dotnet/sdk:10.0";
    if (/net9\.0/i.test(combined)) return "mcr.microsoft.com/dotnet/sdk:9.0";
    return "mcr.microsoft.com/dotnet/sdk:8.0";
  }
  if (ecosystem === "python") return "python:3.12-slim";
  if (ecosystem === "go") return "golang:1.23-bookworm";
  if (ecosystem === "rust") return "rust:1.82-slim";
  return "node:22-bookworm-slim";
}

function buildSanitizedEnv(): NodeJS.ProcessEnv {
  const safe: NodeJS.ProcessEnv = {
    CI: "true",
    DOTNET_NOLOGO: "1",
    DOTNET_CLI_TELEMETRY_OPTOUT: "1",
    NODE_ENV: "test",
  };
  for (const key of [
    "PATH",
    "Path",
    "PATHEXT",
    "SYSTEMROOT",
    "SystemRoot",
    "COMSPEC",
    "ComSpec",
    "TEMP",
    "TMP",
    "HOME",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "DOTNET_ROOT",
    "ProgramFiles",
  ]) {
    if (process.env[key]) safe[key] = process.env[key];
  }
  return safe;
}

async function isDockerRunning(): Promise<boolean> {
  const res = await runExec("docker", ["info", "--format", "{{.ServerVersion}}"], {
    timeoutMs: 3000,
  });
  return res.code === 0 && res.stdout.trim().length > 0;
}

async function checkRemoteRunnerHealthy(): Promise<boolean> {
  if (!config.runnerToken || !config.runnerUrl) return false;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    const res = await fetch(`${config.runnerUrl}/health`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return false;
    const data = (await res.json().catch(() => null)) as { ok?: boolean; busy?: boolean } | null;
    return Boolean(data?.ok) && !data?.busy;
  } catch {
    return false;
  }
}

export type VerifyPatchInput = {
  jobId: string;
  owner: string;
  repo: string;
  commitSha: string;
  ecosystem: string;
  manifest?: string | null;
  command: string;
  patches: FilePatch[];
};

export type VerifyPatchOutput = {
  runtime: RemediationRuntime;
  dockerImage?: string;
  command: string;
  exitCode: number;
  outcome: "passed" | "failed" | "error" | "timeout";
  durationMs: number;
  stdout: string;
  stderr: string;
};

export async function verifyPatchInSandbox(input: VerifyPatchInput): Promise<VerifyPatchOutput> {
  const command = sanitizeVerificationCommand(
    input.command,
    input.ecosystem === "dotnet" ? "dotnet build --nologo" : "npm test"
  );
  const started = Date.now();

  // Tier 2 shortcut if remote runner is explicitly healthy & local Docker isn't running
  const dockerUp = await isDockerRunning();
  if (!dockerUp && (await checkRemoteRunnerHealthy())) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), EXEC_TIMEOUT_MS);
      const res = await fetch(`${config.runnerUrl}/jobs`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${config.runnerToken}`,
        },
        body: JSON.stringify({
          jobId: input.jobId,
          repo: { owner: input.owner, name: input.repo, sha: input.commitSha },
          image: inferDockerImage(input.ecosystem, input.patches),
          ecosystem: input.ecosystem,
          command: "verify-patch",
          verifyCmd: command,
          timeoutSec: 120,
          limits: { cpus: 2, memoryMb: 2048, pids: 256 },
          files: input.patches.map((p) => ({ path: p.path, content: p.content })),
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (res.ok) {
        const data = (await res.json()) as {
          exitCode: number;
          outcome: "passed" | "failed" | "error" | "timeout";
          durationMs: number;
          stdout: string;
          stderr: string;
          imageDigest?: string;
        };
        return {
          runtime: "remote-runner",
          dockerImage: data.imageDigest || undefined,
          command,
          exitCode: data.exitCode,
          outcome: data.outcome,
          durationMs: data.durationMs || Date.now() - started,
          stdout: trunc(data.stdout ?? ""),
          stderr: trunc(data.stderr ?? ""),
        };
      }
    } catch {
      // Fall through cleanly to local isolated sandbox
    }
  }

  // Clone public repo into an ephemeral temp workspace
  const workDir = await mkdtemp(join(tmpdir(), "ps-remedy-"));
  try {
    const repoUrl = `https://github.com/${input.owner}/${input.repo}.git`;
    const clone = await runExec("git", ["clone", "--depth", "1", repoUrl, workDir], {
      timeoutMs: 45_000,
    });
    if (clone.code !== 0) {
      return {
        runtime: dockerUp ? "docker-container" : "local-sandbox",
        command,
        exitCode: clone.code || 1,
        outcome: "error",
        durationMs: Date.now() - started,
        stdout: trunc(clone.stdout),
        stderr: trunc(`Failed to clone repository for verification:\n${clone.stderr}`),
      };
    }

    if (input.commitSha && /^[a-f0-9]{7,40}$/i.test(input.commitSha)) {
      await runExec("git", ["checkout", input.commitSha], { cwd: workDir, timeoutMs: 15_000 });
    }

    // Write candidate patches into cloned workspace
    for (const patch of input.patches) {
      const dest = join(workDir, patch.path);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, patch.content, "utf8");
    }

    let manifestText = "";
    if (input.manifest) {
      manifestText = await readFile(join(workDir, input.manifest), "utf8").catch(() => "");
    }

    // Tier 1: Local Docker Container Execution
    if (dockerUp) {
      const dockerImage = inferDockerImage(input.ecosystem, input.patches, manifestText);
      const containerName = `ps_remedy_${randomUUID().slice(0, 8)}`;
      const needsRestore =
        input.ecosystem === "dotnet" || input.ecosystem === "node" || input.ecosystem === "node-vitest";

      // NuGet restore / npm ci requires network only if deps aren't cached in base image;
      // use bounded resource limits (--cpus, --memory, --pids-limit, non-root or clean workspace).
      const shellCmd =
        input.ecosystem === "node" || input.ecosystem === "node-vitest"
          ? `(npm ci --ignore-scripts --silent || npm install --ignore-scripts --silent) && ${command}`
          : command;

      const dockerArgs = [
        "run",
        "--rm",
        "--name",
        containerName,
        ...(needsRestore ? [] : ["--network", "none"]),
        "--cpus",
        "2",
        "--memory",
        "2048m",
        "--pids-limit",
        "512",
        "-v",
        `${workDir}:/workspace`,
        "-w",
        "/workspace",
        dockerImage,
        "sh",
        "-lc",
        shellCmd,
      ];

      const execRes = await runExec("docker", dockerArgs, { timeoutMs: EXEC_TIMEOUT_MS + 10_000 });
      await runExec("docker", ["rm", "-f", containerName], { timeoutMs: 10_000 });
      const durationMs = Date.now() - started;
      const outcome = execRes.timedOut
        ? "timeout"
        : execRes.code === 0
          ? "passed"
          : execRes.code > 0 && execRes.code < 125
            ? "failed"
            : "error";

      return {
        runtime: "docker-container",
        dockerImage,
        command,
        exitCode: execRes.code,
        outcome,
        durationMs,
        stdout: trunc(execRes.stdout),
        stderr: trunc(execRes.stderr),
      };
    }

    // Tier 3: Isolated Local Ephemeral Sandbox (sanitized env, no app secrets)
    const safeEnv = buildSanitizedEnv();
    if (input.ecosystem === "node" || input.ecosystem === "node-vitest") {
      const installCmd = process.platform === "win32" ? "npm.cmd" : "npm";
      await runExec(installCmd, ["install", "--ignore-scripts", "--no-audit", "--no-fund"], {
        cwd: workDir,
        env: safeEnv,
        timeoutMs: 60_000,
      });
    }

    const parts = command.split(/\s+/).filter(Boolean);
    const binRaw = parts[0] ?? "dotnet";
    const bin =
      process.platform === "win32" && (binRaw === "npm" || binRaw === "npx")
        ? `${binRaw}.cmd`
        : binRaw;
    const cmdArgs = parts.slice(1);

    const localRes = await runExec(bin, cmdArgs, {
      cwd: workDir,
      env: safeEnv,
      timeoutMs: EXEC_TIMEOUT_MS,
    });
    const durationMs = Date.now() - started;
    const outcome = localRes.timedOut
      ? "timeout"
      : localRes.code === 0
        ? "passed"
        : localRes.code > 0 && localRes.code < 125
          ? "failed"
          : "error";

    return {
      runtime: "local-sandbox",
      command,
      exitCode: localRes.code,
      outcome,
      durationMs,
      stdout: trunc(localRes.stdout),
      stderr: trunc(localRes.stderr),
    };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

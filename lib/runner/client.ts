import { config } from "@/lib/config";

export type JobSpec = {
  jobId: string;
  repo: { owner: string; name: string; sha: string };
  image: string;
  ecosystem: "node-vitest";
  files: { path: string; content: string }[];
  command: "vitest-json";
  timeoutSec: number;
  limits: { cpus: number; memoryMb: number; pids: number };
};

export type JobResult = {
  jobId: string;
  exitCode: number;
  durationMs: number;
  outcome: "passed" | "failed" | "error" | "timeout";
  reportJson?: string;
  stdout: string;
  stderr: string;
  imageDigest?: string;
  truncated: boolean;
};

export async function dispatchJob(spec: JobSpec): Promise<JobResult> {
  const res = await fetch(`${config.runnerUrl}/jobs`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${config.runnerToken}` },
    body: JSON.stringify(spec),
  });
  if (!res.ok) throw new Error(`runner rejected job: ${res.status} ${await res.text()}`);
  return (await res.json()) as JobResult;
}

export function buildTestPath(invId: string): string {
  return `tests/patchsignal/repro-${invId.slice(0, 8)}.test.ts`;
}

export function vitestTemplate(targetModule: string | null, hypothesis: string): string {
  const safeComment = hypothesis.replace(/[\r\n]+/g, " ").trim();
  if (!targetModule) {
    return [
      `import { describe, it } from "vitest";`,
      `// Hypothesis: ${safeComment}`,
      ``,
      `describe("patchsignal repro", () => {`,
      `  it("asserts correct behaviour (fails on bug, passes when fixed)", () => {`,
      `    throw new Error("target module missing — mark Inconclusive, do not fake pass");`,
      `  });`,
      `});`,
      ``,
    ].join("\n");
  }
  const normalized = targetModule.replace(/^\.\//, "").replace(/\.(ts|tsx|js|jsx|mjs|cjs)$/, "");
  const importPath = normalized.startsWith("../") ? normalized : `../../${normalized}`;
  return [
    `import { describe, expect, it } from "vitest";`,
    `import * as targetModule from "${importPath}";`,
    `// Hypothesis: ${safeComment}`,
    `// Target module under test: ${targetModule}`,
    ``,
    `describe("patchsignal repro", () => {`,
    `  it("asserts correct behaviour (fails on bug, passes when fixed)", () => {`,
    `    expect(targetModule, "target module missing — mark Inconclusive, do not fake pass").toBeTruthy();`,
    `  });`,
    `});`,
    ``,
  ].join("\n");
}

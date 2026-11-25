import path from "node:path";
import { config } from "@/lib/config";
import { fetchRepoFile } from "@/lib/github/client";
import { proposeHypothesisWithGemini } from "@/lib/gemma/client";
import { proposeHypothesisWithGroq } from "@/lib/groq/client";
import { buildTestPath, vitestTemplate } from "@/lib/runner/client";

export class HypothesisValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HypothesisValidationError";
  }
}

const FORBIDDEN_MODULES = new Set([
  "child_process",
  "node:child_process",
  "fs",
  "node:fs",
  "fs/promises",
  "node:fs/promises",
  "net",
  "node:net",
  "http",
  "node:http",
  "https",
  "node:https",
  "dns",
  "node:dns",
  "vm",
  "node:vm",
  "worker_threads",
  "node:worker_threads",
]);

const CODE_FILE_RE = /\.(ts|tsx|js|jsx|mjs|cjs)$/i;
const IGNORED_PATH_RE = /(^|\/)(node_modules|dist|build|\.next|coverage)\//i;
const TEST_OR_TYPE_RE = /(\.(test|spec)\.[^.]+$|\.d\.ts$|vitest\.config|^tests\/patchsignal\/)/i;

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function extractImportSpecifiers(code: string): string[] {
  const cleaned = stripComments(code);
  const specs: string[] = [];
  const staticImportRe = /(?:^|[\s;])(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/gm;
  const dynamicImportRe = /(?:import|require)\s*\(\s*["']([^"']+)["']\s*\)/g;
  for (const match of cleaned.matchAll(staticImportRe)) {
    if (match[1]) specs.push(match[1]);
  }
  for (const match of cleaned.matchAll(dynamicImportRe)) {
    if (match[1]) specs.push(match[1]);
  }
  return Array.from(new Set(specs));
}

function resolveCandidateRepoPaths(resolvedPosix: string): string[] {
  const clean = resolvedPosix.replace(/^\.\//, "");
  const candidates = [
    clean,
    `${clean}.ts`,
    `${clean}.tsx`,
    `${clean}.js`,
    `${clean}.jsx`,
    `${clean}.mjs`,
    `${clean}.cjs`,
    `${clean}/index.ts`,
    `${clean}/index.tsx`,
    `${clean}/index.js`,
    `${clean}/index.jsx`,
  ];
  const jsExtMatch = clean.match(/\.(js|jsx|mjs|cjs)$/i);
  if (jsExtMatch) {
    const stem = clean.slice(0, -jsExtMatch[0].length);
    candidates.push(`${stem}.ts`, `${stem}.tsx`, `${stem}.mts`, `${stem}.cts`, `${stem}/index.ts`);
  }
  return candidates;
}

export function validateTestImports(
  testPath: string,
  content: string,
  repoPaths: string[]
): { ok: boolean; missing: string[]; forbidden: string[] } {
  const missing: string[] = [];
  const forbidden: string[] = [];
  const specs = extractImportSpecifiers(content);
  const testDir = path.posix.dirname(testPath.replace(/\\/g, "/"));
  const repoSet = new Set(repoPaths.map((p) => p.replace(/\\/g, "/").replace(/^\.\//, "")));

  for (const spec of specs) {
    if (FORBIDDEN_MODULES.has(spec) || spec.startsWith("node:fs/") || spec.startsWith("fs/")) {
      forbidden.push(spec);
      continue;
    }
    if (spec.startsWith("./") || spec.startsWith("../")) {
      const normalized = path.posix.normalize(path.posix.join(testDir, spec));
      if (normalized === ".." || normalized.startsWith("../")) {
        missing.push(spec);
        continue;
      }
      if (repoSet.size > 0) {
        const candidates = resolveCandidateRepoPaths(normalized);
        if (!candidates.some((c) => repoSet.has(c))) {
          missing.push(`${spec} -> ${normalized}`);
        }
      }
    }
  }

  return { ok: missing.length === 0 && forbidden.length === 0, missing, forbidden };
}

export function selectCandidateSourcePaths(
  repoPaths: string[],
  candidateAreas: { path: string }[],
  textContext: string,
  limit = 3
): string[] {
  const codeFiles = repoPaths.filter(
    (p) => CODE_FILE_RE.test(p) && !IGNORED_PATH_RE.test(p) && !TEST_OR_TYPE_RE.test(p)
  );
  if (codeFiles.length === 0) return [];

  const areaPaths = candidateAreas.map((a) => a.path.replace(/^\.\//, "").toLowerCase()).filter(Boolean);
  const tokens = Array.from(
    new Set(
      textContext
        .toLowerCase()
        .split(/[^a-z0-9_]+/)
        .filter((t) => t.length >= 3)
    )
  );

  const scored = codeFiles.map((filePath) => {
    const low = filePath.toLowerCase();
    let score = 0;
    for (const area of areaPaths) {
      if (low === area || low.endsWith(area) || area.endsWith(low)) score += 100;
    }
    const segments = low.split(/[/.\\_-]+/).filter((s) => s.length >= 3);
    for (const seg of segments) {
      if (tokens.includes(seg)) score += 10;
    }
    if (low.startsWith("src/")) score += 2;
    return { filePath, score };
  });

  scored.sort((a, b) => b.score - a.score || a.filePath.length - b.filePath.length || a.filePath.localeCompare(b.filePath));
  return scored.slice(0, limit).map((s) => s.filePath);
}

export type FallbackHypothesisInput = {
  investigationId: string;
  description: string;
  expected?: string | null;
  actual?: string | null;
  steps?: string | null;
  summary?: string | null;
  evidenceItems?: { text: string; provenance: string; source: string }[];
  candidateAreas?: { path: string; provenance?: string }[];
  repoPaths?: string[];
  overrides?: {
    statement?: string;
    triggerConditions?: string;
    expectedFailure?: string;
    evidenceNeeded?: string;
    targetFile?: string;
  };
};

export function buildFallbackHypothesis(input: FallbackHypothesisInput) {
  const firstHypItem = input.evidenceItems?.find((i) => i.provenance === "hypothesis")?.text;
  const statement =
    input.overrides?.statement?.trim() || firstHypItem || input.summary?.trim() || input.description.trim();
  const triggerConditions =
    input.overrides?.triggerConditions?.trim() || input.steps?.trim() || input.description.trim();
  const expectedVsActual =
    input.expected || input.actual
      ? [
          input.expected ? `Expected: ${input.expected}` : "",
          input.actual ? `Actual: ${input.actual}` : "",
        ]
          .filter(Boolean)
          .join("; ")
      : "";
  const expectedFailure =
    input.overrides?.expectedFailure?.trim() || expectedVsActual || input.description.trim();
  const evidenceNeeded =
    input.overrides?.evidenceNeeded?.trim() ||
    "Vitest run failing with predicted assertion on target, passing on control";

  const repoPaths = input.repoPaths ?? [];
  const textContext = [
    input.description,
    input.summary ?? "",
    ...(input.evidenceItems?.map((e) => e.text) ?? []),
  ].join(" ");
  const candidates = selectCandidateSourcePaths(repoPaths, input.candidateAreas ?? [], textContext, 3);

  const targetFile =
    input.overrides?.targetFile?.trim() ||
    (candidates.length > 0 ? candidates[0] : repoPaths.length === 0 ? "src/validation/email" : null);

  const testPath = buildTestPath(input.investigationId);
  const content = vitestTemplate(targetFile, statement);
  return {
    statement,
    triggerConditions,
    expectedFailure,
    evidenceNeeded,
    path: testPath,
    content,
  };
}

export type GenerateHypothesisInput = {
  investigationId: string;
  owner: string;
  repo: string;
  commitSha?: string | null;
  description: string;
  expected?: string | null;
  actual?: string | null;
  steps?: string | null;
  errorText?: string | null;
  summary?: string | null;
  evidenceItems: { text: string; provenance: string; source: string }[];
  candidateAreas: { path: string; provenance?: string }[];
  repoPaths: string[];
  overrides?: {
    statement?: string;
    triggerConditions?: string;
    expectedFailure?: string;
    evidenceNeeded?: string;
    targetFile?: string;
    content?: string;
  };
};

function formatImportValidationError(result: { missing: string[]; forbidden: string[] }): string {
  const parts: string[] = [];
  if (result.missing.length) {
    parts.push(`unknown or out-of-tree imports [${result.missing.join(", ")}]`);
  }
  if (result.forbidden.length) {
    parts.push(`forbidden modules [${result.forbidden.join(", ")}]`);
  }
  return `generated test failed import check: ${parts.join("; ")} (HYP-4)`;
}

export async function generateHypothesis(input: GenerateHypothesisInput) {
  const testPath = buildTestPath(input.investigationId);
  const fallback = buildFallbackHypothesis(input);

  if (input.overrides?.content && input.overrides.content.trim()) {
    const check = validateTestImports(testPath, input.overrides.content, input.repoPaths);
    if (!check.ok) {
      throw new HypothesisValidationError(formatImportValidationError(check));
    }
    return {
      statement: fallback.statement,
      triggerConditions: fallback.triggerConditions,
      expectedFailure: fallback.expectedFailure,
      evidenceNeeded: fallback.evidenceNeeded,
      path: testPath,
      content: input.overrides.content,
      modelId: "caller",
    };
  }

  const hasKey = config.modelProvider === "groq" ? !!config.groqApiKey : !!config.geminiApiKey;
  if (!hasKey) {
    const check = validateTestImports(testPath, fallback.content, input.repoPaths);
    if (!check.ok) {
      throw new HypothesisValidationError(formatImportValidationError(check));
    }
    return { ...fallback, modelId: "template-fallback" };
  }

  const textContext = [
    input.description,
    input.summary ?? "",
    input.errorText ?? "",
    ...input.evidenceItems.map((e) => e.text),
  ].join(" ");
  const candidateFiles = input.overrides?.targetFile?.trim()
    ? [input.overrides.targetFile.trim()]
    : selectCandidateSourcePaths(input.repoPaths, input.candidateAreas, textContext, 3);

  const sourceFiles: { path: string; content: string }[] = [];
  if (input.commitSha && candidateFiles.length > 0) {
    const fetched = await Promise.all(
      candidateFiles.map(async (filePath) => {
        const content = await fetchRepoFile(input.owner, input.repo, filePath, input.commitSha!);
        return content !== null ? { path: filePath, content } : null;
      })
    );
    for (const item of fetched) {
      if (item) sourceFiles.push(item);
    }
  }

  const llmInput = {
    testPath,
    description: input.description,
    expected: input.expected ?? "",
    actual: input.actual ?? "",
    steps: input.steps ?? "",
    errorText: input.errorText ?? "",
    summary: input.summary ?? "",
    evidenceItems: input.evidenceItems,
    repoPaths: input.repoPaths,
    sourceFiles,
    validateTestCode: (code: string) => {
      const check = validateTestImports(testPath, code, input.repoPaths);
      return check.ok ? null : formatImportValidationError(check);
    },
  };

  const { hypothesis, modelId } =
    config.modelProvider === "groq"
      ? await proposeHypothesisWithGroq(llmInput)
      : await proposeHypothesisWithGemini(llmInput);

  return {
    statement: input.overrides?.statement?.trim() || hypothesis.statement,
    triggerConditions: input.overrides?.triggerConditions?.trim() || hypothesis.triggerConditions,
    expectedFailure: input.overrides?.expectedFailure?.trim() || hypothesis.expectedFailure,
    evidenceNeeded: input.overrides?.evidenceNeeded?.trim() || hypothesis.evidenceNeeded,
    path: testPath,
    content: hypothesis.testCode,
    modelId,
  };
}

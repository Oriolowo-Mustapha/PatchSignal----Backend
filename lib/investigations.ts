import { prisma } from "@/lib/db/client";
import { withDbRetry } from "@/lib/db/retry";
import { memoryStore, useMemoryStore, type StoredInvestigation } from "@/lib/store";

export type NormalizedHypothesis = {
  hypothesisId?: string;
  statement?: string;
  triggerConditions?: string;
  expectedFailure?: string;
  evidenceNeeded?: string;
  path?: string;
  content?: string;
};

export type NormalizedInspection = {
  defaultBranch?: string;
  sha?: string;
  paths: string[];
  manifest?: string | null;
  pkg?: Record<string, unknown> | null;
  ecosystem?: string;
};

export type NormalizedEvidence = {
  summary: string;
  items: { text: string; provenance: string; source: string }[];
  questions: { text: string; blocking: boolean }[];
  candidateAreas: { path: string; provenance: string }[];
};

export type NormalizedClassification = {
  status: string;
  rule?: string;
  justification?: string;
};

export type NormalizedRun = {
  role: string;
  outcome: string;
  exitCode?: number | null;
  revisionSha?: string | null;
  imageDigest?: string | null;
  command?: string;
  durationMs?: number | null;
  truncated?: boolean;
};

export async function getInvestigation(id: string) {
  if (useMemoryStore()) return memoryStore.get(id);
  const inv = await withDbRetry(() =>
    prisma.investigation.findUnique({
      where: { id },
      include: {
        analysisJob: { select: { id: true, status: true, error: true, updatedAt: true } },
        evidence: { orderBy: { createdAt: "asc" } },
        questions: true,
        hypotheses: {
          orderBy: { rank: "asc" },
          include: { tests: true, runs: { orderBy: { createdAt: "asc" } } },
        },
        attachments: { orderBy: { createdAt: "asc" } },
        classifications: { orderBy: { decidedAt: "asc" } },
      },
    })
  );
  return inv;
}

export async function saveClassification(
  invId: string,
  status: "Reproduced" | "Not_reproduced" | "Inconclusive",
  rule: string,
  justification: string,
  stage: "ran" | "packaged" = "ran"
) {
  if (useMemoryStore()) {
    return memoryStore.update(invId, { classification: { status, rule, justification }, status, stage });
  }
  await prisma.classification.create({ data: { investigationId: invId, status, rule, justification } });
  return prisma.investigation.update({ where: { id: invId }, data: { status, stage } });
}

export function getLatestHypothesisAndTest(inv: unknown): NormalizedHypothesis | null {
  if (!inv || typeof inv !== "object") return null;
  const rec = inv as Record<string, unknown>;
  if (Array.isArray(rec.hypotheses) && rec.hypotheses.length > 0) {
    const hyp = rec.hypotheses[rec.hypotheses.length - 1] as Record<string, unknown>;
    const tests = Array.isArray(hyp.tests) ? (hyp.tests as Record<string, unknown>[]) : [];
    const test = tests.length > 0 ? tests[tests.length - 1] : null;
    return {
      hypothesisId: typeof hyp.id === "string" ? hyp.id : undefined,
      statement: typeof hyp.statement === "string" ? hyp.statement : undefined,
      triggerConditions: typeof hyp.triggerConditions === "string" ? hyp.triggerConditions : undefined,
      expectedFailure: typeof hyp.expectedFailure === "string" ? hyp.expectedFailure : undefined,
      evidenceNeeded: typeof hyp.evidenceNeeded === "string" ? hyp.evidenceNeeded : undefined,
      path: test && typeof test.path === "string" ? test.path : undefined,
      content: test && typeof test.content === "string" ? test.content : undefined,
    };
  }
  if (rec.hypothesis && typeof rec.hypothesis === "object") {
    const hyp = rec.hypothesis as Record<string, unknown>;
    return {
      hypothesisId: typeof hyp.id === "string" ? hyp.id : undefined,
      statement: typeof hyp.statement === "string" ? hyp.statement : undefined,
      triggerConditions: typeof hyp.triggerConditions === "string" ? hyp.triggerConditions : undefined,
      expectedFailure: typeof hyp.expectedFailure === "string" ? hyp.expectedFailure : undefined,
      evidenceNeeded: typeof hyp.evidenceNeeded === "string" ? hyp.evidenceNeeded : undefined,
      path: typeof hyp.path === "string" ? hyp.path : undefined,
      content: typeof hyp.content === "string" ? hyp.content : undefined,
    };
  }
  return null;
}

export function getInspectionData(inv: unknown): NormalizedInspection | null {
  if (!inv || typeof inv !== "object") return null;
  const rec = inv as Record<string, unknown>;
  const raw = (rec.inspectionJson ?? rec.inspection) as Record<string, unknown> | null | undefined;
  if (!raw || typeof raw !== "object") return null;
  return {
    defaultBranch: typeof raw.defaultBranch === "string" ? raw.defaultBranch : undefined,
    sha: typeof raw.sha === "string" ? raw.sha : typeof rec.commitSha === "string" ? rec.commitSha : undefined,
    paths: Array.isArray(raw.paths) ? raw.paths.filter((p): p is string => typeof p === "string") : [],
    manifest: typeof raw.manifest === "string" ? raw.manifest : null,
    pkg: raw.pkg && typeof raw.pkg === "object" ? (raw.pkg as Record<string, unknown>) : null,
    ecosystem: typeof raw.ecosystem === "string" ? raw.ecosystem : undefined,
  };
}

export function getNormalizedEvidence(inv: unknown): NormalizedEvidence {
  if (!inv || typeof inv !== "object") {
    return { summary: "", items: [], questions: [], candidateAreas: [] };
  }
  const rec = inv as Record<string, unknown>;
  const memEvidence =
    rec.evidence && !Array.isArray(rec.evidence) && typeof rec.evidence === "object"
      ? (rec.evidence as Record<string, unknown>)
      : null;

  const summary =
    (typeof rec.summary === "string" && rec.summary) ||
    (memEvidence && typeof memEvidence.summary === "string" ? memEvidence.summary : "") ||
    "";

  const rawItems = Array.isArray(rec.evidence)
    ? rec.evidence
    : memEvidence && Array.isArray(memEvidence.evidence)
      ? memEvidence.evidence
      : [];
  const items = rawItems
    .filter((i): i is Record<string, unknown> => Boolean(i && typeof i === "object"))
    .map((i) => ({
      text: String(i.text ?? ""),
      provenance: String(i.provenance ?? "unknown"),
      source: String(i.source ?? "model"),
    }))
    .filter((i) => i.text.length > 0);

  const rawQuestions = Array.isArray(rec.questions)
    ? rec.questions
    : memEvidence && Array.isArray(memEvidence.unknowns)
      ? memEvidence.unknowns
      : [];
  const questions = rawQuestions
    .filter((q): q is Record<string, unknown> => Boolean(q && typeof q === "object"))
    .map((q) => ({
      text: String(q.text ?? q.question ?? ""),
      blocking: Boolean(q.blocking),
    }))
    .filter((q) => q.text.length > 0);

  const rawAreas = Array.isArray(rec.candidateAreas)
    ? rec.candidateAreas
    : memEvidence && Array.isArray(memEvidence.candidateAreas)
      ? memEvidence.candidateAreas
      : [];
  const candidateAreas = rawAreas
    .filter((a): a is Record<string, unknown> => Boolean(a && typeof a === "object"))
    .map((a) => ({
      path: String(a.path ?? ""),
      provenance: String(a.provenance ?? "hypothesis"),
    }))
    .filter((a) => a.path.length > 0);

  return { summary, items, questions, candidateAreas };
}

export function getLatestClassification(inv: unknown): NormalizedClassification | null {
  if (!inv || typeof inv !== "object") return null;
  const rec = inv as Record<string, unknown>;
  if (Array.isArray(rec.classifications) && rec.classifications.length > 0) {
    const cls = rec.classifications[rec.classifications.length - 1] as Record<string, unknown>;
    return {
      status: String(cls.status ?? "pending"),
      rule: typeof cls.rule === "string" ? cls.rule : undefined,
      justification: typeof cls.justification === "string" ? cls.justification : undefined,
    };
  }
  if (rec.classification && typeof rec.classification === "object") {
    const cls = rec.classification as Record<string, unknown>;
    return {
      status: String(cls.status ?? "pending"),
      rule: typeof cls.rule === "string" ? cls.rule : undefined,
      justification: typeof cls.justification === "string" ? cls.justification : undefined,
    };
  }
  return null;
}

export function getNormalizedRuns(inv: unknown): NormalizedRun[] {
  if (!inv || typeof inv !== "object") return [];
  const rec = inv as Record<string, unknown>;
  if (Array.isArray(rec.hypotheses)) {
    const runs: NormalizedRun[] = [];
    for (const h of rec.hypotheses) {
      if (h && typeof h === "object" && Array.isArray((h as Record<string, unknown>).runs)) {
        for (const r of (h as Record<string, unknown>).runs as Record<string, unknown>[]) {
          runs.push({
            role: String(r.role ?? "target"),
            outcome: String(r.outcome ?? "error"),
            exitCode: typeof r.exitCode === "number" ? r.exitCode : null,
            revisionSha: typeof r.revisionSha === "string" ? r.revisionSha : null,
            imageDigest: typeof r.imageDigest === "string" ? r.imageDigest : null,
            command: typeof r.command === "string" ? r.command : undefined,
            durationMs: typeof r.durationMs === "number" ? r.durationMs : null,
            truncated: Boolean(r.truncated),
          });
        }
      }
    }
    if (runs.length > 0) return runs;
  }
  if (rec.runs && typeof rec.runs === "object") {
    const memRuns = rec.runs as Record<string, unknown>;
    const list: NormalizedRun[] = [];
    for (const role of ["target", "control"] as const) {
      const r = memRuns[role];
      if (r && typeof r === "object") {
        const rr = r as Record<string, unknown>;
        list.push({
          role: String(rr.role ?? role),
          outcome: String(rr.outcome ?? "error"),
          exitCode: typeof rr.exitCode === "number" ? rr.exitCode : null,
          revisionSha:
            typeof rr.revisionSha === "string"
              ? rr.revisionSha
              : role === "target" && typeof rec.commitSha === "string"
                ? rec.commitSha
                : role === "control" && typeof rec.controlSha === "string"
                  ? rec.controlSha
                  : null,
          imageDigest: typeof rr.imageDigest === "string" ? rr.imageDigest : null,
          command: typeof rr.command === "string" ? rr.command : undefined,
          durationMs: typeof rr.durationMs === "number" ? rr.durationMs : null,
          truncated: Boolean(rr.truncated),
        });
      }
    }
    return list;
  }
  return [];
}

export type { StoredInvestigation };

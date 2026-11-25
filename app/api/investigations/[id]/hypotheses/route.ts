import { NextRequest, NextResponse } from "next/server";
import {
  getInspectionData,
  getInvestigation,
  getNormalizedEvidence,
} from "@/lib/investigations";
import { memoryStore, useMemoryStore } from "@/lib/store";
import { prisma } from "@/lib/db/client";
import { authUser, owns } from "@/lib/auth";
import { generateHypothesis, HypothesisValidationError } from "@/lib/hypothesis/generator";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authUser(req);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const inv = (await getInvestigation(id)) as unknown as {
    id: string;
    userId?: string | null;
    owner: string;
    repo: string;
    commitSha?: string | null;
    description: string;
    expected?: string | null;
    actual?: string | null;
    steps?: string | null;
    errorText?: string | null;
  } | null;
  if (!inv || !owns(inv, auth.userId)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const inspection = getInspectionData(inv);
  if (inspection?.ecosystem === "unsupported") {
    return NextResponse.json(
      { error: "Repository ecosystem is unsupported (CLS-4); cannot generate Vitest hypothesis." },
      { status: 400 }
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    statement?: string;
    triggerConditions?: string;
    expectedFailure?: string;
    evidenceNeeded?: string;
    targetFile?: string;
    content?: string;
  };
  const evidence = getNormalizedEvidence(inv);

  let hypothesis: Awaited<ReturnType<typeof generateHypothesis>>;
  try {
    hypothesis = await generateHypothesis({
      investigationId: id,
      owner: inv.owner,
      repo: inv.repo,
      commitSha: inv.commitSha ?? inspection?.sha ?? null,
      description: inv.description,
      expected: inv.expected,
      actual: inv.actual,
      steps: inv.steps,
      errorText: inv.errorText,
      summary: evidence.summary,
      evidenceItems: evidence.items,
      candidateAreas: evidence.candidateAreas,
      repoPaths: inspection?.paths ?? [],
      overrides: {
        statement: typeof body.statement === "string" ? body.statement : undefined,
        triggerConditions: typeof body.triggerConditions === "string" ? body.triggerConditions : undefined,
        expectedFailure: typeof body.expectedFailure === "string" ? body.expectedFailure : undefined,
        evidenceNeeded: typeof body.evidenceNeeded === "string" ? body.evidenceNeeded : undefined,
        targetFile: typeof body.targetFile === "string" ? body.targetFile : undefined,
        content: typeof body.content === "string" ? body.content : undefined,
      },
    });
  } catch (e) {
    if (e instanceof HypothesisValidationError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "hypothesis generation failed" },
      { status: 502 }
    );
  }

  if (useMemoryStore()) {
    memoryStore.update(id, { hypothesis, stage: "hypothesized" });
  } else {
    const h = await prisma.hypothesis.create({
      data: {
        investigationId: id,
        statement: hypothesis.statement,
        triggerConditions: hypothesis.triggerConditions,
        expectedFailure: hypothesis.expectedFailure,
        evidenceNeeded: hypothesis.evidenceNeeded,
      },
    });
    await prisma.testArtifact.create({
      data: {
        hypothesisId: h.id,
        path: hypothesis.path,
        content: hypothesis.content,
        framework: "vitest",
      },
    });
    await prisma.investigation.update({ where: { id }, data: { stage: "hypothesized" } });
  }
  return NextResponse.json(hypothesis, { status: 201 });
}

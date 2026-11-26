import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { authUser, owns } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { withDbRetry } from "@/lib/db/retry";
import { fetchPullRequestChecks, markPullRequestReady } from "@/lib/github/pr";
import { getInvestigation } from "@/lib/investigations";
import type { PullRequestState, RemediationData } from "@/lib/remediation/types";
import { memoryStore, useMemoryStore } from "@/lib/store";

export const runtime = "nodejs";

async function persistPrUpdate(
  id: string,
  inspection: Record<string, unknown>,
  remediation: RemediationData,
  nextPr: PullRequestState
): Promise<RemediationData> {
  const nextRemediation: RemediationData = {
    ...remediation,
    updatedAt: new Date().toISOString(),
    pr: nextPr,
  };
  const nextInspection = { ...inspection, remediation: nextRemediation };

  if (useMemoryStore()) {
    memoryStore.update(id, { inspection: nextInspection });
  } else {
    await withDbRetry(() =>
      prisma.investigation.update({
        where: { id },
        data: { inspectionJson: nextInspection as unknown as Prisma.InputJsonValue },
      })
    );
  }
  return nextRemediation;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authUser(req);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;

  const inv = (await getInvestigation(id)) as unknown as {
    id: string;
    userId?: string | null;
    owner: string;
    repo: string;
    inspectionJson?: Record<string, unknown> | null;
    inspection?: Record<string, unknown> | null;
  } | null;

  if (!inv || !owns(inv, auth.userId)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const inspection = (inv.inspectionJson ?? inv.inspection ?? null) as Record<string, unknown> | null;
  const remediation = inspection?.remediation as RemediationData | undefined;
  const pr = remediation?.pr;

  if (!remediation || !pr || pr.status !== "created" || !pr.headSha) {
    return NextResponse.json(
      { error: "No open Pull Request found for this investigation." },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  try {
    const checkResult = await fetchPullRequestChecks({
      owner: inv.owner,
      repo: inv.repo,
      headSha: pr.headSha,
      prCreatedAt: pr.createdAt,
    });

    const nextPr: PullRequestState = {
      ...pr,
      ciStatus: checkResult.ciStatus,
      ciCheckedAt: checkResult.checkedAt,
      ciChecks: checkResult.checks,
      ciFailureLog: checkResult.ciFailureLog,
    };
    await persistPrUpdate(id, inspection!, remediation, nextPr);

    return NextResponse.json(
      {
        pr: nextPr,
        ciStatus: checkResult.ciStatus,
        checks: checkResult.checks,
        ciFailureLog: checkResult.ciFailureLog,
      },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch Pull Request CI checks" },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authUser(req);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;

  const inv = (await getInvestigation(id)) as unknown as {
    id: string;
    userId?: string | null;
    owner: string;
    repo: string;
    inspectionJson?: Record<string, unknown> | null;
    inspection?: Record<string, unknown> | null;
  } | null;

  if (!inv || !owns(inv, auth.userId)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    githubToken?: string;
  };

  if (body.action !== "mark_ready") {
    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  }

  const inspection = (inv.inspectionJson ?? inv.inspection ?? null) as Record<string, unknown> | null;
  const remediation = inspection?.remediation as RemediationData | undefined;
  const pr = remediation?.pr;

  if (!remediation || !pr || pr.status !== "created" || !pr.prNumber) {
    return NextResponse.json({ error: "No Pull Request available to promote." }, { status: 400 });
  }

  try {
    const promoted = await markPullRequestReady({
      owner: inv.owner,
      repo: inv.repo,
      prNumber: pr.prNumber,
      githubToken: typeof body.githubToken === "string" ? body.githubToken : undefined,
    });

    const nextPr: PullRequestState = {
      ...pr,
      draft: promoted.draft,
      readyForReview: promoted.readyForReview,
    };
    await persistPrUpdate(id, inspection!, remediation, nextPr);

    return NextResponse.json({ pr: nextPr }, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to mark Pull Request ready for review" },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }
}

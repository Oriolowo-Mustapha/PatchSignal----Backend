import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { authUser, owns } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { withDbRetry } from "@/lib/db/retry";
import { createFixPullRequest, CreatePullRequestError } from "@/lib/github/pr";
import { getInvestigation } from "@/lib/investigations";
import type { RemediationData } from "@/lib/remediation/types";
import { memoryStore, useMemoryStore } from "@/lib/store";

export const runtime = "nodejs";

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
    approved?: boolean;
    title?: string;
    body?: string;
    branchName?: string;
    baseBranch?: string;
    githubToken?: string;
  };

  if (body.approved !== true) {
    return NextResponse.json(
      { error: "Explicit user permission (approved: true) is required before creating a Pull Request." },
      { status: 400 }
    );
  }

  const inspection = (inv.inspectionJson ?? inv.inspection ?? null) as Record<string, unknown> | null;
  const remediation = inspection?.remediation as RemediationData | undefined;
  if (!remediation || !Array.isArray(remediation.patches) || remediation.patches.length === 0) {
    return NextResponse.json(
      { error: "No verified code fix patches found. Run automated remediation first." },
      { status: 400 }
    );
  }

  const defaultBranch =
    typeof body.baseBranch === "string" && body.baseBranch.trim()
      ? body.baseBranch.trim()
      : remediation.pr?.baseBranch ||
        (typeof inspection?.defaultBranch === "string" ? inspection.defaultBranch : "main");

  const branchName =
    typeof body.branchName === "string" && body.branchName.trim()
      ? body.branchName.trim()
      : remediation.pr?.branchName || `patchsignal/fix-${id.replace(/[^a-z0-9]/gi, "").slice(0, 8)}`;

  const prTitle =
    typeof body.title === "string" && body.title.trim()
      ? body.title.trim()
      : remediation.pr?.title || `fix: resolve reported issue (${id})`;

  const prBody =
    typeof body.body === "string" && body.body.trim()
      ? body.body.trim()
      : remediation.pr?.body || `Automated fix verified by PatchSignal (${id}).`;

  try {
    const result = await createFixPullRequest({
      owner: inv.owner,
      repo: inv.repo,
      baseBranch: defaultBranch,
      branchName,
      title: prTitle,
      body: prBody,
      patches: remediation.patches,
      githubToken: typeof body.githubToken === "string" ? body.githubToken : undefined,
    });

    const nextRemediation: RemediationData = {
      ...remediation,
      updatedAt: new Date().toISOString(),
      pr: {
        status: "created",
        title: prTitle,
        body: prBody,
        branchName: result.branchName,
        baseBranch: result.baseBranch,
        prUrl: result.prUrl,
        prNumber: result.prNumber,
        headSha: result.headSha,
        ...(result.forkOwner ? { forkOwner: result.forkOwner } : {}),
        createdAt: new Date().toISOString(),
      },
    };
    const nextInspection = { ...inspection, remediation: nextRemediation };

    if (useMemoryStore()) {
      memoryStore.update(id, { inspection: nextInspection, stage: "packaged" });
    } else {
      await withDbRetry(() =>
        prisma.investigation.update({
          where: { id },
          data: {
            inspectionJson: nextInspection as unknown as Prisma.InputJsonValue,
            stage: "packaged",
          },
        })
      );
    }

    return NextResponse.json(
      { pr: nextRemediation.pr, remediation: nextRemediation },
      { status: 201, headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    if (err instanceof CreatePullRequestError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.status, headers: { "Cache-Control": "no-store" } }
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create Pull Request" },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }
}

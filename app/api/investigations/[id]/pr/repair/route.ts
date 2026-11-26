import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { authUser, owns } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { withDbRetry } from "@/lib/db/retry";
import {
  createFixPullRequest,
  CreatePullRequestError,
  fetchPullRequestChecks,
} from "@/lib/github/pr";
import { getInvestigation } from "@/lib/investigations";
import { runRemediationLoop } from "@/lib/remediation/loop";
import type { PullRequestState, RemediationData } from "@/lib/remediation/types";
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
    pushToPr?: boolean;
    maxAttempts?: number;
    customInstruction?: string;
    githubToken?: string;
  };

  if (body.approved !== true) {
    return NextResponse.json(
      { error: "Explicit user permission (approved: true) is required before repairing and pushing to a Pull Request." },
      { status: 400 }
    );
  }

  const inspection = (inv.inspectionJson ?? inv.inspection ?? null) as Record<string, unknown> | null;
  const remediation = inspection?.remediation as RemediationData | undefined;
  const pr = remediation?.pr;

  if (!remediation || !pr || pr.status !== "created" || !pr.prNumber || !pr.headSha) {
    return NextResponse.json(
      { error: "No open Pull Request found to repair." },
      { status: 400 }
    );
  }

  const maxAttempts =
    typeof body.maxAttempts === "number" && Number.isFinite(body.maxAttempts)
      ? Math.min(Math.max(Math.round(body.maxAttempts), 1), 5)
      : 3;
  const customInstruction =
    typeof body.customInstruction === "string" ? body.customInstruction.trim() : undefined;
  const githubToken =
    typeof body.githubToken === "string" && body.githubToken.trim()
      ? body.githubToken.trim()
      : undefined;

  let effectiveFailureLog = pr.ciFailureLog ?? "";
  try {
    const latest = await fetchPullRequestChecks({
      owner: inv.owner,
      repo: inv.repo,
      headSha: pr.headSha,
      prCreatedAt: pr.createdAt,
      githubToken,
    });
    if (latest.ciFailureLog) {
      effectiveFailureLog = latest.ciFailureLog;
    } else if (latest.ciStatus === "failed") {
      const names = latest.checks
        .filter((c) => c.status === "completed" && c.conclusion && c.conclusion !== "success")
        .map((c) => `${c.name} (${c.conclusion})`)
        .join(", ");
      effectiveFailureLog = `GitHub Actions workflow failed on: ${names}`;
    }
  } catch {
    // Use previously persisted failure log if GitHub check refresh encounters a transient error.
  }

  if (!effectiveFailureLog && !customInstruction) {
    return NextResponse.json(
      { error: "No failing CI checks detected for this Pull Request." },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  const ciInstruction = [
    customInstruction,
    "Repair the failing GitHub Actions CI checks shown in the previous attempt log, keeping the fix intact and updating any affected unit tests.",
  ]
    .filter(Boolean)
    .join(" ");

  try {
    const updatedRemediation = await runRemediationLoop(id, {
      maxAttempts,
      customInstruction: ciInstruction,
      seedFailure: {
        command: "GitHub Actions CI",
        exitCode: 1,
        stdout: "",
        stderr: effectiveFailureLog || "CI workflow failed",
        patches: remediation.patches,
      },
      preserveExistingPr: pr,
    });

    if (updatedRemediation.status !== "succeeded" || body.pushToPr === false) {
      return NextResponse.json(
        { remediation: updatedRemediation, pr: updatedRemediation.pr, pushed: false },
        { status: 200, headers: { "Cache-Control": "no-store" } }
      );
    }

    const pushResult = await createFixPullRequest({
      owner: inv.owner,
      repo: inv.repo,
      baseBranch: pr.baseBranch,
      branchName: pr.branchName,
      title: `fix: repair failing CI checks (${updatedRemediation.fixSummary || id})`.slice(0, 72),
      body: pr.body,
      patches: updatedRemediation.patches,
      draft: pr.draft ?? true,
      githubToken,
    });

    const nextPr: PullRequestState = {
      ...pr,
      headSha: pushResult.headSha,
      ciStatus: "pending",
      ciChecks: [],
      ciFailureLog: undefined,
      ciCheckedAt: new Date().toISOString(),
      ciRepairRounds: (pr.ciRepairRounds ?? 0) + 1,
    };

    const finalRemediation: RemediationData = {
      ...updatedRemediation,
      updatedAt: new Date().toISOString(),
      pr: nextPr,
    };
    const nextInspection = { ...(inspection ?? {}), remediation: finalRemediation };

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
      { remediation: finalRemediation, pr: nextPr, pushed: true },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    if (err instanceof CreatePullRequestError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.status, headers: { "Cache-Control": "no-store" } }
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to repair failing CI checks" },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }
}

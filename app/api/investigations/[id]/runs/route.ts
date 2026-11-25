import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import { getInvestigation, getLatestHypothesisAndTest, saveClassification } from "@/lib/investigations";
import { memoryStore, useMemoryStore } from "@/lib/store";
import { prisma } from "@/lib/db/client";
import { authUser, owns } from "@/lib/auth";
import { classify, type ClassifiableRun } from "@/lib/classify/rules";
import { buildTestPath, dispatchJob, type JobResult } from "@/lib/runner/client";
import { analyzeRunnerOutput } from "@/lib/runner/parse";

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
    controlSha?: string | null;
  } | null;
  if (!inv || !owns(inv, auth.userId)) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const latestHyp = getLatestHypothesisAndTest(inv);

  // Allow direct result injection for testing without Docker (honest: caller records source).
  if (body.target && !config.runnerToken) {
    const { status, rule, justification } = classify(
      body.target as ClassifiableRun,
      (body.control as ClassifiableRun | null | undefined) ?? null
    );
    if (useMemoryStore()) {
      memoryStore.update(id, { runs: body, classification: { status, rule, justification }, status, stage: "ran" });
    } else {
      const hypId =
        latestHyp?.hypothesisId ??
        (await prisma.hypothesis.findFirst({ where: { investigationId: id }, orderBy: { rank: "asc" } }))?.id;
      if (hypId) {
        const t = body.target as ClassifiableRun;
        await prisma.run.create({
          data: {
            hypothesisId: hypId,
            role: "target",
            revisionSha: inv.commitSha ?? null,
            command: "injected",
            exitCode: typeof t.exitCode === "number" ? t.exitCode : null,
            outcome: t.outcome,
            stdout: typeof t.stdout === "string" ? t.stdout.slice(0, 8000) : null,
          },
        });
        if (body.control) {
          const c = body.control as ClassifiableRun;
          await prisma.run.create({
            data: {
              hypothesisId: hypId,
              role: "control",
              revisionSha: inv.controlSha ?? null,
              command: "injected",
              exitCode: typeof c.exitCode === "number" ? c.exitCode : null,
              outcome: c.outcome,
              stdout: typeof c.stdout === "string" ? c.stdout.slice(0, 8000) : null,
            },
          });
        }
      }
      await saveClassification(id, status, rule, justification, "ran");
    }
    return NextResponse.json({ status, rule, justification, injected: true });
  }

  try {
    const testPath = latestHyp?.path ?? buildTestPath(id);
    const content = latestHyp?.content ?? "";
    if (!content.trim()) {
      return NextResponse.json(
        { error: "No candidate test content found — call POST /api/investigations/:id/hypotheses first" },
        { status: 400 }
      );
    }
    const image = body.image as string;
    if (!image) return NextResponse.json({ error: "image (pinned image@digest) required" }, { status: 400 });

    const base = {
      ecosystem: "node-vitest" as const,
      command: "vitest-json" as const,
      timeoutSec: 120,
      limits: { cpus: 1, memoryMb: 1024, pids: 256 },
      files: [{ path: testPath, content }],
    };

    const target = await dispatchJob({
      ...base,
      jobId: `${id}-target`,
      repo: { owner: inv.owner, name: inv.repo, sha: inv.commitSha ?? "HEAD" },
      image,
    });

    let control: JobResult | null = null;
    if (inv.controlSha && body.controlImage) {
      control = await dispatchJob({
        ...base,
        jobId: `${id}-control`,
        repo: { owner: inv.owner, name: inv.repo, sha: inv.controlSha },
        image: body.controlImage,
      });
    }

    const expectedContext = [latestHyp?.expectedFailure, body.expected]
      .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
      .join(" ");

    const targetClassifiable = analyzeRunnerOutput(
      {
        role: "target",
        outcome: target.outcome,
        exitCode: target.exitCode,
        stdout: target.stdout,
        stderr: target.stderr,
        reportJson: target.reportJson,
      },
      expectedContext
    );
    const controlClassifiable = control
      ? analyzeRunnerOutput(
          {
            role: "control",
            outcome: control.outcome,
            exitCode: control.exitCode,
            stdout: control.stdout,
            stderr: control.stderr,
            reportJson: control.reportJson,
          },
          expectedContext
        )
      : null;

    const { status, rule, justification } = classify(targetClassifiable, controlClassifiable);

    if (useMemoryStore()) {
      memoryStore.update(id, {
        runs: { target, control },
        classification: { status, rule, justification },
        status,
        stage: "ran",
      });
    } else {
      const hypId =
        latestHyp?.hypothesisId ??
        (await prisma.hypothesis.findFirst({ where: { investigationId: id }, orderBy: { rank: "asc" } }))?.id;
      if (hypId) {
        await prisma.run.create({
          data: {
            hypothesisId: hypId,
            role: "target",
            revisionSha: inv.commitSha ?? null,
            imageDigest: target.imageDigest || image.split("@")[1] || "",
            command: "vitest-json",
            exitCode: target.exitCode,
            outcome: target.outcome,
            durationMs: target.durationMs,
            reportJson: target.reportJson ?? null,
            stdout: target.stdout.slice(0, 8000),
            stderr: target.stderr.slice(0, 8000),
            truncated: target.truncated,
          },
        });
        if (control) {
          await prisma.run.create({
            data: {
              hypothesisId: hypId,
              role: "control",
              revisionSha: inv.controlSha ?? null,
              imageDigest: control.imageDigest || String(body.controlImage).split("@")[1] || "",
              command: "vitest-json",
              exitCode: control.exitCode,
              outcome: control.outcome,
              durationMs: control.durationMs,
              reportJson: control.reportJson ?? null,
              stdout: control.stdout.slice(0, 8000),
              stderr: control.stderr.slice(0, 8000),
              truncated: control.truncated,
            },
          });
        }
      }
      await saveClassification(id, status, rule, justification, "ran");
    }
    return NextResponse.json({ target, control, status, rule, justification });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "run failed" }, { status: 502 });
  }
}

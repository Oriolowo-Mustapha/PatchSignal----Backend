import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { getInvestigation } from "@/lib/investigations";
import { memoryStore, useMemoryStore } from "@/lib/store";
import { prisma } from "@/lib/db/client";
import { authUser, owns } from "@/lib/auth";
import { inspectRepo } from "@/lib/github/client";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
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
  if (!inv || !owns(inv, auth.userId)) return NextResponse.json({ error: "not found" }, { status: 404 });
  try {
    const existingInspection = inv.inspectionJson ?? inv.inspection ?? null;
    const existingRemediation =
      existingInspection && typeof existingInspection === "object"
        ? (existingInspection as { remediation?: unknown }).remediation
        : undefined;
    const rawInspection = await inspectRepo(inv.owner, inv.repo);
    const inspection =
      existingRemediation !== undefined
        ? { ...rawInspection, remediation: existingRemediation }
        : rawInspection;
    // Empty/unsupported repositories end cleanly with Inconclusive (CLS-4).
    if (rawInspection.ecosystem === "unsupported") {
      const justification =
        `Repository ecosystem "${rawInspection.ecosystem}" could not be detected cleanly. ` +
        `No reproduction attempted; this does not imply the bug is absent.`;
      if (useMemoryStore()) {
        memoryStore.update(id, {
          inspection,
          commitSha: rawInspection.sha,
          controlSha: process.env.CONTROL_SHA || undefined,
          stage: "inspected",
          status: "Inconclusive",
          classification: { status: "Inconclusive", rule: "CLS-4", justification },
        });
      } else {
        await prisma.investigation.update({
          where: { id },
          data: {
            commitSha: rawInspection.sha,
            controlSha: process.env.CONTROL_SHA || null,
            inspectionJson: inspection as unknown as Prisma.InputJsonValue,
            stage: "inspected",
            status: "Inconclusive",
          },
        });
        await prisma.classification.create({
          data: { investigationId: id, status: "Inconclusive", rule: "CLS-4", justification },
        });
      }
      return NextResponse.json({ ...inspection, status: "Inconclusive", rule: "CLS-4", justification });
    }
    if (useMemoryStore()) {
      memoryStore.update(id, {
        inspection,
        commitSha: rawInspection.sha,
        controlSha: process.env.CONTROL_SHA || undefined,
        stage: "inspected",
      });
    } else {
      await prisma.investigation.update({
        where: { id },
        data: {
          commitSha: rawInspection.sha,
          controlSha: process.env.CONTROL_SHA || null,
          inspectionJson: inspection as unknown as Prisma.InputJsonValue,
          stage: "inspected",
        },
      });
    }
    return NextResponse.json(inspection);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "inspect failed" }, { status: 502 });
  }
}

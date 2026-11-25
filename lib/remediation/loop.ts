import type { Prisma } from "@prisma/client";
import { withDbRetry } from "@/lib/db/retry";
import { prisma } from "@/lib/db/client";
import { inspectRepo } from "@/lib/github/client";
import {
  getInspectionData,
  getInvestigation,
  getNormalizedEvidence,
  saveClassification,
} from "@/lib/investigations";
import { memoryStore, useMemoryStore } from "@/lib/store";
import { proposeFixIteration } from "./proposer";
import { verifyPatchInSandbox } from "./sandbox-runner";
import type { PullRequestState, RemediationData, RemediationIteration } from "./types";

async function persistRemediation(
  investigationId: string,
  baseInspection: Record<string, unknown>,
  remediation: RemediationData,
  extra?: { commitSha?: string; controlSha?: string | null; stage?: "inspected" | "hypothesized" | "ran" }
) {
  const nextInspection = { ...baseInspection, remediation };
  if (useMemoryStore()) {
    memoryStore.update(investigationId, {
      inspection: nextInspection,
      ...(extra?.commitSha ? { commitSha: extra.commitSha } : {}),
      ...(extra?.stage ? { stage: extra.stage } : {}),
    });
    return;
  }
  await withDbRetry(() =>
    prisma.investigation.update({
      where: { id: investigationId },
      data: {
        inspectionJson: nextInspection as unknown as Prisma.InputJsonValue,
        ...(extra?.commitSha ? { commitSha: extra.commitSha } : {}),
        ...(extra?.stage ? { stage: extra.stage } : {}),
      },
    })
  );
}

function buildPullRequestDraft(
  owner: string,
  repo: string,
  invId: string,
  diagnosis: string,
  fixSummary: string,
  iter: RemediationIteration
): PullRequestState {
  const shortId = invId.replace(/[^a-z0-9]/gi, "").slice(0, 8) || "fix";
  const shortTitle = fixSummary.replace(/\s+/g, " ").trim().slice(0, 72) || "Fix reported bug";
  const title = `fix: ${shortTitle}`;
  const body = [
    `## Root Cause`,
    diagnosis,
    ``,
    `## Changes`,
    fixSummary,
    ``,
    `### Modified Files`,
    ...iter.patches.map((p) => `- \`${p.path}\`: ${p.explanation}`),
    ``,
    `## Verification`,
    `- **Runtime**: \`${iter.runtime}\`${iter.dockerImage ? ` (\`${iter.dockerImage}\`)` : ""}`,
    `- **Command**: \`${iter.command}\``,
    `- **Exit code**: \`${iter.exitCode}\` (${iter.durationMs} ms · verified on attempt ${iter.attempt})`,
    ``,
    `_Prepared and verified automatically by PatchSignal for \`${owner}/${repo}\` (${invId})._`,
  ].join("\n");

  return {
    status: "awaiting_approval",
    title,
    body,
    branchName: `patchsignal/fix-${shortId}`,
    baseBranch: "main",
  };
}

export async function runRemediationLoop(
  investigationId: string,
  options: { maxAttempts?: number; customInstruction?: string } = {}
): Promise<RemediationData> {
  const maxAttempts = Math.min(Math.max(options.maxAttempts ?? 3, 1), 5);
  const inv = (await getInvestigation(investigationId)) as unknown as {
    id: string;
    owner: string;
    repo: string;
    commitSha?: string | null;
    description: string;
    expected?: string | null;
    actual?: string | null;
    steps?: string | null;
    errorText?: string | null;
    inspectionJson?: Record<string, unknown> | null;
    inspection?: Record<string, unknown> | null;
  } | null;

  if (!inv) {
    throw new Error("Investigation not found");
  }

  let inspection = (inv.inspectionJson ?? inv.inspection ?? null) as Record<string, unknown> | null;
  let commitSha = inv.commitSha ?? (getInspectionData(inv)?.sha || "");

  if (!inspection || !commitSha || !Array.isArray(inspection.paths) || inspection.paths.length === 0) {
    const fresh = await inspectRepo(inv.owner, inv.repo);
    inspection = { ...fresh };
    commitSha = fresh.sha;
  }

  const normalizedInsp = getInspectionData({ ...inv, inspectionJson: inspection, commitSha });
  const ecosystem = normalizedInsp?.ecosystem || "generic";
  const repoPaths = normalizedInsp?.paths ?? [];
  const manifest = normalizedInsp?.manifest ?? null;
  const evidence = getNormalizedEvidence(inv);

  const remediation: RemediationData = {
    status: "running",
    ecosystem,
    maxAttempts,
    currentAttempt: 0,
    patches: [],
    iterations: [],
    updatedAt: new Date().toISOString(),
  };

  await persistRemediation(investigationId, inspection, remediation, {
    commitSha,
    stage: "inspected",
  });

  let previousIteration: {
    command: string;
    exitCode: number;
    stdout: string;
    stderr: string;
    patches: RemediationIteration["patches"];
  } | null = null;

  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      remediation.currentAttempt = attempt;
      remediation.updatedAt = new Date().toISOString();
      await persistRemediation(investigationId, inspection, remediation);

      const proposed = await proposeFixIteration({
        owner: inv.owner,
        repo: inv.repo,
        commitSha,
        ecosystem,
        manifest,
        repoPaths,
        description: inv.description,
        expected: inv.expected,
        actual: inv.actual,
        steps: inv.steps,
        errorText: inv.errorText,
        summary: evidence.summary,
        evidenceItems: evidence.items,
        candidateAreas: evidence.candidateAreas,
        customInstruction: options.customInstruction,
        attempt,
        previousIteration,
      });

      remediation.diagnosis = proposed.diagnosis;
      remediation.fixSummary = proposed.fixSummary;
      remediation.verificationCommand = proposed.verificationCommand;
      remediation.patches = proposed.patches;
      remediation.updatedAt = new Date().toISOString();
      await persistRemediation(investigationId, inspection, remediation);

      const verifyRes = await verifyPatchInSandbox({
        jobId: `${investigationId}-attempt-${attempt}`,
        owner: inv.owner,
        repo: inv.repo,
        commitSha,
        ecosystem,
        manifest,
        command: proposed.verificationCommand,
        patches: proposed.patches,
      });

      const iteration: RemediationIteration = {
        attempt,
        timestamp: new Date().toISOString(),
        runtime: verifyRes.runtime,
        ...(verifyRes.dockerImage ? { dockerImage: verifyRes.dockerImage } : {}),
        command: verifyRes.command,
        exitCode: verifyRes.exitCode,
        outcome: verifyRes.outcome,
        durationMs: verifyRes.durationMs,
        stdout: verifyRes.stdout,
        stderr: verifyRes.stderr,
        summary: proposed.fixSummary,
        patches: proposed.patches,
      };

      remediation.iterations.push(iteration);
      remediation.updatedAt = new Date().toISOString();

      if (verifyRes.outcome === "passed" && verifyRes.exitCode === 0) {
        remediation.status = "succeeded";
        const prDraft = buildPullRequestDraft(
          inv.owner,
          inv.repo,
          investigationId,
          proposed.diagnosis,
          proposed.fixSummary,
          iteration
        );
        if (typeof inspection.defaultBranch === "string" && inspection.defaultBranch) {
          prDraft.baseBranch = inspection.defaultBranch;
        }
        remediation.pr = prDraft;
        await persistRemediation(investigationId, inspection, remediation, { stage: "ran" });

        // Persist Hypothesis, Run & Classification cleanly inside existing tables
        if (!useMemoryStore()) {
          const hyp = await withDbRetry(() =>
            prisma.hypothesis.create({
              data: {
                investigationId,
                statement: proposed.diagnosis,
                triggerConditions: proposed.fixSummary,
                expectedFailure: `Verify ${verifyRes.command} exits 0 after fix`,
                evidenceNeeded: `${verifyRes.runtime} execution exit 0`,
                tests: {
                  create: {
                    path: proposed.patches[0]?.path ?? "patch",
                    content: proposed.patches[0]?.content ?? "",
                    framework: ecosystem,
                  },
                },
              },
            })
          );
          await withDbRetry(() =>
            prisma.run.create({
              data: {
                hypothesisId: hyp.id,
                role: "target",
                revisionSha: commitSha,
                imageDigest: verifyRes.dockerImage ?? verifyRes.runtime,
                command: verifyRes.command,
                exitCode: verifyRes.exitCode,
                outcome: verifyRes.outcome,
                durationMs: verifyRes.durationMs,
                stdout: verifyRes.stdout,
                stderr: verifyRes.stderr,
                truncated: false,
              },
            })
          );
          await saveClassification(
            investigationId,
            "Reproduced",
            "FIX-VERIFIED",
            `Root cause diagnosed and verified cleanly via ${verifyRes.runtime} (${verifyRes.command} exited 0 on attempt ${attempt}). Ready for PR permission.`,
            "ran"
          );
        }
        return remediation;
      }

      previousIteration = {
        command: verifyRes.command,
        exitCode: verifyRes.exitCode,
        stdout: verifyRes.stdout,
        stderr: verifyRes.stderr,
        patches: proposed.patches,
      };
      await persistRemediation(investigationId, inspection, remediation);
    }

    remediation.status = "exhausted";
    remediation.error = `Verification did not pass after ${maxAttempts} attempt(s). Inspect the latest logs or provide a hint and retry.`;
    remediation.updatedAt = new Date().toISOString();
    await persistRemediation(investigationId, inspection, remediation, { stage: "hypothesized" });
    return remediation;
  } catch (err) {
    remediation.status = "failed";
    remediation.error = err instanceof Error ? err.message : "Remediation loop failed";
    remediation.updatedAt = new Date().toISOString();
    await persistRemediation(investigationId, inspection, remediation);
    throw err;
  }
}

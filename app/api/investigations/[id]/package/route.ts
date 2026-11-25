import { NextResponse } from "next/server";
import {
  getInvestigation,
  getLatestClassification,
  getLatestHypothesisAndTest,
  getNormalizedEvidence,
  getNormalizedRuns,
} from "@/lib/investigations";
import { authUser, owns } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { memoryStore, useMemoryStore } from "@/lib/store";

function md(inv: Record<string, unknown>): {
  markdown: string;
  summaryTitle: string;
  blockingUnknowns: number;
  readyToFile: boolean;
} {
  const get = (k: string) => String((inv[k] as string | undefined) ?? "");
  const evidence = getNormalizedEvidence(inv);
  const cls = getLatestClassification(inv);
  const hyp = getLatestHypothesisAndTest(inv);
  const runs = getNormalizedRuns(inv);

  const blockingUnknowns = evidence.questions.filter((q) => q.blocking).length;
  const readyToFile = blockingUnknowns === 0;
  const summary = evidence.summary || get("description");
  const statusLabel = cls?.status ?? get("status") ?? "pending";
  const statusHeading = cls?.rule ? `${statusLabel} (${cls.rule})` : statusLabel;

  const lines: string[] = [
    `# PatchSignal evidence package — ${get("id")}`,
    ``,
    ...(readyToFile
      ? []
      : [
          `> Not ready to file: ${blockingUnknowns} blocking unknown(s) remain. Resolve them before filing upstream.`,
          ``,
        ]),
    `## Summary`,
    `${summary}`,
    ``,
    `## Status: ${statusHeading}`,
    `${cls?.justification ?? ""}`,
    ``,
    `## Expected vs actual`,
    `- Expected: ${get("expected") || "(Unknown — ask reporter)"}`,
    `- Actual: ${get("actual") || "(see evidence)"}`,
    ``,
    `## Evidence`,
    ...(evidence.items.length
      ? evidence.items.map((item) => `- [${item.provenance}] (${item.source}) ${item.text}`)
      : [`- (no extracted evidence items)`]),
  ];

  if (evidence.questions.length) {
    lines.push(
      ``,
      `## Questions / Unknowns`,
      ...evidence.questions.map((q) => `- ${q.blocking ? "[BLOCKING] " : ""}${q.text}`)
    );
  }

  if (hyp) {
    lines.push(
      ``,
      `## Hypothesis & Candidate Test`,
      `- Statement: ${hyp.statement ?? "(none)"}`,
      `- Trigger: ${hyp.triggerConditions ?? "(unspecified)"}`,
      `- Expected failure: ${hyp.expectedFailure ?? "(unspecified)"}`,
      `- Candidate test path: ${hyp.path ?? "(none)"}`
    );
  }

  if (runs.length) {
    lines.push(
      ``,
      `## Execution Runs`,
      ...runs.map(
        (r) =>
          `- **${r.role}**: outcome=${r.outcome}, exitCode=${r.exitCode ?? "?"}, sha=${
            r.revisionSha ?? "unpinned"
          }, digest=${r.imageDigest || "none"}, cmd=${r.command ?? "vitest-json"}, durationMs=${
            r.durationMs ?? "?"
          }`
      )
    );
  }

  lines.push(
    ``,
    `## Revision`,
    `- repo: ${get("repoUrl")} @ ${get("commitSha") || "unpinned"}`,
    `- control: ${get("controlSha") || "none"}`,
    `- model: ${get("modelId") || "none"}`,
    ``,
    `> Not reproduced does not prove absence. Inconclusive means setup/timeout/unsupported — never file as proven.`,
    ``,
    `## Next steps`,
    `- Maintainer reviews, edits, then files manually via the prefilled link below.`
  );

  const summaryTitle = summary.replace(/\s+/g, " ").trim().slice(0, 80) || "bug report";
  return { markdown: lines.join("\n"), summaryTitle, blockingUnknowns, readyToFile };
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authUser(req);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const inv = (await getInvestigation(id)) as unknown as Record<string, unknown> | null;
  if (!inv || !owns(inv, auth.userId)) {
    return NextResponse.json({ error: "not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }

  if (inv.stage === "ran" || (inv.status !== "pending" && inv.stage !== "packaged")) {
    if (useMemoryStore()) {
      memoryStore.update(id, { stage: "packaged" });
    } else {
      await prisma.investigation.update({ where: { id }, data: { stage: "packaged" } });
    }
  }

  const { markdown, summaryTitle, blockingUnknowns, readyToFile } = md(inv);
  const title = encodeURIComponent(`[PatchSignal] ${summaryTitle}`);
  const body = encodeURIComponent(markdown.slice(0, 7000));
  const issueUrl = `https://github.com/${inv.owner}/${inv.repo}/issues/new?title=${title}&body=${body}`;
  const tooLong = markdown.length > 7000;
  return NextResponse.json(
    { markdown, issueUrl, copyToClipboard: tooLong, readyToFile, blockingUnknowns },
    { headers: { "Cache-Control": "no-store" } }
  );
}

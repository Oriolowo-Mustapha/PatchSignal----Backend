import { describe, expect, it } from "vitest";
import type { InvestigationSummary } from "./api-client";
import { computeDashboardMetrics } from "./dashboard-metrics";

function makeSummary(overrides: Partial<InvestigationSummary>): InvestigationSummary {
  return {
    id: "inv_1",
    repoUrl: "https://github.com/org/repo",
    owner: "org",
    repo: "repo",
    description: "bug",
    summary: null,
    stage: "intake",
    status: "pending",
    commitSha: null,
    modelId: null,
    createdAt: "2026-11-26T10:00:00.000Z",
    analysisJob: null,
    remediation: null,
    latestClassification: null,
    attachmentCount: 0,
    evidenceCount: 0,
    blockingUnknowns: 0,
    ...overrides,
  };
}

describe("computeDashboardMetrics", () => {
  it("handles an empty investigation queue with zero rates", () => {
    const m = computeDashboardMetrics([]);
    expect(m.total).toBe(0);
    expect(m.uniqueRepos).toBe(0);
    expect(m.verifiedRatePct).toBe(0);
    expect(m.stages).toHaveLength(6);
    expect(m.repositories).toEqual([]);
  });

  it("aggregates verdicts, PR CI states, needs-attention count, stages, and repo groupings", () => {
    const m = computeDashboardMetrics([
      makeSummary({
        id: "inv_a",
        owner: "Oriolowo-Mustapha",
        repo: "Team-HackForge",
        stage: "packaged",
        status: "Reproduced",
        remediation: { status: "succeeded", prNumber: 7, ciStatus: "passed" },
      }),
      makeSummary({
        id: "inv_b",
        owner: "Oriolowo-Mustapha",
        repo: "Team-HackForge",
        stage: "packaged",
        status: "Reproduced",
        remediation: { status: "succeeded", prNumber: 8, ciStatus: "failed" },
      }),
      makeSummary({
        id: "inv_c",
        owner: "meridian-dev",
        repo: "checkout-sdk",
        stage: "inspected",
        status: "Inconclusive",
      }),
      makeSummary({
        id: "inv_d",
        owner: "meridian-dev",
        repo: "checkout-sdk",
        stage: "ran",
        status: "Not_reproduced",
      }),
    ]);

    expect(m.total).toBe(4);
    expect(m.uniqueRepos).toBe(2);
    expect(m.reproducedCount).toBe(2);
    expect(m.notReproducedCount).toBe(1);
    expect(m.inconclusiveCount).toBe(1);
    expect(m.verifiedFixCount).toBe(2);
    expect(m.verifiedRatePct).toBe(50);
    expect(m.openPrCount).toBe(2);
    expect(m.ciPassingCount).toBe(1);
    expect(m.ciFailingCount).toBe(1);
    // inv_b has failed CI + inv_c is Inconclusive => 2 need attention
    expect(m.needsAttentionCount).toBe(2);

    const packagedStage = m.stages.find((s) => s.id === "packaged");
    expect(packagedStage?.count).toBe(2);
    expect(packagedStage?.sharePct).toBe(50);

    expect(m.repositories[0]).toMatchObject({
      fullName: "Oriolowo-Mustapha/Team-HackForge",
      total: 2,
      reproduced: 2,
      openPrs: 2,
      ciFailing: 1,
    });
  });
});

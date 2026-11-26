import type { InvestigationSummary } from "./api-client";

export type StageMetric = {
  id: string;
  label: string;
  count: number;
  sharePct: number;
};

export type VerdictSegment = {
  id: "Reproduced" | "Not_reproduced" | "Inconclusive" | "pending";
  label: string;
  count: number;
  sharePct: number;
  tone: "pos" | "warn" | "neg" | "neutral";
};

export type RepoMetric = {
  fullName: string;
  total: number;
  reproduced: number;
  openPrs: number;
  ciFailing: number;
  latestId: string;
};

export type DashboardMetrics = {
  total: number;
  uniqueRepos: number;
  reproducedCount: number;
  notReproducedCount: number;
  inconclusiveCount: number;
  pendingCount: number;
  verifiedFixCount: number;
  verifiedRatePct: number;
  openPrCount: number;
  ciPassingCount: number;
  ciFailingCount: number;
  ciPendingCount: number;
  needsAttentionCount: number;
  stages: StageMetric[];
  verdictSegments: VerdictSegment[];
  repositories: RepoMetric[];
};

const STAGE_ORDER: { id: string; label: string }[] = [
  { id: "intake", label: "Intake" },
  { id: "analyzed", label: "Analyzed" },
  { id: "inspected", label: "Inspected" },
  { id: "hypothesized", label: "Hypothesis" },
  { id: "ran", label: "Verified" },
  { id: "packaged", label: "Packaged" },
];

export function isInvestigationNeedingAttention(inv: InvestigationSummary): boolean {
  if (inv.status === "pending" || inv.status === "Inconclusive") return true;
  if (inv.analysisJob?.status === "failed") return true;
  if (inv.remediation?.ciStatus === "failed") return true;
  return false;
}

export function computeDashboardMetrics(investigations: InvestigationSummary[]): DashboardMetrics {
  const total = investigations.length;
  const pct = (n: number) => (total === 0 ? 0 : Math.round((n / total) * 100));

  let reproducedCount = 0;
  let notReproducedCount = 0;
  let inconclusiveCount = 0;
  let pendingCount = 0;
  let verifiedFixCount = 0;
  let openPrCount = 0;
  let ciPassingCount = 0;
  let ciFailingCount = 0;
  let ciPendingCount = 0;
  let needsAttentionCount = 0;

  const stageCounts = new Map<string, number>();
  for (const s of STAGE_ORDER) stageCounts.set(s.id, 0);

  const repoMap = new Map<string, RepoMetric>();

  for (const inv of investigations) {
    if (inv.status === "Reproduced") reproducedCount++;
    else if (inv.status === "Not_reproduced") notReproducedCount++;
    else if (inv.status === "Inconclusive") inconclusiveCount++;
    else pendingCount++;

    if (inv.status === "Reproduced" || inv.remediation?.status === "succeeded") {
      verifiedFixCount++;
    }

    if (inv.remediation?.prNumber || inv.remediation?.prUrl) {
      openPrCount++;
    }

    if (inv.remediation?.ciStatus === "passed") ciPassingCount++;
    else if (inv.remediation?.ciStatus === "failed") ciFailingCount++;
    else if (inv.remediation?.ciStatus === "pending") ciPendingCount++;

    if (isInvestigationNeedingAttention(inv)) {
      needsAttentionCount++;
    }

    const stageKey = stageCounts.has(inv.stage) ? inv.stage : "intake";
    stageCounts.set(stageKey, (stageCounts.get(stageKey) ?? 0) + 1);

    const fullName = `${inv.owner}/${inv.repo}`;
    const existingRepo = repoMap.get(fullName);
    const hasPr = Boolean(inv.remediation?.prNumber || inv.remediation?.prUrl);
    const isRepro = inv.status === "Reproduced" ? 1 : 0;
    const isCiFail = inv.remediation?.ciStatus === "failed" ? 1 : 0;

    if (!existingRepo) {
      repoMap.set(fullName, {
        fullName,
        total: 1,
        reproduced: isRepro,
        openPrs: hasPr ? 1 : 0,
        ciFailing: isCiFail,
        latestId: inv.id,
      });
    } else {
      existingRepo.total += 1;
      existingRepo.reproduced += isRepro;
      existingRepo.openPrs += hasPr ? 1 : 0;
      existingRepo.ciFailing += isCiFail;
    }
  }

  const stages: StageMetric[] = STAGE_ORDER.map((s) => {
    const count = stageCounts.get(s.id) ?? 0;
    return {
      id: s.id,
      label: s.label,
      count,
      sharePct: pct(count),
    };
  });

  const verdictSegments: VerdictSegment[] = [
    {
      id: "Reproduced",
      label: "Reproduced",
      count: reproducedCount,
      sharePct: pct(reproducedCount),
      tone: "pos",
    },
    {
      id: "Not_reproduced",
      label: "Not reproduced",
      count: notReproducedCount,
      sharePct: pct(notReproducedCount),
      tone: "warn",
    },
    {
      id: "Inconclusive",
      label: "Inconclusive",
      count: inconclusiveCount,
      sharePct: pct(inconclusiveCount),
      tone: "neg",
    },
    {
      id: "pending",
      label: "Pending",
      count: pendingCount,
      sharePct: pct(pendingCount),
      tone: "neutral",
    },
  ];

  const repositories = Array.from(repoMap.values()).sort(
    (a, b) => b.total - a.total || b.ciFailing - a.ciFailing || a.fullName.localeCompare(b.fullName)
  );

  return {
    total,
    uniqueRepos: repoMap.size,
    reproducedCount,
    notReproducedCount,
    inconclusiveCount,
    pendingCount,
    verifiedFixCount,
    verifiedRatePct: pct(verifiedFixCount),
    openPrCount,
    ciPassingCount,
    ciFailingCount,
    ciPendingCount,
    needsAttentionCount,
    stages,
    verdictSegments,
    repositories,
  };
}

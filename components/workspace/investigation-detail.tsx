"use client";

import * as React from "react";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  ExternalLink,
  GitPullRequest,
  Play,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import {
  apiClient,
  ApiRequestError,
  type AttachmentItem,
  type InvestigationDetailRecord,
  type PackageResult,
  type RemediationData,
} from "@/lib/ui/api-client";
import { CodeBlockTabs } from "@/components/ui/code-block-tabs";
import { DiffViewer, diffText } from "@/components/ui/diff-viewer";
import { ModalDialog } from "@/components/ui/modal-dialog";
import { PipelineStepper } from "@/components/ui/pipeline-stepper";
import { SlidingTabs } from "@/components/ui/sliding-tabs";
import { Terminal } from "@/components/ui/terminal";

type TabId = "evidence" | "repository" | "fix" | "hypothesis" | "runs" | "package";

const TABS: { id: TabId; label: string }[] = [
  { id: "evidence", label: "Evidence & questions" },
  { id: "repository", label: "Repository" },
  { id: "fix", label: "Fix & verify" },
  { id: "hypothesis", label: "Hypothesis & test" },
  { id: "runs", label: "Verification runs" },
  { id: "package", label: "Evidence package" },
];

const PIPELINE_STEPS = [
  { id: "intake", label: "Intake" },
  { id: "analyzed", label: "Analyzed" },
  { id: "inspected", label: "Inspected" },
  { id: "hypothesized", label: "Hypothesis & fix" },
  { id: "ran", label: "Verified" },
  { id: "packaged", label: "PR & package" },
];

const STAGE_TO_TAB: Record<string, TabId> = {
  intake: "evidence",
  analyzed: "evidence",
  inspected: "repository",
  hypothesized: "fix",
  ran: "fix",
  packaged: "fix",
};

function runtimeLabel(runtime: string) {
  if (runtime === "docker-container") return "Docker container";
  if (runtime === "remote-runner") return "Remote container runner";
  return "Isolated sandbox";
}

function buildUnifiedPatchDownload(remediation: RemediationData): string {
  return remediation.patches
    .map((p) => {
      const parsed = diffText(p.originalContent, p.content, { path: p.path });
      const header = `--- a/${p.path}\n+++ b/${p.path}`;
      const hunks = parsed.hunks
        .map((h) => {
          const head = `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`;
          const body = h.lines
            .map((l) => `${l.kind === "add" ? "+" : l.kind === "remove" ? "-" : " "}${l.text}`)
            .join("\n");
          return `${head}\n${body}`;
        })
        .join("\n");
      return `${header}\n${hunks}`;
    })
    .join("\n\n");
}

function normalizeEvidenceClient(inv: InvestigationDetailRecord) {
  const memEv = inv.evidence && !Array.isArray(inv.evidence) ? inv.evidence : null;
  const summary = inv.summary || memEv?.summary || "";
  const items = Array.isArray(inv.evidence)
    ? inv.evidence
    : Array.isArray(memEv?.evidence)
      ? memEv.evidence
      : [];
  const questions = Array.isArray(inv.questions)
    ? inv.questions
    : Array.isArray(memEv?.unknowns)
      ? memEv.unknowns.map((u) => ({ text: u.question, blocking: Boolean(u.blocking) }))
      : [];
  const candidateAreas = Array.isArray(inv.candidateAreas)
    ? inv.candidateAreas
    : Array.isArray(memEv?.candidateAreas)
      ? memEv.candidateAreas
      : [];
  return { summary, items, questions, candidateAreas };
}

function normalizeHypothesisClient(inv: InvestigationDetailRecord) {
  if (Array.isArray(inv.hypotheses) && inv.hypotheses.length > 0) {
    const h = inv.hypotheses[inv.hypotheses.length - 1];
    const t = h.tests && h.tests.length > 0 ? h.tests[h.tests.length - 1] : null;
    return {
      statement: h.statement,
      triggerConditions: h.triggerConditions,
      expectedFailure: h.expectedFailure,
      evidenceNeeded: h.evidenceNeeded,
      path: t?.path ?? "",
      content: t?.content ?? "",
    };
  }
  return inv.hypothesis ?? null;
}

function normalizeClassificationClient(inv: InvestigationDetailRecord) {
  if (Array.isArray(inv.classifications) && inv.classifications.length > 0) {
    return inv.classifications[inv.classifications.length - 1];
  }
  return inv.classification ?? null;
}

function normalizeRunsClient(inv: InvestigationDetailRecord) {
  if (Array.isArray(inv.hypotheses)) {
    const all = inv.hypotheses.flatMap((h) => h.runs ?? []);
    if (all.length > 0) return all;
  }
  const out: {
    role: string;
    outcome: string;
    exitCode?: number | null;
    durationMs?: number | null;
    stdout?: string | null;
    stderr?: string | null;
    imageDigest?: string | null;
    revisionSha?: string | null;
    command?: string;
  }[] = [];
  if (inv.runs?.target) out.push({ role: "target", ...inv.runs.target });
  if (inv.runs?.control) out.push({ role: "control", ...inv.runs.control });
  return out;
}

function statusPillClass(status: string) {
  if (status === "Reproduced") return "ws-pill ws-pill--pos";
  if (status === "Not_reproduced") return "ws-pill ws-pill--warn";
  if (status === "Inconclusive") return "ws-pill ws-pill--neg";
  return "ws-pill";
}

function provenancePillClass(prov: string) {
  if (prov === "observed") return "ws-pill ws-pill--pos";
  if (prov === "hypothesis") return "ws-pill ws-pill--warn";
  if (prov === "unknown") return "ws-pill ws-pill--neg";
  return "ws-pill";
}

type InvestigationDetailProps = {
  investigation: InvestigationDetailRecord;
  onRefresh: () => Promise<void>;
  onAuthExpired: () => void;
};

export function InvestigationDetail({
  investigation,
  onRefresh,
  onAuthExpired,
}: InvestigationDetailProps) {
  const [activeTab, setActiveTab] = React.useState<TabId>("evidence");
  const [artifactView, setArtifactView] = React.useState<"code" | "diff">("code");
  const [busyAction, setBusyAction] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [copiedSha, setCopiedSha] = React.useState(false);
  const [expandedReport, setExpandedReport] = React.useState(false);

  const [selectedAttachment, setSelectedAttachment] = React.useState<AttachmentItem | null>(null);
  const [fileQuery, setFileQuery] = React.useState("");

  // Auto-fix & container verification loop controls
  const [remedyHint, setRemedyHint] = React.useState("");
  const [remedyAttempts, setRemedyAttempts] = React.useState<number>(3);
  const [selectedPatchIndex, setSelectedPatchIndex] = React.useState(0);

  // Pull Request permission confirmation dialog state
  const [prModalOpen, setPrModalOpen] = React.useState(false);
  const [prTitleInput, setPrTitleInput] = React.useState("");
  const [prBodyInput, setPrBodyInput] = React.useState("");
  const [prBranchInput, setPrBranchInput] = React.useState("");
  const [prTokenInput, setPrTokenInput] = React.useState("");
  const [showPrTokenInput, setShowPrTokenInput] = React.useState(false);
  const [prError, setPrError] = React.useState<string | null>(null);

  const [hypStatement, setHypStatement] = React.useState("");
  const [hypTrigger, setHypTrigger] = React.useState("");
  const [hypExpected, setHypExpected] = React.useState("");
  const [hypTargetFile, setHypTargetFile] = React.useState("");

  const [runMode, setRunMode] = React.useState<"sandbox" | "manual">("sandbox");
  const [imageDigestInput, setImageDigestInput] = React.useState("");
  const [controlImageInput, setControlImageInput] = React.useState("");
  const [injectTargetOutcome, setInjectTargetOutcome] = React.useState<
    "failed" | "passed" | "error" | "timeout"
  >("failed");
  const [injectPredicted, setInjectPredicted] = React.useState(true);
  const [injectUnrelated, setInjectUnrelated] = React.useState(false);
  const [injectControlOutcome, setInjectControlOutcome] = React.useState<
    "none" | "passed" | "failed"
  >("passed");

  const [pkgData, setPkgData] = React.useState<PackageResult | null>(null);
  const [editableMarkdown, setEditableMarkdown] = React.useState("");
  const [copiedMd, setCopiedMd] = React.useState(false);

  const panelRefs = React.useRef<Record<TabId, HTMLDivElement | null>>({
    evidence: null,
    repository: null,
    fix: null,
    hypothesis: null,
    runs: null,
    package: null,
  });

  const inspection = investigation.inspectionJson ?? investigation.inspection ?? null;
  const remediation = inspection?.remediation ?? null;

  React.useEffect(() => {
    setExpandedReport(false);
    setActionError(null);
    setPkgData(null);
    setEditableMarkdown("");
    setHypStatement("");
    setHypTrigger("");
    setHypExpected("");
    setHypTargetFile("");
    setSelectedPatchIndex(0);
    setPrModalOpen(false);
    setPrError(null);
    setShowPrTokenInput(false);
  }, [investigation.id]);

  // Poll analysis job every 4s while queued/running
  const jobStatus = investigation.analysisJob?.status;
  React.useEffect(() => {
    if (jobStatus !== "queued" && jobStatus !== "running") return;
    const timer = window.setInterval(() => {
      void onRefresh();
    }, 4000);
    return () => window.clearInterval(timer);
  }, [investigation.id, jobStatus, onRefresh]);

  // Poll remediation loop every 2.5s while running live attempts
  const remStatus = remediation?.status;
  React.useEffect(() => {
    if (remStatus !== "running" && busyAction !== "remediate") return;
    const timer = window.setInterval(() => {
      void onRefresh();
    }, 2500);
    return () => window.clearInterval(timer);
  }, [investigation.id, remStatus, busyAction, onRefresh]);

  React.useEffect(() => {
    const listeners: Array<() => void> = [];
    for (const tab of TABS) {
      const panel = panelRefs.current[tab.id];
      if (!panel) continue;
      const handler = () => setActiveTab(tab.id);
      panel.addEventListener("beforematch", handler);
      listeners.push(() => panel.removeEventListener("beforematch", handler));
    }
    return () => {
      for (const cleanup of listeners) cleanup();
    };
  }, []);

  const evidence = normalizeEvidenceClient(investigation);
  const hypothesis = normalizeHypothesisClient(investigation);
  const classification = normalizeClassificationClient(investigation);
  const runs = normalizeRunsClient(investigation);
  const repoPaths = inspection?.paths ?? [];
  const filteredPaths = fileQuery.trim()
    ? repoPaths.filter((p) => p.toLowerCase().includes(fileQuery.trim().toLowerCase()))
    : repoPaths;

  const openPrApprovalModal = () => {
    setPrTitleInput(remediation?.pr?.title || `fix: resolve issue in ${investigation.owner}/${investigation.repo}`);
    setPrBodyInput(remediation?.pr?.body || "");
    setPrBranchInput(remediation?.pr?.branchName || `patchsignal/fix-${investigation.id.slice(0, 8)}`);
    setPrError(null);
    setPrModalOpen(true);
  };

  const runAction = async (label: string, fn: () => Promise<void>) => {
    setActionError(null);
    setBusyAction(label);
    try {
      await fn();
      await onRefresh();
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 401) {
        onAuthExpired();
        return;
      }
      setActionError(err instanceof Error ? err.message : `${label} failed`);
    } finally {
      setBusyAction(null);
    }
  };

  const handleAnalyze = () =>
    runAction("analyze", async () => {
      await apiClient.analyze(investigation.id);
      setActiveTab("evidence");
    });

  const handleInspect = () =>
    runAction("inspect", async () => {
      await apiClient.inspect(investigation.id);
      setActiveTab("repository");
    });

  const handleRemediate = () =>
    runAction("remediate", async () => {
      setActiveTab("fix");
      setSelectedPatchIndex(0);
      await apiClient.remediate(investigation.id, {
        maxAttempts: remedyAttempts,
        customInstruction: remedyHint.trim() || undefined,
      });
    });

  const handleConfirmCreatePr = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setPrError(null);
    setBusyAction("pr");
    try {
      await apiClient.createPullRequest(investigation.id, {
        approved: true,
        title: prTitleInput.trim(),
        body: prBodyInput.trim(),
        branchName: prBranchInput.trim(),
        baseBranch: inspection?.defaultBranch || remediation?.pr?.baseBranch || "main",
        githubToken: prTokenInput.trim() || undefined,
      });
      await onRefresh();
      setPrModalOpen(false);
      setActiveTab("fix");
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 401) {
        onAuthExpired();
        return;
      }
      if (err instanceof ApiRequestError && err.code === "GITHUB_WRITE_TOKEN_NEEDED") {
        setShowPrTokenInput(true);
      }
      setPrError(err instanceof Error ? err.message : "Failed to create Pull Request");
    } finally {
      setBusyAction(null);
    }
  };

  const handleHypothesize = () =>
    runAction("hypothesize", async () => {
      await apiClient.hypothesize(investigation.id, {
        statement: hypStatement.trim() || undefined,
        triggerConditions: hypTrigger.trim() || undefined,
        expectedFailure: hypExpected.trim() || undefined,
        targetFile: hypTargetFile.trim() || undefined,
      });
      setActiveTab("hypothesis");
    });

  const handleRun = () =>
    runAction("run", async () => {
      const payload =
        runMode === "sandbox"
          ? {
              image: imageDigestInput.trim(),
              ...(controlImageInput.trim() ? { controlImage: controlImageInput.trim() } : {}),
            }
          : {
              target: {
                role: "target",
                outcome: injectTargetOutcome,
                exitCode: injectTargetOutcome === "passed" ? 0 : 1,
                predictedAssertionFailed: injectTargetOutcome === "failed" ? injectPredicted : false,
                unrelatedFailure:
                  injectTargetOutcome === "error" ||
                  injectTargetOutcome === "timeout" ||
                  injectUnrelated,
              },
              ...(injectControlOutcome !== "none"
                ? {
                    control: {
                      role: "control",
                      outcome: injectControlOutcome,
                      exitCode: injectControlOutcome === "passed" ? 0 : 1,
                      predictedAssertionFailed: false,
                      unrelatedFailure: false,
                    },
                  }
                : {}),
            };
      await apiClient.runSandbox(investigation.id, payload);
      setActiveTab("runs");
    });

  const handleLoadPackage = () =>
    runAction("package", async () => {
      const data = await apiClient.getPackage(investigation.id);
      setPkgData(data);
      setEditableMarkdown(data.markdown);
      setActiveTab("package");
    });

  const primaryNextAction = () => {
    if (remediation?.pr?.status === "created" && remediation.pr.prUrl) {
      return {
        label: `View PR #${remediation.pr.prNumber ?? ""}`,
        disabled: false,
        onClick: () => setActiveTab("fix"),
      };
    }
    if (remediation?.status === "succeeded") {
      return {
        label: "Approve & create PR",
        disabled: busyAction !== null,
        onClick: openPrApprovalModal,
      };
    }
    if (investigation.stage === "intake") {
      const activeJob = jobStatus === "queued" || jobStatus === "running";
      return {
        label: activeJob
          ? "Analysis running…"
          : jobStatus === "failed"
            ? "Auto-fix & verify"
            : "Run analysis",
        disabled: activeJob || busyAction !== null,
        onClick: jobStatus === "failed" ? handleRemediate : handleAnalyze,
      };
    }
    return {
      label: busyAction === "remediate" ? "Running fix loop…" : "Diagnose, fix & verify",
      disabled: busyAction !== null,
      onClick: handleRemediate,
    };
  };

  const nextAct = primaryNextAction();
  const displayTitle = `${investigation.owner}/${investigation.repo}`;
  const reportText = (evidence.summary || investigation.description || "").trim();
  const isLongReport = reportText.length > 260 || reportText.includes("\n");
  const activePatch = remediation?.patches?.[selectedPatchIndex] ?? remediation?.patches?.[0] ?? null;

  return (
    <div className="ws-detail">
      <div className="ws-title-row">
        <div className="ws-title-main">
          <div className="ws-title-badges">
            <h1 className="ws-h1">{displayTitle}</h1>
            <span className={statusPillClass(investigation.status)}>
              {investigation.status.replace("_", " ")}
            </span>
            {investigation.commitSha ? (
              <span className="ws-sha-chip">
                <code className="mono">{investigation.commitSha.slice(0, 8)}</code>
                <button
                  type="button"
                  aria-label="Copy commit SHA"
                  className="ws-sha-copy"
                  onClick={() => {
                    navigator.clipboard?.writeText(investigation.commitSha || "").catch(() => {});
                    setCopiedSha(true);
                    window.setTimeout(() => setCopiedSha(false), 1200);
                  }}
                >
                  {copiedSha ? (
                    <Check size={14} strokeWidth={1.5} aria-hidden="true" />
                  ) : (
                    <Copy size={14} strokeWidth={1.5} aria-hidden="true" />
                  )}
                </button>
              </span>
            ) : null}
          </div>

          {!expandedReport ? (
            <p className={isLongReport ? "ws-sub ws-sub--clamped" : "ws-sub"}>{reportText}</p>
          ) : (
            <div className="ws-report-scroll" tabIndex={0} role="region" aria-label="Full bug report">
              {reportText}
            </div>
          )}

          {isLongReport ? (
            <button
              type="button"
              className="ws-report-toggle"
              aria-expanded={expandedReport}
              onClick={() => setExpandedReport((v) => !v)}
            >
              {expandedReport ? (
                <>
                  <span>Show less</span>
                  <ChevronUp size={16} strokeWidth={1.5} aria-hidden="true" />
                </>
              ) : (
                <>
                  <span>Show more</span>
                  <ChevronDown size={16} strokeWidth={1.5} aria-hidden="true" />
                </>
              )}
            </button>
          ) : null}
        </div>

        <div className="ws-title-actions">
          <button
            type="button"
            className="ws-btn"
            onClick={() => void onRefresh()}
            disabled={busyAction !== null}
            aria-label="Refresh investigation"
          >
            <RefreshCw size={15} strokeWidth={1.5} aria-hidden="true" />
            <span>Refresh</span>
          </button>
          <button
            type="button"
            className="ws-btn ws-btn--primary"
            disabled={nextAct.disabled}
            onClick={nextAct.onClick}
          >
            {nextAct.label}
          </button>
        </div>
      </div>

      {/* Interactive 6-Stage Connected Stepper */}
      <div style={{ marginBottom: 16 }}>
        <PipelineStepper
          steps={PIPELINE_STEPS}
          currentStepId={investigation.stage}
          onSelectStep={(stageId) => {
            const target = STAGE_TO_TAB[stageId];
            if (target) setActiveTab(target);
          }}
        />
      </div>

      {actionError ? (
        <div className="ws-notice ws-notice--neg" role="alert" style={{ marginBottom: 16 }}>
          {actionError}
        </div>
      ) : null}

      {/* Animated Sliding Underline Workflow Tabs */}
      <div className="ws-tabs-wrap">
        <SlidingTabs
          ariaLabel="Investigation workflow stages"
          mode="tablist"
          variant="underline"
          tabIdPrefix="tab"
          value={activeTab}
          onChange={setActiveTab}
          items={TABS}
        />
      </div>

      {/* Panel 1: Evidence & Questions */}
      <div
        ref={(el) => {
          panelRefs.current.evidence = el;
        }}
        role="tabpanel"
        aria-labelledby="tab-evidence"
        tabIndex={activeTab === "evidence" ? 0 : undefined}
        {...(activeTab !== "evidence" ? ({ hidden: "until-found" } as Record<string, string>) : {})}
      >
        <div className="ws-panel-inner">
          <div className="ws-panel">
            <div className="ws-panel__head">
              <h2 className="ws-panel__title">Automated analysis</h2>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {investigation.analysisJob ? (
                  <span
                    className={
                      investigation.analysisJob.status === "completed"
                        ? "ws-pill ws-pill--pos"
                        : investigation.analysisJob.status === "failed"
                          ? "ws-pill ws-pill--neg"
                          : "ws-pill ws-pill--warn"
                    }
                  >
                    Job {investigation.analysisJob.status}
                  </span>
                ) : (
                  <span className="ws-pill">Not queued</span>
                )}
                <button
                  type="button"
                  className="ws-btn"
                  disabled={
                    busyAction !== null ||
                    jobStatus === "queued" ||
                    jobStatus === "running" ||
                    investigation.stage !== "intake"
                  }
                  onClick={handleAnalyze}
                >
                  {jobStatus === "failed" ? "Retry analysis" : "Run analysis"}
                </button>
              </div>
            </div>

            {investigation.analysisJob?.status === "failed" && investigation.analysisJob.error ? (
              <div className="ws-notice ws-notice--neg" role="alert">
                {investigation.analysisJob.error}
              </div>
            ) : jobStatus === "queued" || jobStatus === "running" ? (
              <div className="ws-notice">
                Analysis is {jobStatus}. Checking every 4 seconds until structured evidence commits.
              </div>
            ) : (
              <p style={{ fontSize: 13, color: "var(--app-muted)" }}>
                Screenshots and report notes are analyzed to separate directly observed facts from open questions.
              </p>
            )}
          </div>

          {investigation.attachments && investigation.attachments.length > 0 ? (
            <div className="ws-panel">
              <div className="ws-panel__head">
                <h2 className="ws-panel__title">Screenshots ({investigation.attachments.length})</h2>
              </div>
              <div className="ws-thumbs">
                {investigation.attachments.map((att, idx) => (
                  <button
                    key={att.publicId}
                    type="button"
                    className="ws-thumb-btn"
                    onClick={() => setSelectedAttachment(att)}
                    aria-label={`Open screenshot ${idx + 1} preview`}
                  >
                    {att.secureUrl ? (
                      <img src={att.secureUrl} alt={`Bug report screenshot ${idx + 1}`} />
                    ) : (
                      <div
                        style={{
                          width: 144,
                          height: 96,
                          display: "grid",
                          placeItems: "center",
                          fontSize: 12,
                        }}
                      >
                        Screenshot {idx + 1}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="ws-table-region" tabIndex={0} role="region" aria-labelledby="ev-table-cap">
            <table className="ws-table">
              <caption id="ev-table-cap">Extracted evidence ({evidence.items.length})</caption>
              <thead>
                <tr>
                  <th scope="col">Claim / observation</th>
                  <th scope="col">Provenance</th>
                  <th scope="col">Source</th>
                </tr>
              </thead>
              <tbody>
                {evidence.items.length === 0 ? (
                  <tr>
                    <td colSpan={3} style={{ color: "var(--app-muted)" }}>
                      No extracted evidence yet. Run analysis above or click Diagnose, fix & verify.
                    </td>
                  </tr>
                ) : (
                  evidence.items.map((item, idx) => (
                    <tr key={`${item.source}-${idx}`}>
                      <td data-label="Claim">{item.text}</td>
                      <td data-label="Provenance">
                        <span className={provenancePillClass(item.provenance)}>{item.provenance}</span>
                      </td>
                      <td data-label="Source">
                        <code className="mono">{item.source}</code>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="ws-panel">
            <div className="ws-panel__head">
              <h2 className="ws-panel__title">
                Unknowns & follow-up questions ({evidence.questions.length})
              </h2>
            </div>
            {evidence.questions.length === 0 ? (
              <p style={{ fontSize: 13, color: "var(--app-muted)" }}>No open questions recorded.</p>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 8 }}>
                {evidence.questions.map((q, idx) => (
                  <li key={idx}>
                    {q.blocking ? (
                      <span className="ws-pill ws-pill--neg" style={{ marginRight: 8 }}>
                        Blocking
                      </span>
                    ) : null}
                    <span>{q.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* Panel 2: Repository */}
      <div
        ref={(el) => {
          panelRefs.current.repository = el;
        }}
        role="tabpanel"
        aria-labelledby="tab-repository"
        tabIndex={activeTab === "repository" ? 0 : undefined}
        {...(activeTab !== "repository" ? ({ hidden: "until-found" } as Record<string, string>) : {})}
      >
        <div className="ws-panel-inner">
          <div className="ws-panel">
            <div className="ws-panel__head">
              <h2 className="ws-panel__title">Pinned repository inspection</h2>
              <button
                type="button"
                className="ws-btn ws-btn--primary"
                disabled={busyAction !== null}
                onClick={handleInspect}
              >
                {busyAction === "inspect" ? "Inspecting…" : "Inspect repository"}
              </button>
            </div>

            {inspection?.ecosystem === "unsupported" ? (
              <div className="ws-notice ws-notice--neg" style={{ marginBottom: 14 }}>
                This repository returned no inspectable files. Verdict recorded as{" "}
                <strong>Inconclusive</strong>.
              </div>
            ) : null}

            <div className="ws-grid-2">
              <div>
                <div style={{ fontSize: 12, color: "var(--app-muted)" }}>Default branch</div>
                <div>{inspection?.defaultBranch || "—"}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: "var(--app-muted)" }}>Ecosystem</div>
                <div>{inspection?.ecosystem || "Not inspected"}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: "var(--app-muted)" }}>Target commit SHA</div>
                <div className="mono num" style={{ fontSize: 12 }}>
                  {investigation.commitSha || inspection?.sha || "—"}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: "var(--app-muted)" }}>Manifest</div>
                <div className="mono" style={{ fontSize: 12 }}>
                  {inspection?.manifest || "—"}
                </div>
              </div>
            </div>
          </div>

          {repoPaths.length > 0 ? (
            <div className="ws-panel">
              <div className="ws-panel__head">
                <h2 className="ws-panel__title">
                  Inspected tree ({filteredPaths.length} of {repoPaths.length})
                </h2>
                <input
                  type="search"
                  aria-label="Filter repository paths"
                  className="ps-input"
                  style={{ width: 240, minHeight: 32 }}
                  placeholder="Filter file paths…"
                  value={fileQuery}
                  onChange={(e) => setFileQuery(e.target.value)}
                />
              </div>
              <pre className="ws-code-block" style={{ maxHeight: 260 }}>
                {filteredPaths.slice(0, 200).join("\n")}
              </pre>
            </div>
          ) : null}
        </div>
      </div>

      {/* Panel 3: Automated Fix, Container Loop & PR Permission */}
      <div
        ref={(el) => {
          panelRefs.current.fix = el;
        }}
        role="tabpanel"
        aria-labelledby="tab-fix"
        tabIndex={activeTab === "fix" ? 0 : undefined}
        {...(activeTab !== "fix" ? ({ hidden: "until-found" } as Record<string, string>) : {})}
      >
        <div className="ws-panel-inner">
          {/* Launcher & Hint Controls */}
          <div className="ws-panel" style={{ display: "grid", gap: 14 }}>
            <div className="ws-panel__head" style={{ marginBottom: 0 }}>
              <div>
                <h2 className="ws-panel__title">Automated diagnosis, fix & container verification loop</h2>
                <p style={{ fontSize: 13, color: "var(--ink-secondary)", marginTop: 4 }}>
                  Identifies the root cause, patches the affected files, and runs builds/tests in an isolated container or sandbox until exit 0.
                </p>
              </div>
              {remediation ? (
                <span
                  className={
                    remediation.status === "succeeded"
                      ? "ws-pill ws-pill--pos"
                      : remediation.status === "running"
                        ? "ws-pill ws-pill--warn"
                        : remediation.status === "exhausted" || remediation.status === "failed"
                          ? "ws-pill ws-pill--neg"
                          : "ws-pill"
                  }
                >
                  {remediation.status === "running"
                    ? `Running attempt ${remediation.currentAttempt}/${remediation.maxAttempts}`
                    : remediation.status === "succeeded"
                      ? "Verified fix (exit 0)"
                      : remediation.status}
                </span>
              ) : null}
            </div>

            <div className="ws-remedy-controls">
              <div className="ps-field" style={{ flex: "1 1 280px" }}>
                <label htmlFor="remedy-hint">Optional maintainer guidance</label>
                <input
                  id="remedy-hint"
                  type="text"
                  className="ps-input"
                  value={remedyHint}
                  onChange={(e) => setRemedyHint(e.target.value)}
                  placeholder="Optional hint (e.g., focus on ConfigurationValidator.cs)"
                />
              </div>

              <div className="ps-field" style={{ width: 140 }}>
                <label htmlFor="remedy-attempts">Max retries</label>
                <select
                  id="remedy-attempts"
                  className="ps-select"
                  value={remedyAttempts}
                  onChange={(e) => setRemedyAttempts(Number(e.target.value))}
                >
                  <option value={1}>1 attempt</option>
                  <option value={3}>Up to 3</option>
                  <option value={5}>Up to 5</option>
                </select>
              </div>

              <button
                type="button"
                className="ws-btn ws-btn--primary"
                style={{ alignSelf: "end", height: 40 }}
                disabled={busyAction !== null}
                onClick={handleRemediate}
              >
                <Play size={14} strokeWidth={1.75} aria-hidden="true" />
                <span>
                  {busyAction === "remediate" || remediation?.status === "running"
                    ? "Running loop…"
                    : remediation
                      ? "Re-run auto-fix loop"
                      : "Diagnose, fix & verify"}
                </span>
              </button>
            </div>

            {remediation?.error ? (
              <div className="ws-notice ws-notice--neg" role="alert">
                {remediation.error}
              </div>
            ) : null}
          </div>

          {/* Explicit Permission Card or Created PR Status */}
          {remediation?.pr?.status === "created" && remediation.pr.prUrl ? (
            <div className="ws-panel ws-pr-banner is-created">
              <div className="ws-pr-banner__left">
                <div className="ws-pr-banner__title">
                  <GitPullRequest size={16} strokeWidth={1.75} aria-hidden="true" />
                  <span>Pull Request #{remediation.pr.prNumber} created</span>
                </div>
                <p className="ws-pr-banner__sub">
                  Branch <code className="mono">{remediation.pr.branchName}</code> targeting{" "}
                  <code className="mono">{remediation.pr.baseBranch}</code> is ready for merge on GitHub.
                </p>
              </div>
              <a
                href={remediation.pr.prUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="ws-btn ws-btn--primary"
              >
                <span>Open PR #{remediation.pr.prNumber}</span>
                <ExternalLink size={14} strokeWidth={1.75} aria-hidden="true" />
              </a>
            </div>
          ) : remediation?.status === "succeeded" ? (
            <div className="ws-panel ws-pr-banner is-ready">
              <div className="ws-pr-banner__left">
                <div className="ws-pr-banner__title">
                  <ShieldCheck size={16} strokeWidth={1.75} aria-hidden="true" />
                  <span>Fix verified — permission required to open Pull Request</span>
                </div>
                <p className="ws-pr-banner__sub">
                  All verification checks exited cleanly (<code>exit 0</code>). Approve creation of branch{" "}
                  <code className="mono">{remediation.pr?.branchName}</code> and Pull Request for merge into{" "}
                  <code className="mono">{remediation.pr?.baseBranch || "main"}</code>.
                </p>
              </div>
              <button
                type="button"
                className="ws-btn ws-btn--primary"
                onClick={openPrApprovalModal}
              >
                <GitPullRequest size={14} strokeWidth={1.75} aria-hidden="true" />
                <span>Review & approve PR</span>
              </button>
            </div>
          ) : null}

          {/* Root Cause Diagnosis + Multi-File DiffViewer */}
          {remediation?.diagnosis ? (
            <div className="ws-panel" style={{ display: "grid", gap: 14 }}>
              <div className="ws-panel__head" style={{ marginBottom: 0 }}>
                <h3 className="ws-panel__title">Root-cause diagnosis & suggested fix</h3>
                {remediation.patches.length > 0 ? (
                  <button
                    type="button"
                    className="ws-btn"
                    onClick={() => {
                      const patchText = buildUnifiedPatchDownload(remediation);
                      const blob = new Blob([patchText], { type: "text/x-diff;charset=utf-8" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `patchsignal-${investigation.id.slice(0, 8)}.patch`;
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                  >
                    <Download size={14} strokeWidth={1.5} aria-hidden="true" />
                    <span>Download .patch</span>
                  </button>
                ) : null}
              </div>

              <div className="ws-notice">
                <div>
                  <strong>Diagnosis:</strong> {remediation.diagnosis}
                </div>
                {remediation.fixSummary ? (
                  <div style={{ marginTop: 6 }}>
                    <strong>Proposed fix:</strong> {remediation.fixSummary}
                  </div>
                ) : null}
              </div>

              {remediation.patches.length > 1 ? (
                <div className="ws-patch-tabs" role="group" aria-label="Patched files">
                  {remediation.patches.map((p, idx) => (
                    <button
                      key={p.path}
                      type="button"
                      className="ws-patch-tab mono"
                      aria-pressed={selectedPatchIndex === idx}
                      onClick={() => setSelectedPatchIndex(idx)}
                    >
                      {p.path}
                    </button>
                  ))}
                </div>
              ) : null}

              {activePatch ? (
                <DiffViewer
                  path={activePatch.path}
                  oldText={activePatch.originalContent}
                  newText={activePatch.content}
                  defaultView="unified"
                  statusLabel={activePatch.explanation}
                  maxHeight={380}
                />
              ) : null}
            </div>
          ) : null}

          {/* Iterative Container / Sandbox Verification History */}
          {remediation && remediation.iterations.length > 0 ? (
            <div className="ws-panel" style={{ display: "grid", gap: 14 }}>
              <h3 className="ws-panel__title">
                Verification loop iterations ({remediation.iterations.length})
              </h3>
              <div style={{ display: "grid", gap: 14 }}>
                {remediation.iterations.map((iter) => (
                  <div key={iter.attempt} className="ws-iter-card">
                    <div className="ws-iter-card__head">
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span className="ws-pill num">{`Attempt ${iter.attempt}`}</span>
                        <span className="ws-pill">{runtimeLabel(iter.runtime)}</span>
                        {iter.dockerImage ? (
                          <code className="mono" style={{ fontSize: 11, color: "var(--ink-muted)" }}>
                            {iter.dockerImage}
                          </code>
                        ) : null}
                      </div>
                      <span
                        className={
                          iter.outcome === "passed"
                            ? "ws-pill ws-pill--pos"
                            : "ws-pill ws-pill--neg"
                        }
                      >
                        {`${iter.outcome} · exit ${iter.exitCode}`}
                      </span>
                    </div>
                    <Terminal
                      title={iter.summary}
                      command={iter.command}
                      text={[iter.stdout, iter.stderr ? `\n[stderr]\n${iter.stderr}` : ""]
                        .filter(Boolean)
                        .join("\n") || "(no command output)"}
                      exitCode={iter.exitCode}
                      durationMs={iter.durationMs}
                      maxHeight={220}
                    />
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Panel 4: Hypothesis & Test */}
      <div
        ref={(el) => {
          panelRefs.current.hypothesis = el;
        }}
        role="tabpanel"
        aria-labelledby="tab-hypothesis"
        tabIndex={activeTab === "hypothesis" ? 0 : undefined}
        {...(activeTab !== "hypothesis" ? ({ hidden: "until-found" } as Record<string, string>) : {})}
      >
        <div className="ws-panel-inner">
          <div className="ws-panel">
            <div className="ws-panel__head">
              <h2 className="ws-panel__title">Root-cause hypothesis & reproduction test</h2>
              <button
                type="button"
                className="ws-btn ws-btn--primary"
                disabled={busyAction !== null || inspection?.ecosystem === "unsupported"}
                onClick={handleHypothesize}
              >
                {busyAction === "hypothesize" ? "Generating…" : "Generate hypothesis"}
              </button>
            </div>

            <div className="ws-grid-2">
              <div className="ps-field">
                <label htmlFor="hyp-statement">Optional statement override</label>
                <input
                  id="hyp-statement"
                  type="text"
                  className="ps-input"
                  value={hypStatement}
                  onChange={(e) => setHypStatement(e.target.value)}
                  placeholder="Leave blank to derive from evidence & source files"
                />
              </div>
              <div className="ps-field">
                <label htmlFor="hyp-target">Optional target file path</label>
                <input
                  id="hyp-target"
                  type="text"
                  className="ps-input mono"
                  value={hypTargetFile}
                  onChange={(e) => setHypTargetFile(e.target.value)}
                  placeholder="src/validation/email.ts"
                />
              </div>
              <div className="ps-field">
                <label htmlFor="hyp-trigger">Trigger conditions</label>
                <input
                  id="hyp-trigger"
                  type="text"
                  className="ps-input"
                  value={hypTrigger}
                  onChange={(e) => setHypTrigger(e.target.value)}
                />
              </div>
              <div className="ps-field">
                <label htmlFor="hyp-expected">Expected assertion failure</label>
                <input
                  id="hyp-expected"
                  type="text"
                  className="ps-input"
                  value={hypExpected}
                  onChange={(e) => setHypExpected(e.target.value)}
                />
              </div>
            </div>
          </div>

          {hypothesis ? (
            <div className="ws-panel" style={{ display: "grid", gap: 14 }}>
              <div className="ws-panel__head" style={{ marginBottom: 0 }}>
                <div>
                  <h3 className="ws-panel__title">Generated test artifact</h3>
                  <code className="mono" style={{ fontSize: 12, color: "var(--app-muted)" }}>
                    {hypothesis.path || "tests/patchsignal/reproduction.test.ts"}
                  </code>
                </div>
                <SlidingTabs
                  ariaLabel="Artifact inspection view"
                  mode="group"
                  variant="pill"
                  value={artifactView}
                  onChange={setArtifactView}
                  items={[
                    { id: "code", label: "Source view" },
                    { id: "diff", label: "Diff view" },
                  ]}
                />
              </div>

              <div className="ws-notice">
                <div>
                  <strong>Hypothesis:</strong> {hypothesis.statement}
                </div>
                <div style={{ marginTop: 4, fontSize: 12, color: "var(--app-muted)" }}>
                  <strong>Trigger:</strong> {hypothesis.triggerConditions} ·{" "}
                  <strong>Expected failure:</strong> {hypothesis.expectedFailure}
                </div>
              </div>

              {artifactView === "code" ? (
                <CodeBlockTabs
                  title={hypothesis.path || "tests/patchsignal/reproduction.test.ts"}
                  maxHeight={340}
                  tabs={[
                    {
                      id: "repro",
                      label: "Test artifact",
                      code: hypothesis.content,
                    },
                  ]}
                />
              ) : (
                <DiffViewer
                  path={hypothesis.path || "tests/patchsignal/reproduction.test.ts"}
                  oldText=""
                  newText={hypothesis.content}
                  defaultView="unified"
                  statusLabel="New reproduction file"
                  maxHeight={340}
                />
              )}
            </div>
          ) : (
            <div className="ws-notice">
              No hypothesis generated yet. Use Fix & verify for full automated patching or generate a standalone test above.
            </div>
          )}
        </div>
      </div>

      {/* Panel 5: Verification Runs */}
      <div
        ref={(el) => {
          panelRefs.current.runs = el;
        }}
        role="tabpanel"
        aria-labelledby="tab-runs"
        tabIndex={activeTab === "runs" ? 0 : undefined}
        {...(activeTab !== "runs" ? ({ hidden: "until-found" } as Record<string, string>) : {})}
      >
        <div className="ws-panel-inner">
          <div className="ws-panel" style={{ display: "grid", gap: 16 }}>
            <div className="ws-panel__head" style={{ marginBottom: 0 }}>
              <h2 className="ws-panel__title">Verification run dispatch</h2>
              <SlidingTabs
                ariaLabel="Runner execution mode"
                mode="group"
                variant="pill"
                value={runMode}
                onChange={setRunMode}
                items={[
                  { id: "sandbox", label: "Automated runner" },
                  { id: "manual", label: "Manual outcome" },
                ]}
              />
            </div>

            {runMode === "sandbox" ? (
              <div className="ws-grid-2">
                <div className="ps-field">
                  <label htmlFor="run-image">Target build reference</label>
                  <input
                    id="run-image"
                    type="text"
                    className="ps-input mono"
                    placeholder="target-build@sha256:..."
                    value={imageDigestInput}
                    onChange={(e) => setImageDigestInput(e.target.value)}
                  />
                </div>
                <div className="ps-field">
                  <label htmlFor="run-control-image">Baseline build reference (optional)</label>
                  <input
                    id="run-control-image"
                    type="text"
                    className="ps-input mono"
                    placeholder="baseline-build@sha256:..."
                    value={controlImageInput}
                    onChange={(e) => setControlImageInput(e.target.value)}
                  />
                </div>
              </div>
            ) : (
              <div style={{ display: "grid", gap: 12 }}>
                <div className="ws-notice ws-notice--warn">
                  Manual mode records an observed verification outcome when no automated runner is connected to this environment.
                </div>
                <div className="ws-grid-2">
                  <div className="ps-field">
                    <label htmlFor="inj-target-outcome">Target outcome</label>
                    <select
                      id="inj-target-outcome"
                      className="ps-select"
                      value={injectTargetOutcome}
                      onChange={(e) =>
                        setInjectTargetOutcome(e.target.value as typeof injectTargetOutcome)
                      }
                    >
                      <option value="failed">failed</option>
                      <option value="passed">passed</option>
                      <option value="error">error</option>
                      <option value="timeout">timeout</option>
                    </select>
                  </div>
                  <div className="ps-field">
                    <label htmlFor="inj-control-outcome">Baseline outcome</label>
                    <select
                      id="inj-control-outcome"
                      className="ps-select"
                      value={injectControlOutcome}
                      onChange={(e) =>
                        setInjectControlOutcome(e.target.value as typeof injectControlOutcome)
                      }
                    >
                      <option value="passed">passed</option>
                      <option value="failed">failed</option>
                      <option value="none">none (no baseline)</option>
                    </select>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
                  <label className="ws-checkbox-row">
                    <input
                      type="checkbox"
                      className="ps-checkbox"
                      checked={injectPredicted}
                      onChange={(e) => setInjectPredicted(e.target.checked)}
                    />
                    <span>Predicted assertion failed</span>
                  </label>
                  <label className="ws-checkbox-row">
                    <input
                      type="checkbox"
                      className="ps-checkbox"
                      checked={injectUnrelated}
                      onChange={(e) => setInjectUnrelated(e.target.checked)}
                    />
                    <span>Unrelated or setup failure</span>
                  </label>
                </div>
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                type="button"
                className="ws-btn ws-btn--primary"
                disabled={busyAction !== null || (runMode === "sandbox" && !imageDigestInput.trim())}
                onClick={handleRun}
              >
                {busyAction === "run" ? "Running verification…" : "Execute run & classify"}
              </button>
            </div>
          </div>

          {classification ? (
            <div className="ws-panel">
              <div className="ws-panel__head">
                <h2 className="ws-panel__title">Verification verdict</h2>
                <span className={statusPillClass(classification.status)}>
                  {classification.status.replace("_", " ")}
                </span>
              </div>
              <p>{classification.justification}</p>
            </div>
          ) : null}

          {runs.map((run, idx) => (
            <Terminal
              key={`${run.role}-${idx}`}
              title={`${run.role} run (${run.outcome})`}
              command={run.command || "patchsignal verify --run"}
              text={[run.stdout || "", run.stderr ? `\n[stderr]\n${run.stderr}` : ""]
                .filter(Boolean)
                .join("\n")}
              exitCode={run.exitCode ?? null}
              durationMs={run.durationMs ?? null}
            />
          ))}
        </div>
      </div>

      {/* Panel 6: Evidence Package */}
      <div
        ref={(el) => {
          panelRefs.current.package = el;
        }}
        role="tabpanel"
        aria-labelledby="tab-package"
        tabIndex={activeTab === "package" ? 0 : undefined}
        {...(activeTab !== "package" ? ({ hidden: "until-found" } as Record<string, string>) : {})}
      >
        <div className="ws-panel-inner">
          <div className="ws-panel" style={{ display: "grid", gap: 14 }}>
            <div className="ws-panel__head" style={{ marginBottom: 0 }}>
              <h2 className="ws-panel__title">Evidence package</h2>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="ws-btn"
                  disabled={busyAction !== null}
                  onClick={handleLoadPackage}
                >
                  {busyAction === "package"
                    ? "Building…"
                    : pkgData
                      ? "Rebuild package"
                      : "Build package"}
                </button>
                {pkgData ? (
                  <button
                    type="button"
                    className="ws-btn"
                    onClick={() => {
                      navigator.clipboard?.writeText(editableMarkdown).catch(() => {});
                      setCopiedMd(true);
                      window.setTimeout(() => setCopiedMd(false), 1400);
                    }}
                  >
                    {copiedMd ? (
                      <Check size={15} strokeWidth={1.5} aria-hidden="true" />
                    ) : (
                      <Copy size={15} strokeWidth={1.5} aria-hidden="true" />
                    )}
                    <span>{copiedMd ? "Copied" : "Copy markdown"}</span>
                  </button>
                ) : null}
                {pkgData ? (
                  <a
                    href={pkgData.issueUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ws-btn ws-btn--primary"
                  >
                    <span>Open issue draft</span>
                    <ExternalLink size={15} strokeWidth={1.5} aria-hidden="true" />
                  </a>
                ) : null}
              </div>
            </div>

            {pkgData?.readyToFile === false ? (
              <div className="ws-notice ws-notice--warn" role="alert">
                Not ready to file: {pkgData.blockingUnknowns} blocking unknown(s) remain. Review and answer before opening upstream.
              </div>
            ) : null}

            {pkgData?.copyToClipboard ? (
              <div className="ws-notice">
                The package exceeds GitHub URL length limits. Copy the markdown below and paste it into the issue form.
              </div>
            ) : null}

            {pkgData ? (
              <div className="ps-field">
                <label htmlFor="pkg-markdown">Editable markdown report</label>
                <textarea
                  id="pkg-markdown"
                  className="ps-textarea mono"
                  style={{ minHeight: 340, fontSize: 12 }}
                  value={editableMarkdown}
                  onChange={(e) => setEditableMarkdown(e.target.value)}
                />
              </div>
            ) : (
              <div className="ws-notice">
                Click <strong>Build package</strong> to compile the latest evidence, runs, and prefilled GitHub issue URL.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Explicit PR Permission & Creation Confirmation Modal */}
      <ModalDialog
        open={prModalOpen}
        title="Approve Pull Request creation"
        onClose={() => setPrModalOpen(false)}
      >
        <form onSubmit={handleConfirmCreatePr} style={{ display: "grid", gap: 14 }}>
          <div className="ws-notice">
            You are granting permission for PatchSignal to commit the verified patch files to branch{" "}
            <code className="mono">{prBranchInput}</code> on{" "}
            <code className="mono">{`${investigation.owner}/${investigation.repo}`}</code> and open a Pull Request against{" "}
            <code className="mono">{inspection?.defaultBranch || "main"}</code>.
          </div>

          <div className="ws-grid-2">
            <div className="ps-field">
              <label htmlFor="pr-branch">Branch name</label>
              <input
                id="pr-branch"
                type="text"
                required
                className="ps-input mono"
                value={prBranchInput}
                onChange={(e) => setPrBranchInput(e.target.value)}
              />
            </div>
            <div className="ps-field">
              <label htmlFor="pr-title">Pull Request title</label>
              <input
                id="pr-title"
                type="text"
                required
                className="ps-input"
                value={prTitleInput}
                onChange={(e) => setPrTitleInput(e.target.value)}
              />
            </div>
          </div>

          <div className="ps-field">
            <label htmlFor="pr-body">Pull Request description</label>
            <textarea
              id="pr-body"
              className="ps-textarea mono"
              style={{ minHeight: 150, fontSize: 12 }}
              value={prBodyInput}
              onChange={(e) => setPrBodyInput(e.target.value)}
            />
          </div>

          {showPrTokenInput ? (
            <div className="ps-field">
              <label htmlFor="pr-token">GitHub personal access token (write permissions)</label>
              <span className="ps-field__hint">
                Required only if your configured server token is read-only. Used for this PR request only and never stored.
              </span>
              <input
                id="pr-token"
                type="password"
                className="ps-input mono"
                placeholder="ghp_... or github_pat_..."
                value={prTokenInput}
                onChange={(e) => setPrTokenInput(e.target.value)}
              />
            </div>
          ) : (
            <button
              type="button"
              className="ws-report-toggle"
              onClick={() => setShowPrTokenInput(true)}
              style={{ marginTop: 0 }}
            >
              Use a custom GitHub write token (optional)
            </button>
          )}

          {prError ? (
            <div className="ws-notice ws-notice--neg" role="alert">
              {prError}
            </div>
          ) : null}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <button
              type="button"
              className="ws-btn"
              onClick={() => setPrModalOpen(false)}
              disabled={busyAction === "pr"}
            >
              Cancel
            </button>
            <button type="submit" className="ws-btn ws-btn--primary" disabled={busyAction === "pr"}>
              <GitPullRequest size={14} strokeWidth={1.75} aria-hidden="true" />
              <span>{busyAction === "pr" ? "Creating Pull Request…" : "Confirm & create Pull Request"}</span>
            </button>
          </div>
        </form>
      </ModalDialog>

      <ModalDialog
        open={selectedAttachment !== null}
        title="Screenshot evidence preview"
        onClose={() => setSelectedAttachment(null)}
      >
        {selectedAttachment ? (
          <div style={{ display: "grid", gap: 12 }}>
            {selectedAttachment.secureUrl ? (
              <img
                src={selectedAttachment.secureUrl}
                alt="Full bug report screenshot"
                style={{ maxHeight: "70dvh", width: "auto", marginInline: "auto", borderRadius: 6 }}
              />
            ) : (
              <p>Screenshot stored for evidence analysis.</p>
            )}
            <div style={{ fontSize: 12, color: "var(--app-muted)" }}>
              <code className="mono">{selectedAttachment.publicId}</code> · {selectedAttachment.mime} ·{" "}
              {Math.round(selectedAttachment.sizeBytes / 1024)}&nbsp;KB
              {selectedAttachment.width && selectedAttachment.height
                ? ` · ${selectedAttachment.width}×${selectedAttachment.height}`
                : ""}
            </div>
          </div>
        ) : null}
      </ModalDialog>
    </div>
  );
}

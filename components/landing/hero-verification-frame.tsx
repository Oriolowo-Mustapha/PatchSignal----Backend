"use client";

import * as React from "react";
import { CheckCircle2, CircleAlert, CircleX, GitCommitHorizontal } from "lucide-react";
import { DiffViewer } from "@/components/ui/diff-viewer";

type CaseKey = "checkout" | "router" | "picker";

type WorkbenchCase = {
  id: CaseKey;
  repo: string;
  issueNumber: string;
  summary: string;
  verdict: "Reproduced" | "Not reproduced" | "Inconclusive";
  targetSha: string;
  targetExit: number;
  targetDuration: string;
  baselineSha: string;
  baselineExit: number;
  baselineDuration: string;
  diffPath: string;
  oldCode: string;
  newCode: string;
  evidence: ReadonlyArray<{
    tag: "observed" | "reported" | "hypothesis" | "unknown";
    text: string;
  }>;
};

const WORKBENCH_CASES: Record<CaseKey, WorkbenchCase> = {
  checkout: {
    id: "checkout",
    repo: "meridian-dev/checkout-sdk",
    issueNumber: "#418",
    summary: "Guest checkout rejects emails containing a plus tag (+)",
    verdict: "Reproduced",
    targetSha: "8f4c21a9",
    targetExit: 1,
    targetDuration: "640 ms",
    baselineSha: "3c09b1d2",
    baselineExit: 0,
    baselineDuration: "510 ms",
    diffPath: "src/validation/email.ts",
    oldCode: [
      "const EMAIL_PATTERN = /^[a-z0-9._-]+@[a-z0-9.-]+\\.[a-z]{2,}$/i;",
      "",
      "export function acceptEmail(input: string): boolean {",
      "  const trimmed = input.trim();",
      "  return EMAIL_PATTERN.test(trimmed);",
      "}",
    ].join("\n"),
    newCode: [
      "const EMAIL_PATTERN = /^[a-z0-9._+-]+@[a-z0-9.-]+\\.[a-z]{2,}$/i;",
      "",
      "export function acceptEmail(input: string): boolean {",
      "  const trimmed = input.trim();",
      "  return EMAIL_PATTERN.test(trimmed);",
      "}",
    ].join("\n"),
    evidence: [
      { tag: "observed", text: "Screenshot shows 'Invalid email address' for ade+test@gmail.com" },
      { tag: "reported", text: "Form submission blocks before hitting /checkout endpoint" },
      { tag: "hypothesis", text: "Character class omits '+' before @ domain separator" },
    ],
  },
  router: {
    id: "router",
    repo: "acmecorp/edge-router",
    issueNumber: "#902",
    summary: "Double trailing slash strips query string on redirect",
    verdict: "Not reproduced",
    targetSha: "41b9e02f",
    targetExit: 0,
    targetDuration: "490 ms",
    baselineSha: "19d2a804",
    baselineExit: 0,
    baselineDuration: "470 ms",
    diffPath: "src/router/normalize.ts",
    oldCode: [
      "export function normalizePath(rawUrl: string): string {",
      "  const parsed = new URL(rawUrl, 'https://example.invalid');",
      "  const cleanPath = parsed.pathname.replace(/\\/+$/, '/') || '/';",
      "  return cleanPath + parsed.search;",
      "}",
    ].join("\n"),
    newCode: [
      "export function normalizePath(rawUrl: string): string {",
      "  const parsed = new URL(rawUrl, 'https://example.invalid');",
      "  const cleanPath = parsed.pathname.replace(/\\/+$/, '/') || '/';",
      "  return `${cleanPath}${parsed.search}`;",
      "}",
    ].join("\n"),
    evidence: [
      { tag: "reported", text: "Reporter observed missing ?plan=pro parameter on /pricing//" },
      { tag: "observed", text: "Test assertion returned '/pricing/?plan=pro' cleanly" },
      { tag: "unknown", text: "Reverse proxy rule ahead of application router may rewrite URL" },
    ],
  },
  picker: {
    id: "picker",
    repo: "oryx-ui/date-picker",
    issueNumber: "#114",
    summary: "Keyboard navigation crashes in native timezone polyfill build",
    verdict: "Inconclusive",
    targetSha: "c02a7e44",
    targetExit: 1,
    targetDuration: "310 ms",
    baselineSha: "9e54b100",
    baselineExit: 1,
    baselineDuration: "305 ms",
    diffPath: "src/picker/timezone.ts",
    oldCode: [
      "export function shiftCalendarDay(isoDate: string, delta: number): string {",
      "  const base = Temporal.PlainDate.from(isoDate);",
      "  return base.add({ days: delta }).toString();",
      "}",
    ].join("\n"),
    newCode: [
      "export function shiftCalendarDay(isoDate: string, delta: number): string {",
      "  if (typeof Temporal === 'undefined') throw new Error('Polyfill missing');",
      "  const base = Temporal.PlainDate.from(isoDate);",
      "  return base.add({ days: delta }).toString();",
      "}",
    ].join("\n"),
    evidence: [
      { tag: "reported", text: "ArrowRight key throws ReferenceError in older browser session" },
      { tag: "observed", text: "Offline runner halted on unresolved ambient Temporal global" },
      { tag: "unknown", text: "Target package requires build step before unit execution" },
    ],
  },
};

export function HeroVerificationFrame() {
  const [caseKey, setCaseKey] = React.useState<CaseKey>("checkout");
  const current = WORKBENCH_CASES[caseKey];

  const verdictClass =
    current.verdict === "Reproduced"
      ? "ps-pill-lime"
      : current.verdict === "Not reproduced"
        ? "ps-pill-warn"
        : "ps-pill-neutral";

  return (
    <div data-ui="hero-ledger" className="ps-app-frame">
      {/* Window chrome top bar */}
      <div className="ps-app-frame__chrome">
        <div className="ps-app-frame__chrome-left">
          <div className="ps-app-frame__dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <span className="ps-app-frame__crumb mono">
            patchsignal / workbench / {current.repo}
          </span>
        </div>

        <div className="ps-app-frame__cases" role="tablist" aria-label="Sample verified bug cases">
          {(Object.keys(WORKBENCH_CASES) as CaseKey[]).map((key) => {
            const item = WORKBENCH_CASES[key];
            const selected = key === caseKey;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={selected}
                className="ps-app-frame__case-btn"
                onClick={() => setCaseKey(key)}
              >
                <span className="mono">{item.repo.split("/")[1]}</span>
                <span className="num ps-app-frame__issue">{item.issueNumber}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 3-pane workbench preview */}
      <div className="ps-app-frame__body">
        {/* Left rail: Summary & Provenance tags */}
        <div className="ps-app-frame__rail">
          <div className="ps-app-frame__section-head">
            <span className="ps-app-frame__k">Investigation summary</span>
            <span className={verdictClass}>
              {current.verdict === "Reproduced" ? (
                <span className="ps-signal-dot ps-signal-dot--dark" aria-hidden="true" />
              ) : null}
              {current.verdict}
            </span>
          </div>

          <p className="ps-app-frame__summary">{current.summary}</p>

          <div className="ps-app-frame__provenance">
            <span className="ps-app-frame__k">Tagged evidence</span>
            <ul className="ps-app-frame__ev-list">
              {current.evidence.map((ev) => (
                <li key={ev.text} className="ps-app-frame__ev-item">
                  <span className={`ps-prov-tag is-${ev.tag}`}>{ev.tag}</span>
                  <span>{ev.text}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Center stage: Interactive 21st.dev DiffViewer (Unified / Split) */}
        <div className="ps-app-frame__diff">
          <DiffViewer
            path={current.diffPath}
            oldText={current.oldCode}
            newText={current.newCode}
            defaultView="unified"
            statusLabel="Minimal target patch preview"
            maxHeight={260}
          />
        </div>

        {/* Right pane: Pinned commit comparison ledger */}
        <div className="ps-app-frame__runs">
          <span className="ps-app-frame__k">Pinned revision runs</span>

          <div className="ps-run-card is-target">
            <div className="ps-run-card__top">
              <span className="ps-run-card__role">
                <GitCommitHorizontal size={14} strokeWidth={1.5} aria-hidden="true" />
                Target commit
              </span>
              <code className="mono num">{current.targetSha}</code>
            </div>
            <div className="ps-run-card__bot num">
              <span className={`ps-exit-tag ${current.targetExit === 0 ? "is-ok" : "is-fail"}`}>
                {current.targetExit === 0 ? (
                  <CheckCircle2 size={13} strokeWidth={1.5} aria-hidden="true" />
                ) : (
                  <CircleX size={13} strokeWidth={1.5} aria-hidden="true" />
                )}
                <code>{`exit ${current.targetExit}`}</code>
              </span>
              <span className="ps-run-card__dur">{current.targetDuration}</span>
            </div>
          </div>

          <div className="ps-run-card">
            <div className="ps-run-card__top">
              <span className="ps-run-card__role">
                <GitCommitHorizontal size={14} strokeWidth={1.5} aria-hidden="true" />
                Baseline commit
              </span>
              <code className="mono num">{current.baselineSha}</code>
            </div>
            <div className="ps-run-card__bot num">
              <span className={`ps-exit-tag ${current.baselineExit === 0 ? "is-ok" : "is-fail"}`}>
                {current.baselineExit === 0 ? (
                  <CheckCircle2 size={13} strokeWidth={1.5} aria-hidden="true" />
                ) : (
                  <CircleAlert size={13} strokeWidth={1.5} aria-hidden="true" />
                )}
                <code>{`exit ${current.baselineExit}`}</code>
              </span>
              <span className="ps-run-card__dur">{current.baselineDuration}</span>
            </div>
          </div>

          <div className="ps-run-card__note">
            Read-only workspace mount · Outbound network disabled · Draft awaits manual approval
          </div>
        </div>
      </div>
    </div>
  );
}

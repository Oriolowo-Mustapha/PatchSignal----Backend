"use client";

import * as React from "react";
import { classify, type RunOutcome } from "@/lib/classify/rules";
import { CodeBlockTabs } from "@/components/ui/code-block-tabs";
import { SlidingTabs } from "@/components/ui/sliding-tabs";
import { Terminal } from "@/components/ui/terminal";

type TargetPresetKey = "assertion-failed" | "passed" | "missing-module" | "timeout";
type ControlPresetKey = "passed" | "also-failed" | "none";
type InspectorMode = "terminal" | "code";

const TARGET_PRESETS: Record<
  TargetPresetKey,
  {
    label: string;
    outcome: RunOutcome;
    exitCode: number;
    durationMs: number;
    predictedAssertionFailed: boolean;
    unrelatedFailure: boolean;
    ansiOutput: string;
  }
> = {
  "assertion-failed": {
    label: "Assertion failed",
    outcome: "failed",
    exitCode: 1,
    durationMs: 640,
    predictedAssertionFailed: true,
    unrelatedFailure: false,
    ansiOutput: [
      "\u001b[36mRUN\u001b[39m  target commit 8f4c21a9",
      "",
      " \u001b[31mFAIL\u001b[39m tests/patchsignal/repro-email-plus.test.ts (1 test | 1 failed)",
      "   \u001b[31m×\u001b[39m accepts plus-addressed email ade+test@gmail.com \u001b[90m14ms\u001b[39m",
      "     \u001b[31mAssertionError: expected false to be true\u001b[39m",
      "     \u001b[90mat src/validation/email.ts:4:22\u001b[39m",
      "",
      " \u001b[31mTest Files  1 failed (1)\u001b[39m",
      " \u001b[31m     Tests  1 failed (1)\u001b[39m",
    ].join("\n"),
  },
  passed: {
    label: "Test passed",
    outcome: "passed",
    exitCode: 0,
    durationMs: 520,
    predictedAssertionFailed: false,
    unrelatedFailure: false,
    ansiOutput: [
      "\u001b[36mRUN\u001b[39m  target commit 8f4c21a9",
      "",
      " \u001b[32mPASS\u001b[39m tests/patchsignal/repro-email-plus.test.ts (1 test)",
      "   \u001b[32m+\u001b[39m accepts plus-addressed email ade+test@gmail.com \u001b[90m6ms\u001b[39m",
      "",
      " \u001b[32mTest Files  1 passed (1)\u001b[39m",
      " \u001b[32m     Tests  1 passed (1)\u001b[39m",
    ].join("\n"),
  },
  "missing-module": {
    label: "Missing module",
    outcome: "failed",
    exitCode: 1,
    durationMs: 310,
    predictedAssertionFailed: false,
    unrelatedFailure: true,
    ansiOutput: [
      "\u001b[36mRUN\u001b[39m  target commit 8f4c21a9",
      "",
      " \u001b[31mFAIL\u001b[39m  tests/patchsignal/repro-email-plus.test.ts",
      ' \u001b[31mError: Failed to resolve import "../../src/validation/email"\u001b[39m',
      " \u001b[33mGuardrail: setup or import failures never report as Reproduced\u001b[39m",
    ].join("\n"),
  },
  timeout: {
    label: "Timeout",
    outcome: "timeout",
    exitCode: 124,
    durationMs: 120000,
    predictedAssertionFailed: false,
    unrelatedFailure: true,
    ansiOutput: [
      "\u001b[36mRUN\u001b[39m  target commit 8f4c21a9",
      "",
      " \u001b[33mWARN\u001b[39m Isolated execution stopped after the 120s time limit",
      " \u001b[90mCleanup completed with zero remaining processes\u001b[39m",
    ].join("\n"),
  },
};

const CONTROL_PRESETS: Record<
  ControlPresetKey,
  {
    label: string;
    run: {
      role: "control";
      outcome: RunOutcome;
      exitCode?: number;
      predictedAssertionFailed: boolean;
      unrelatedFailure: boolean;
    } | null;
  }
> = {
  passed: {
    label: "Baseline passed",
    run: {
      role: "control",
      outcome: "passed",
      exitCode: 0,
      predictedAssertionFailed: false,
      unrelatedFailure: false,
    },
  },
  "also-failed": {
    label: "Baseline also failed",
    run: {
      role: "control",
      outcome: "failed",
      exitCode: 1,
      predictedAssertionFailed: true,
      unrelatedFailure: false,
    },
  },
  none: {
    label: "No baseline",
    run: null,
  },
};

const EVIDENCE_ROWS = [
  {
    text: "Email input shows ade+test@gmail.com and 'Invalid email address'",
    provenance: "observed",
    source: "screenshot 1",
  },
  {
    text: "Account registration rejects any address containing a plus sign",
    provenance: "reported",
    source: "description",
  },
  {
    text: "Validation pattern in email module excludes the '+' character",
    provenance: "hypothesis",
    source: "analysis",
  },
  {
    text: "Which browser and version submitted the checkout form?",
    provenance: "unknown",
    source: "question",
  },
] as const;

const REPRO_CODE_TABS = [
  {
    id: "test",
    label: "Reproduction test",
    highlightLines: [5, 6],
    code: [
      'import { expect, it } from "vitest";',
      'import { acceptEmail } from "../../src/validation/email";',
      "",
      'it("accepts plus-addressed emails during guest checkout", () => {',
      '  expect(acceptEmail("ade+test@gmail.com")).toBe(true);',
      '  expect(acceptEmail("standard@gmail.com")).toBe(true);',
      "});",
    ].join("\n"),
  },
  {
    id: "brief",
    label: "Generated brief",
    highlightLines: [1, 4],
    code: [
      "## Verified Reproduction: Plus-addressed email rejection",
      "- Repository: meridian-dev/checkout-sdk",
      "- Target SHA: 8f4c21a9 (exit 1) | Baseline SHA: 3c09b1d2 (exit 0)",
      "- Verdict: Reproduced (assertion failed on predicted input)",
      "",
      "### Observed Evidence",
      "- [observed] Screenshot 1 shows 'Invalid email address' for ade+test@gmail.com",
    ].join("\n"),
  },
] as const;

export function VerdictSimulator() {
  const [targetKey, setTargetKey] = React.useState<TargetPresetKey>("assertion-failed");
  const [controlKey, setControlKey] = React.useState<ControlPresetKey>("passed");
  const [inspectorMode, setInspectorMode] = React.useState<InspectorMode>("terminal");

  const target = TARGET_PRESETS[targetKey];
  const control = CONTROL_PRESETS[controlKey];

  const verdict = classify(
    {
      role: "target",
      outcome: target.outcome,
      exitCode: target.exitCode,
      predictedAssertionFailed: target.predictedAssertionFailed,
      unrelatedFailure: target.unrelatedFailure,
    },
    control.run
  );

  const pillClass =
    verdict.status === "Reproduced"
      ? "ps-verdict-pill ps-verdict-pill--pos"
      : verdict.status === "Not_reproduced"
        ? "ps-verdict-pill ps-verdict-pill--warn"
        : "ps-verdict-pill ps-verdict-pill--neutral";

  const statusText = verdict.status.replace("_", " ");

  return (
    <div data-ui="verdict-simulator" className="ps-sim">
      <div className="ps-sim__head">
        <div>
          <h3 className="ps-sim__title">Interactive verdict simulator</h3>
          <p className="ps-sim__sub">
            Toggle target and baseline test outcomes to see how PatchSignal guarantees honest triage verdicts.
          </p>
        </div>
        <span className={pillClass}>
          {verdict.status === "Reproduced" ? (
            <span className="ps-signal-dot ps-signal-dot--dark" aria-hidden="true" />
          ) : null}
          {statusText}
        </span>
      </div>

      <div className="ps-sim__controls">
        <div className="ps-sim__control-block">
          <span className="ps-sim__group-label">Target revision run</span>
          <SlidingTabs
            ariaLabel="Target run outcome"
            mode="group"
            variant="pill"
            value={targetKey}
            onChange={setTargetKey}
            items={(Object.keys(TARGET_PRESETS) as TargetPresetKey[]).map((key) => ({
              id: key,
              label: TARGET_PRESETS[key].label,
            }))}
          />
        </div>
        <div className="ps-sim__control-block">
          <span className="ps-sim__group-label">Baseline revision run</span>
          <SlidingTabs
            ariaLabel="Baseline run outcome"
            mode="group"
            variant="pill"
            value={controlKey}
            onChange={setControlKey}
            items={(Object.keys(CONTROL_PRESETS) as ControlPresetKey[]).map((key) => ({
              id: key,
              label: CONTROL_PRESETS[key].label,
            }))}
          />
        </div>
      </div>

      <div className="ps-sim__verdict" aria-live="polite">
        <strong className="ps-sim__verdict-label">{statusText}</strong>
        <p className="ps-sim__verdict-text">{verdict.justification}</p>
      </div>

      <div className="ps-sim__grid">
        <div className="ps-sim__pane-col">
          <div className="ps-sim__pane-bar">
            <span className="ps-sim__group-label">Execution inspector</span>
            <SlidingTabs
              ariaLabel="Inspector view"
              mode="group"
              variant="pill"
              value={inspectorMode}
              onChange={setInspectorMode}
              items={[
                { id: "terminal", label: "Runner output" },
                { id: "code", label: "Test & brief" },
              ]}
            />
          </div>

          {inspectorMode === "terminal" ? (
            <Terminal
              title="Isolated runner log"
              command="patchsignal verify --commit 8f4c21a9"
              text={target.ansiOutput}
              exitCode={target.exitCode}
              durationMs={target.durationMs}
              maxHeight={240}
            />
          ) : (
            <CodeBlockTabs
              title="tests/patchsignal/repro-email-plus.test.ts"
              tabs={[...REPRO_CODE_TABS]}
              maxHeight={240}
            />
          )}
        </div>

        <div className="ps-sim__evidence">
          <div className="ps-sim__ev-head">
            <strong className="ps-sim__ev-title">Structured evidence breakdown</strong>
            <span className="ps-sim__ev-count num">4 items</span>
          </div>
          {EVIDENCE_ROWS.map((row) => (
            <div key={row.text} className="ps-sim__ev-row">
              <span className="ps-sim__ev-text">{row.text}</span>
              <span className="ps-sim__ev-tags">
                <span
                  className={
                    row.provenance === "observed"
                      ? "ps-verdict-pill ps-verdict-pill--pos"
                      : row.provenance === "hypothesis"
                        ? "ps-verdict-pill ps-verdict-pill--warn"
                        : "ps-verdict-pill ps-verdict-pill--neutral"
                  }
                >
                  {row.provenance}
                </span>
                <span className="ps-sim__ev-source">{row.source}</span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

"use client";

import * as React from "react";
import { Pause, Play } from "lucide-react";

/**
 * Orthogonal node-and-wire verification schematic inspired by design-taste-frontend diagrams.
 * Pure solid Midnight Black, Pure White, and Lime Green surfaces with a single pauseable signal pulse.
 */
export function PipelineDiagram() {
  const [paused, setPaused] = React.useState(false);
  const titleId = React.useId();

  return (
    <div
      data-ui="pipeline-diagram"
      data-paused={paused ? "true" : "false"}
      className="ps-diagram-card"
    >
      <div className="ps-diagram-card__head">
        <div>
          <h3 className="ps-diagram-card__title">Verification signal path</h3>
          <p className="ps-diagram-card__sub">
            Parallel pinned-commit execution separates verified failures from setup errors
          </p>
        </div>
        <button
          type="button"
          className="ps-diagram-card__toggle"
          aria-label={paused ? "Play pipeline signal animation" : "Pause pipeline signal animation"}
          aria-pressed={paused}
          title={paused ? "Play animation" : "Pause animation"}
          onClick={() => setPaused((p) => !p)}
        >
          {paused ? (
            <Play size={14} strokeWidth={1.75} aria-hidden="true" />
          ) : (
            <Pause size={14} strokeWidth={1.75} aria-hidden="true" />
          )}
        </button>
      </div>

      <div className="ps-diagram-frame">
        <svg
          viewBox="0 0 860 272"
          role="img"
          aria-labelledby={titleId}
          className="ps-diagram-svg"
        >
          <title id={titleId}>
            Bug report and screenshots flow into evidence triage, run in parallel against pinned target and baseline commits, and converge into a verdict and review-ready issue brief.
          </title>

          {/* Subtle structural baseline grid */}
          <path
            d="M0 136 H860"
            stroke="rgba(255,255,255,0.04)"
            strokeWidth="1"
            strokeDasharray="4 4"
          />

          {/* Orthogonal routing wires */}
          <g fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="1.5" strokeLinejoin="round">
            {/* Intake -> Evidence */}
            <path d="M168 136 H208" />
            {/* Evidence -> Target lane */}
            <path d="M368 124 H398 Q408 124 408 114 V82 Q408 72 418 72 H448" />
            {/* Evidence -> Baseline lane */}
            <path d="M368 148 H398 Q408 148 408 158 V190 Q408 200 418 200 H448" />
            {/* Target -> Verdict */}
            <path d="M622 72 H650 Q660 72 660 82 V114 Q660 124 670 124 H694" />
            {/* Baseline -> Verdict */}
            <path d="M622 200 H650 Q660 200 660 190 V158 Q660 148 670 148 H694" />
          </g>

          {/* Animated Lime Signal Path along primary reproduction route */}
          <path
            d="M168 136 H208 M368 124 H398 Q408 124 408 114 V82 Q408 72 418 72 H448 M622 72 H650 Q660 72 660 82 V114 Q660 124 670 124 H694"
            fill="none"
            stroke="#A3E635"
            strokeWidth="1.75"
            strokeDasharray="10 18"
            className="ps-diagram-pulse-wire"
          />

          {/* Node 1: Issue Intake */}
          <g transform="translate(18, 96)">
            <rect
              width="150"
              height="80"
              rx="8"
              fill="#0E1319"
              stroke="rgba(255,255,255,0.18)"
            />
            <text x="14" y="24" fill="#8B97A6" fontSize="11" fontFamily="var(--font-code)">
              01 INTAKE
            </text>
            <text x="14" y="46" fill="#FFFFFF" fontSize="13" fontWeight="500" fontFamily="var(--font-sans)">
              Report + PNGs
            </text>
            <text x="14" y="64" fill="#B8C1CC" fontSize="11" fontFamily="var(--font-code)">
              up to 3 images
            </text>
          </g>

          {/* Node 2: Evidence Extractor */}
          <g transform="translate(208, 96)">
            <rect
              width="160"
              height="80"
              rx="8"
              fill="#0E1319"
              stroke="rgba(255,255,255,0.18)"
            />
            <text x="14" y="24" fill="#8B97A6" fontSize="11" fontFamily="var(--font-code)">
              02 PROVENANCE
            </text>
            <text x="14" y="46" fill="#FFFFFF" fontSize="13" fontWeight="500" fontFamily="var(--font-sans)">
              Fact isolation
            </text>
            <text x="14" y="64" fill="#A3E635" fontSize="11" fontFamily="var(--font-code)">
              observed | unknown
            </text>
          </g>

          {/* Node 3A: Target Commit Lane */}
          <g transform="translate(448, 32)">
            <rect
              width="174"
              height="80"
              rx="8"
              fill="#151C24"
              stroke="rgba(163,230,53,0.45)"
            />
            <text x="14" y="24" fill="#A3E635" fontSize="11" fontFamily="var(--font-code)">
              TARGET · 8f4c21a9
            </text>
            <text x="14" y="46" fill="#FFFFFF" fontSize="13" fontWeight="500" fontFamily="var(--font-sans)">
              Offline assertion
            </text>
            <text x="14" y="64" fill="#FCA5A5" fontSize="11" fontFamily="var(--font-code)">
              exit 1 (reproduced)
            </text>
          </g>

          {/* Node 3B: Baseline Commit Lane */}
          <g transform="translate(448, 160)">
            <rect
              width="174"
              height="80"
              rx="8"
              fill="#0E1319"
              stroke="rgba(255,255,255,0.16)"
            />
            <text x="14" y="24" fill="#8B97A6" fontSize="11" fontFamily="var(--font-code)">
              BASELINE · 3c09b1d2
            </text>
            <text x="14" y="46" fill="#FFFFFF" fontSize="13" fontWeight="500" fontFamily="var(--font-sans)">
              Control execution
            </text>
            <text x="14" y="64" fill="#A3E635" fontSize="11" fontFamily="var(--font-code)">
              exit 0 (clean pass)
            </text>
          </g>

          {/* Node 4: Deterministic Verdict & Draft */}
          <g transform="translate(694, 84)">
            <rect
              width="148"
              height="104"
              rx="8"
              fill="#0E1319"
              stroke="#A3E635"
            />
            <rect x="14" y="14" width="96" height="22" rx="4" fill="#A3E635" />
            <text x="24" y="29" fill="#080B0F" fontSize="11" fontWeight="600" fontFamily="var(--font-sans)">
              Reproduced
            </text>
            <text x="14" y="58" fill="#FFFFFF" fontSize="13" fontWeight="500" fontFamily="var(--font-sans)">
              Issue brief ready
            </text>
            <text x="14" y="76" fill="#B8C1CC" fontSize="11" fontFamily="var(--font-code)">
              human review next
            </text>
            <text x="14" y="92" fill="#8B97A6" fontSize="11" fontFamily="var(--font-code)">
              04 SIGN-OFF
            </text>
          </g>
        </svg>
      </div>
    </div>
  );
}

"use client";

import * as React from "react";
import { Check } from "lucide-react";

/**
 * Inspired by 21st.dev `Steps` (id: 43788) adapted as a horizontal workflow rail.
 */

export interface PipelineStepItem {
  id: string;
  label: string;
  detail?: string;
}

export interface PipelineStepperProps {
  steps: ReadonlyArray<PipelineStepItem>;
  currentStepId: string;
  onSelectStep?: (stepId: string) => void;
  ariaLabel?: string;
  className?: string;
}

export function PipelineStepper({
  steps,
  currentStepId,
  onSelectStep,
  ariaLabel = "Investigation progress",
  className,
}: PipelineStepperProps) {
  const currentIdx = Math.max(
    0,
    steps.findIndex((s) => s.id === currentStepId)
  );
  const allCompleted = currentIdx === steps.length - 1;

  return (
    <nav
      data-ui="pipeline-stepper"
      aria-label={ariaLabel}
      className={className ? `ps-stepper ${className}` : "ps-stepper"}
    >
      <ol className="ps-stepper__list">
        {steps.map((step, idx) => {
          const isDone = idx < currentIdx || (allCompleted && idx === currentIdx);
          const isCurrent = idx === currentIdx && !isDone;
          const state = isDone ? "done" : isCurrent ? "current" : "upcoming";
          const clickable = typeof onSelectStep === "function";
          const nodeIndex = String(idx + 1).padStart(2, "0");

          const inner = (
            <>
              <span className="ps-stepper__badge num" aria-hidden="true">
                {isDone ? <Check size={12} strokeWidth={2.2} /> : nodeIndex}
              </span>
              <span className="ps-stepper__text">
                <span className="ps-stepper__label">{step.label}</span>
                {step.detail ? <span className="ps-stepper__detail">{step.detail}</span> : null}
              </span>
            </>
          );

          return (
            <li key={step.id} className="ps-stepper__item" data-state={state}>
              {clickable ? (
                <button
                  type="button"
                  className="ps-stepper__btn"
                  aria-current={isCurrent ? "step" : undefined}
                  onClick={() => onSelectStep(step.id)}
                >
                  {inner}
                </button>
              ) : (
                <div className="ps-stepper__node" aria-current={isCurrent ? "step" : undefined}>
                  {inner}
                </div>
              )}
              {idx < steps.length - 1 ? (
                <span
                  className={`ps-stepper__rail ${idx < currentIdx ? "is-filled" : ""}`}
                  aria-hidden="true"
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

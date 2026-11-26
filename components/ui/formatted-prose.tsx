"use client";

import * as React from "react";
import { parseDiagnosisProse, type InlineSegment } from "@/lib/ui/prose";

function renderSegments(segments: InlineSegment[]) {
  return segments.map((seg, idx) => {
    if (seg.kind === "text") {
      return <React.Fragment key={idx}>{seg.value}</React.Fragment>;
    }
    if (seg.kind === "bold") {
      return <strong key={idx}>{seg.value}</strong>;
    }
    const mod =
      seg.kind === "code-error"
        ? "ps-inline-code--error"
        : seg.kind === "code-file"
          ? "ps-inline-code--file"
          : "ps-inline-code--symbol";
    return (
      <code key={idx} className={`ps-inline-code ${mod}`}>
        {seg.value}
      </code>
    );
  });
}

export function FormattedProse({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const blocks = React.useMemo(() => parseDiagnosisProse(text), [text]);
  if (blocks.length === 0) return null;

  return (
    <div className={className ? `ps-prose ${className}` : "ps-prose"}>
      {blocks.map((block, idx) => {
        if (block.kind === "paragraph") {
          return (
            <p key={idx} className="ps-prose__p">
              {renderSegments(block.segments)}
            </p>
          );
        }
        if (block.kind === "ordered") {
          return (
            <ol key={idx} className="ps-prose__ol">
              {block.items.map((item, j) => (
                <li key={j}>{renderSegments(item)}</li>
              ))}
            </ol>
          );
        }
        return (
          <ul key={idx} className="ps-prose__ul">
            {block.items.map((item, j) => (
              <li key={j}>{renderSegments(item)}</li>
            ))}
          </ul>
        );
      })}
    </div>
  );
}

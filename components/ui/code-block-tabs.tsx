"use client";

import * as React from "react";
import { Check, Copy, WrapText } from "lucide-react";

/**
 * Inspired by 21st.dev `Code Block` (id: 45498, author: aadixc0de).
 * Multi-tab snippet viewer with tabular-nums line numbers, highlighted lines, wrap toggle, and copy.
 */

export interface CodeBlockTab {
  id: string;
  label: string;
  code: string;
  highlightLines?: readonly number[];
}

export interface CodeBlockTabsProps {
  tabs: ReadonlyArray<CodeBlockTab>;
  title?: React.ReactNode;
  maxHeight?: number;
  defaultWrap?: boolean;
  className?: string;
}

export function CodeBlockTabs({
  tabs,
  title,
  maxHeight,
  defaultWrap = true,
  className,
}: CodeBlockTabsProps) {
  const [activeId, setActiveId] = React.useState<string>(tabs[0]?.id ?? "");
  const [wrap, setWrap] = React.useState(defaultWrap);
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (tabs.length > 0 && !tabs.some((t) => t.id === activeId)) {
      setActiveId(tabs[0].id);
    }
  }, [tabs, activeId]);

  const current = tabs.find((t) => t.id === activeId) ?? tabs[0];
  if (!current) return null;

  const lines = current.code.replace(/\n$/, "").split("\n");
  const highlightSet = new Set(current.highlightLines ?? []);

  const handleCopy = () => {
    navigator.clipboard
      ?.writeText(current.code)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1400);
      })
      .catch(() => {});
  };

  return (
    <div
      data-ui="code-tabs"
      data-wrap={wrap ? "true" : "false"}
      className={className ? `ps-code-tabs ${className}` : "ps-code-tabs"}
    >
      <div className="ps-code-tabs__head">
        <div className="ps-code-tabs__left">
          {title ? <span className="ps-code-tabs__title mono">{title}</span> : null}
          <div className="ps-code-tabs__tablist" role="tablist" aria-label="Code language tabs">
            {tabs.map((tab) => {
              const selected = tab.id === current.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  className="ps-code-tabs__tab"
                  onClick={() => setActiveId(tab.id)}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="ps-code-tabs__actions">
          <button
            type="button"
            className="ps-code-tabs__icon-btn"
            aria-label={wrap ? "Disable line wrapping" : "Wrap long lines"}
            aria-pressed={wrap}
            title={wrap ? "Disable wrap" : "Wrap lines"}
            onClick={() => setWrap((w) => !w)}
          >
            <WrapText size={14} strokeWidth={1.5} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="ps-code-tabs__icon-btn"
            aria-label={copied ? "Copied code snippet" : "Copy code snippet"}
            title="Copy code"
            onClick={handleCopy}
          >
            {copied ? (
              <Check size={14} strokeWidth={1.5} aria-hidden="true" />
            ) : (
              <Copy size={14} strokeWidth={1.5} aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      <div
        className="ps-code-tabs__body"
        style={maxHeight ? { maxHeight: `${maxHeight}px` } : undefined}
      >
        <div className="ps-code-tabs__lines">
          {lines.map((lineText, idx) => {
            const lineNum = idx + 1;
            const highlighted = highlightSet.has(lineNum);
            return (
              <div
                key={lineNum}
                className={highlighted ? "ps-code-tabs__line is-highlighted" : "ps-code-tabs__line"}
              >
                <span className="ps-code-tabs__ln num" aria-hidden="true">
                  {lineNum}
                </span>
                <code className="ps-code-tabs__code mono">{lineText || " "}</code>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

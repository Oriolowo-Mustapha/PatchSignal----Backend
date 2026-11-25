"use client";

import * as React from "react";
import {
  ArrowDown,
  Ban,
  Check,
  CircleCheck,
  CircleX,
  Copy,
  SquareTerminal,
  WrapText,
} from "lucide-react";

/**
 * Adapted from 21st.dev `Terminal` (id: 45482, author: aadixc0de).
 * Parses SGR ANSI escape sequences, OSC-8 hyperlinks, and carriage-return
 * progress rewinds into theme-aware spans inside a [data-ui="terminal"] region.
 */

export interface TerminalProps extends Omit<React.ComponentProps<"div">, "children" | "title"> {
  text: string;
  command?: string;
  title?: React.ReactNode;
  cwd?: string;
  running?: boolean;
  exitCode?: number | null;
  durationMs?: number | null;
  defaultWrap?: boolean;
  defaultFollow?: boolean;
  height?: number | string;
  maxHeight?: number | string;
  maxLines?: number;
}

type AnsiHue = "red" | "green" | "amber" | "blue" | "purple" | "teal";
type AnsiTone = "strong" | "default" | "muted" | "subtle" | AnsiHue;

interface AnsiStyle {
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  inverse?: boolean;
  strike?: boolean;
  tone?: AnsiTone;
  background?: "fill" | AnsiHue;
  href?: string;
}

interface AnsiSpan {
  text: string;
  style: AnsiStyle;
}

type AnsiLine = readonly AnsiSpan[];

const ESC = "\u001b";
const BEL = "\u0007";

const BASIC: AnsiTone[] = [
  "subtle",
  "red",
  "green",
  "amber",
  "blue",
  "purple",
  "teal",
  "default",
  "subtle",
  "red",
  "green",
  "amber",
  "blue",
  "purple",
  "teal",
  "strong",
];

const HUES = new Set<AnsiTone>(["red", "green", "amber", "blue", "purple", "teal"]);

const asBackground = (tone: AnsiTone | undefined): AnsiStyle["background"] =>
  tone && HUES.has(tone) ? (tone as AnsiHue) : "fill";

function sameStyle(a: AnsiStyle, b: AnsiStyle) {
  return (
    a.bold === b.bold &&
    a.dim === b.dim &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.inverse === b.inverse &&
    a.strike === b.strike &&
    a.tone === b.tone &&
    a.background === b.background &&
    a.href === b.href
  );
}

function rgbFor256(n: number): [number, number, number] {
  if (n >= 232) {
    const v = 8 + (n - 232) * 10;
    return [v, v, v];
  }
  const i = n - 16;
  const steps = [0, 95, 135, 175, 215, 255];
  return [steps[Math.floor(i / 36)] ?? 0, steps[Math.floor(i / 6) % 6] ?? 0, steps[i % 6] ?? 0];
}

function hueFor(angle: number): AnsiHue {
  if (angle < 20 || angle >= 330) return "red";
  if (angle < 70) return "amber";
  if (angle < 160) return "green";
  if (angle < 200) return "teal";
  if (angle < 260) return "blue";
  return "purple";
}

function toneForRgb(r: number, g: number, b: number): AnsiTone {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const chroma = max - min;
  if (chroma > 60 && max > 80) {
    let h: number;
    if (max === r) h = ((g - b) / chroma) % 6;
    else if (max === g) h = (b - r) / chroma + 2;
    else h = (r - g) / chroma + 4;
    return hueFor((h * 60 + 360) % 360);
  }
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  if (l < 70) return "subtle";
  if (l < 150) return "muted";
  if (l < 225) return "default";
  return "strong";
}

function toneFor256(n: number): AnsiTone {
  if (n < 16) return BASIC[n] ?? "default";
  const [r, g, b] = rgbFor256(n);
  return toneForRgb(r, g, b);
}

function readExtended(codes: number[], i: number): [AnsiTone | undefined, number] {
  const mode = codes[i + 1];
  if (mode === 5) return [toneFor256(codes[i + 2] ?? 0), i + 2];
  if (mode === 2) {
    return [toneForRgb(codes[i + 2] ?? 0, codes[i + 3] ?? 0, codes[i + 4] ?? 0), i + 4];
  }
  return [undefined, i];
}

function applySgr(style: AnsiStyle, params: string): AnsiStyle {
  const codes = params === "" ? [0] : params.split(/[;:]/).map((p) => (p === "" ? 0 : Number(p)));
  let next: AnsiStyle = { ...style };
  for (let i = 0; i < codes.length; i++) {
    const c = codes[i] ?? 0;
    if (c === 0) next = next.href ? { href: next.href } : {};
    else if (c === 1) next.bold = true;
    else if (c === 2) next.dim = true;
    else if (c === 3) next.italic = true;
    else if (c === 4) next.underline = true;
    else if (c === 7) next.inverse = true;
    else if (c === 9) next.strike = true;
    else if (c === 21 || c === 22) {
      next.bold = false;
      next.dim = false;
    } else if (c === 23) next.italic = false;
    else if (c === 24) next.underline = false;
    else if (c === 27) next.inverse = false;
    else if (c === 29) next.strike = false;
    else if (c >= 30 && c <= 37) next.tone = BASIC[c - 30];
    else if (c >= 90 && c <= 97) next.tone = BASIC[c - 90 + 8];
    else if (c === 39) next.tone = undefined;
    else if (c >= 40 && c <= 47) next.background = asBackground(BASIC[c - 40]);
    else if (c >= 100 && c <= 107) next.background = asBackground(BASIC[c - 100 + 8]);
    else if (c === 49) next.background = undefined;
    else if (c === 38) {
      const [tone, j] = readExtended(codes, i);
      next.tone = tone;
      i = j;
    } else if (c === 48) {
      const [tone, j] = readExtended(codes, i);
      next.background = asBackground(tone);
      i = j;
    }
  }
  for (const key of Object.keys(next) as (keyof AnsiStyle)[]) {
    if (next[key] === undefined || next[key] === false) delete next[key];
  }
  return next;
}

class AnsiParser {
  readonly done: AnsiLine[] = [];
  private current: AnsiSpan[] = [];
  private style: AnsiStyle = {};
  private pending = "";
  private rewind = false;

  get lines(): AnsiLine[] {
    return this.current.length > 0 ? [...this.done, this.current.slice()] : [...this.done];
  }

  private write(text: string) {
    if (!text) return;
    if (this.rewind) {
      this.current = [];
      this.rewind = false;
    }
    const last = this.current.at(-1);
    if (last && sameStyle(last.style, this.style)) {
      this.current[this.current.length - 1] = { text: last.text + text, style: last.style };
    } else {
      this.current.push({ text, style: this.style });
    }
  }

  private newline() {
    this.done.push(Object.freeze(this.current));
    this.current = [];
    this.rewind = false;
  }

  private backspace() {
    const last = this.current.at(-1);
    if (!last) return;
    const text = last.text.slice(0, -1);
    if (text) this.current[this.current.length - 1] = { text, style: last.style };
    else this.current.pop();
  }

  push(chunk: string) {
    const input = this.pending + chunk;
    this.pending = "";
    let text = "";
    let i = 0;
    const flush = () => {
      this.write(text);
      text = "";
    };
    while (i < input.length) {
      const ch = input[i] as string;
      if (ch === ESC) {
        const next = input[i + 1];
        if (next === undefined) {
          flush();
          this.pending = input.slice(i);
          return;
        }
        if (next === "[") {
          let j = i + 2;
          while (j < input.length && !/[@-~]/.test(input[j] as string)) j++;
          if (j >= input.length) {
            flush();
            this.pending = input.slice(i);
            return;
          }
          const final = input[j];
          const params = input.slice(i + 2, j);
          flush();
          if (final === "m") this.style = applySgr(this.style, params);
          else if (final === "K" && (params === "2" || params === "" || params === "0")) {
            this.current = [];
          } else if (final === "G" && (params === "" || params === "1")) {
            this.rewind = true;
          }
          i = j + 1;
          continue;
        }
        if (next === "]") {
          let j = i + 2;
          let end = -1;
          let terminator = 0;
          while (j < input.length) {
            if (input[j] === BEL) {
              end = j;
              terminator = 1;
              break;
            }
            if (input[j] === ESC && input[j + 1] === "\\") {
              end = j;
              terminator = 2;
              break;
            }
            j++;
          }
          if (end < 0) {
            flush();
            this.pending = input.slice(i);
            return;
          }
          flush();
          const body = input.slice(i + 2, end);
          if (body.startsWith("8;")) {
            const href = body.slice(body.indexOf(";", 2) + 1);
            const nextStyle = { ...this.style };
            if (href) nextStyle.href = href;
            else delete nextStyle.href;
            this.style = nextStyle;
          }
          i = end + terminator;
          continue;
        }
        i += 2;
        continue;
      }
      if (ch === "\n") {
        flush();
        this.newline();
      } else if (ch === "\r") {
        flush();
        if (input[i + 1] === "\n") {
          this.newline();
          i++;
        } else if (i + 1 >= input.length) {
          this.pending = "\r";
        } else {
          this.rewind = true;
        }
      } else if (ch === "\b") {
        flush();
        this.backspace();
      } else if (ch === "\t" || ch >= " ") {
        text += ch;
      }
      i++;
    }
    flush();
  }

  toPlainText() {
    return this.lines.map((line) => line.map((s) => s.text).join("")).join("\n");
  }
}

function useAnsiLines(text: string) {
  const ref = React.useRef<{ parser: AnsiParser; text: string; generation: number } | null>(null);
  return React.useMemo(() => {
    let state = ref.current;
    const extendsPrev =
      state !== null &&
      text.length >= state.text.length &&
      text.slice(Math.max(0, state.text.length - 64), state.text.length) === state.text.slice(-64);
    if (!state || !extendsPrev) {
      state = { parser: new AnsiParser(), text: "", generation: (state?.generation ?? 0) + 1 };
      ref.current = state;
    }
    state.parser.push(text.slice(state.text.length));
    state.text = text;
    return { lines: state.parser.lines, parser: state.parser, generation: state.generation };
  }, [text]);
}

const TONE_CLASS: Record<NonNullable<AnsiStyle["tone"]>, string> = {
  strong: "ps-ansi-strong",
  default: "",
  muted: "ps-ansi-muted",
  subtle: "ps-ansi-subtle",
  red: "ps-ansi-red",
  green: "ps-ansi-green",
  amber: "ps-ansi-amber",
  blue: "ps-ansi-blue",
  purple: "ps-ansi-purple",
  teal: "ps-ansi-teal",
};

const BG_CLASS: Record<NonNullable<AnsiStyle["background"]>, string> = {
  fill: "ps-ansi-bg-fill",
  red: "ps-ansi-bg-red",
  green: "ps-ansi-bg-green",
  amber: "ps-ansi-bg-amber",
  blue: "ps-ansi-bg-blue",
  purple: "ps-ansi-bg-purple",
  teal: "ps-ansi-bg-teal",
};

function spanClass(style: AnsiStyle): string | undefined {
  if (style.inverse) return style.bold ? "ps-ansi-inverse ps-ansi-bold" : "ps-ansi-inverse";
  const parts = [
    style.tone ? TONE_CLASS[style.tone] : "",
    style.dim && !style.tone ? "ps-ansi-subtle" : "",
    style.dim && style.tone ? "ps-ansi-dim" : "",
    style.bold ? "ps-ansi-bold" : "",
    style.italic ? "ps-ansi-italic" : "",
    style.underline ? "ps-ansi-underline" : "",
    style.strike ? "ps-ansi-strike" : "",
    style.background ? BG_CLASS[style.background] : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" ") : undefined;
}

function formatDuration(ms: number) {
  if (ms < 1000) return `${Math.max(1, Math.round(ms))}\u00a0ms`;
  const s = ms / 1000;
  if (s < 10) return `${s.toFixed(1)}\u00a0s`;
  return `${Math.round(s)}\u00a0s`;
}

export function Terminal({
  text,
  command,
  title,
  cwd,
  running = false,
  exitCode,
  durationMs,
  defaultWrap = true,
  defaultFollow = true,
  height,
  maxHeight = 320,
  maxLines = 1000,
  className,
  ...props
}: TerminalProps) {
  const { lines, parser, generation } = useAnsiLines(text);
  const [wrap, setWrap] = React.useState(defaultWrap);
  const [follow, setFollow] = React.useState(defaultFollow);
  const [cleared, setCleared] = React.useState({ generation: 0, at: 0 });
  const [showAll, setShowAll] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const scrollRef = React.useRef<HTMLElement>(null);

  const clearedAt = cleared.generation === generation ? cleared.at : 0;
  const visible = clearedAt > 0 ? lines.slice(clearedAt) : lines;
  const hidden = showAll ? 0 : Math.max(0, visible.length - maxLines);
  const shown = hidden > 0 ? visible.slice(hidden) : visible;

  const finished = !running && exitCode !== undefined && exitCode !== null;
  const failed = finished && exitCode !== 0;
  const empty = visible.length === 0;

  React.useLayoutEffect(() => {
    if (follow && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [follow, lines.length, text, wrap]);

  React.useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(t);
  }, [copied]);

  const handleCopy = () => {
    const plain =
      clearedAt > 0
        ? visible.map((line) => line.map((s) => s.text).join("")).join("\n")
        : parser.toPlainText();
    navigator.clipboard
      ?.writeText(plain)
      .then(() => setCopied(true))
      .catch(() => {});
  };

  const label = command ? `Output of ${command}` : typeof title === "string" ? title : "Runner terminal";

  return (
    <div
      data-ui="terminal"
      className={className ? `ps-terminal ${className}` : "ps-terminal"}
      {...props}
    >
      <div className="ps-terminal__header">
        {failed ? (
          <CircleX size={16} strokeWidth={1.5} className="ps-ansi-red" aria-hidden="true" />
        ) : (
          <SquareTerminal size={16} strokeWidth={1.5} className="ps-ansi-subtle" aria-hidden="true" />
        )}

        <div className="ps-terminal__title">
          {command ? (
            <code className="ps-terminal__cmd">
              <span className="ps-ansi-subtle" aria-hidden="true">
                $
              </span>
              <span className="ps-terminal__cmd-text">{command}</span>
            </code>
          ) : (
            <span>{title ?? "Terminal"}</span>
          )}
          {cwd ? <code className="ps-ansi-subtle">{cwd}</code> : null}
        </div>

        <div className="ps-terminal__meta">
          {running ? (
            <span>Running…</span>
          ) : finished ? (
            <>
              {typeof durationMs === "number" ? <span>{formatDuration(durationMs)}</span> : null}
              <span className={`ps-terminal__exit ${failed ? "is-fail" : "is-ok"}`}>
                {failed ? (
                  <CircleX size={14} strokeWidth={1.5} className="ps-ansi-red" aria-hidden="true" />
                ) : (
                  <CircleCheck size={14} strokeWidth={1.5} className="ps-ansi-green" aria-hidden="true" />
                )}
                <code>{`exit ${exitCode}`}</code>
              </span>
            </>
          ) : null}
        </div>

        <div className="ps-terminal__actions">
          <button
            type="button"
            className="ps-terminal__icon-btn"
            aria-label={wrap ? "Disable line wrapping" : "Wrap long lines"}
            aria-pressed={wrap}
            onClick={() => setWrap((w) => !w)}
            title={wrap ? "Disable wrap" : "Wrap lines"}
          >
            <WrapText size={16} strokeWidth={1.5} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="ps-terminal__icon-btn"
            aria-label="Follow output"
            aria-pressed={follow}
            disabled={!running}
            onClick={() => setFollow((f) => !f)}
            title="Follow output"
          >
            <ArrowDown size={16} strokeWidth={1.5} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="ps-terminal__icon-btn"
            aria-label="Clear output"
            disabled={empty}
            onClick={() => setCleared({ generation, at: lines.length })}
            title="Clear"
          >
            <Ban size={16} strokeWidth={1.5} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="ps-terminal__icon-btn"
            aria-label={copied ? "Copied output" : "Copy output"}
            disabled={empty}
            onClick={handleCopy}
            title="Copy"
          >
            {copied ? (
              <Check size={16} strokeWidth={1.5} aria-hidden="true" />
            ) : (
              <Copy size={16} strokeWidth={1.5} aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      <section
        ref={scrollRef}
        aria-label={label}
        tabIndex={0}
        style={{ height, maxHeight: height === undefined ? maxHeight : undefined }}
        className={`ps-terminal__body ${wrap ? "is-wrap" : "is-nowrap"}`}
      >
        {hidden > 0 ? (
          <button
            type="button"
            onClick={() => {
              setFollow(false);
              setShowAll(true);
            }}
            style={{
              background: "none",
              border: 0,
              padding: 0,
              marginBottom: 6,
              color: "var(--term-muted)",
              textDecoration: "underline",
              cursor: "pointer",
            }}
          >
            Show {hidden.toLocaleString()} earlier lines
          </button>
        ) : null}

        {empty ? (
          <div className="ps-ansi-subtle">
            {running ? "Waiting for runner output…" : clearedAt > 0 ? "Cleared" : "No output recorded."}
          </div>
        ) : (
          <pre className="ps-terminal__pre">
            {shown.map((line, i) => (
              <div key={clearedAt + hidden + i} className="ps-terminal__line">
                {line.length === 0
                  ? "\u00a0"
                  : line.map((span, j) => {
                      const cls = spanClass(span.style);
                      if (span.style.href && /^https?:\/\//.test(span.style.href)) {
                        return (
                          <a
                            key={j}
                            href={span.style.href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={cls}
                          >
                            {span.text}
                          </a>
                        );
                      }
                      return cls ? (
                        <span key={j} className={cls}>
                          {span.text}
                        </span>
                      ) : (
                        span.text
                      );
                    })}
              </div>
            ))}
          </pre>
        )}
      </section>
      <span aria-live="polite" className="visually-hidden">
        {copied ? "Copied terminal output" : ""}
      </span>
    </div>
  );
}

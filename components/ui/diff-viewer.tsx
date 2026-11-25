"use client";

import * as React from "react";
import { Check, Columns2, Copy, Rows2 } from "lucide-react";

/**
 * Adapted from 21st.dev `Diff Viewer` (id: 45484, author: aadixc0de).
 * Linear-space Myers diff engine + word-level token diff + Unified/Split viewer on [data-ui="diff-viewer"].
 */

export type DiffFileStatus = "added" | "modified" | "deleted" | "renamed";
export type DiffLineKind = "context" | "add" | "remove";
export type DiffView = "unified" | "split";

export interface DiffSegment {
  text: string;
  changed: boolean;
}

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
  oldNumber?: number;
  newNumber?: number;
  segments?: DiffSegment[];
}

export interface DiffHunk {
  id: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  heading?: string;
  lines: DiffLine[];
  additions: number;
  deletions: number;
}

export interface DiffFile {
  path: string;
  oldPath?: string;
  status: DiffFileStatus;
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
}

export interface DiffViewerProps {
  file?: DiffFile;
  patch?: string;
  oldText?: string;
  newText?: string;
  path?: string;
  oldPath?: string;
  defaultView?: DiffView;
  view?: DiffView;
  onViewChange?: (view: DiffView) => void;
  viewToggle?: boolean;
  wrap?: boolean;
  context?: number;
  maxHeight?: number;
  statusLabel?: string;
  className?: string;
}

const TOKEN = /\s+|[\p{L}\p{N}_$]+|[^\s\p{L}\p{N}_$]/gu;

function tokenize(text: string): string[] {
  return text.match(TOKEN) ?? [];
}

type DiffOpType = "equal" | "insert" | "delete";

interface DiffOp {
  type: DiffOpType;
  count: number;
}

function intern<T>(a: readonly T[], b: readonly T[]): [Int32Array, Int32Array] {
  const ids = new Map<T, number>();
  const map = (list: readonly T[]) => {
    const out = new Int32Array(list.length);
    for (let i = 0; i < list.length; i++) {
      const item = list[i] as T;
      let id = ids.get(item);
      if (id === undefined) {
        id = ids.size;
        ids.set(item, id);
      }
      out[i] = id;
    }
    return out;
  };
  return [map(a), map(b)];
}

class OpList {
  ops: DiffOp[] = [];
  push(type: DiffOpType, count: number) {
    if (count <= 0) return;
    const last = this.ops[this.ops.length - 1];
    if (last && last.type === type) last.count += count;
    else this.ops.push({ type, count });
  }
}

const DEFAULT_BUDGET = 20_000_000;

function bisect(
  a: Int32Array,
  aLo: number,
  aHi: number,
  b: Int32Array,
  bLo: number,
  bHi: number,
  out: OpList,
  state: { budget: number }
) {
  const n = aHi - aLo;
  const m = bHi - bLo;
  const maxD = Math.ceil((n + m) / 2);
  const offset = maxD;
  const size = 2 * maxD + 2;
  const v1 = new Int32Array(size).fill(-1);
  const v2 = new Int32Array(size).fill(-1);
  v1[offset + 1] = 0;
  v2[offset + 1] = 0;
  const delta = n - m;
  const front = delta % 2 !== 0;
  let k1start = 0;
  let k1end = 0;
  let k2start = 0;
  let k2end = 0;

  for (let d = 0; d < maxD; d++) {
    if (state.budget <= 0) break;
    for (let k1 = -d + k1start; k1 <= d - k1end; k1 += 2) {
      const k1o = offset + k1;
      let x1 =
        k1 === -d || (k1 !== d && (v1[k1o - 1] as number) < (v1[k1o + 1] as number))
          ? (v1[k1o + 1] as number)
          : (v1[k1o - 1] as number) + 1;
      let y1 = x1 - k1;
      const from1 = x1;
      while (x1 < n && y1 < m && a[aLo + x1] === b[bLo + y1]) {
        x1++;
        y1++;
      }
      state.budget -= x1 - from1 + 1;
      v1[k1o] = x1;
      if (x1 > n) k1end += 2;
      else if (y1 > m) k1start += 2;
      else if (front) {
        const k2o = offset + delta - k1;
        if (k2o >= 0 && k2o < size && v2[k2o] !== -1) {
          const x2 = n - (v2[k2o] as number);
          if (x1 >= x2) {
            diffRange(a, aLo, aLo + x1, b, bLo, bLo + y1, out, state);
            diffRange(a, aLo + x1, aHi, b, bLo + y1, bHi, out, state);
            return;
          }
        }
      }
    }
    for (let k2 = -d + k2start; k2 <= d - k2end; k2 += 2) {
      const k2o = offset + k2;
      let x2 =
        k2 === -d || (k2 !== d && (v2[k2o - 1] as number) < (v2[k2o + 1] as number))
          ? (v2[k2o + 1] as number)
          : (v2[k2o - 1] as number) + 1;
      let y2 = x2 - k2;
      const from2 = x2;
      while (x2 < n && y2 < m && a[aHi - 1 - x2] === b[bHi - 1 - y2]) {
        x2++;
        y2++;
      }
      state.budget -= x2 - from2 + 1;
      v2[k2o] = x2;
      if (x2 > n) k2end += 2;
      else if (y2 > m) k2start += 2;
      else if (!front) {
        const k1o = offset + delta - k2;
        if (k1o >= 0 && k1o < size && v1[k1o] !== -1) {
          const x1 = v1[k1o] as number;
          const y1 = offset + x1 - k1o;
          if (x1 >= n - x2) {
            diffRange(a, aLo, aLo + x1, b, bLo, bLo + y1, out, state);
            diffRange(a, aLo + x1, aHi, b, bLo + y1, bHi, out, state);
            return;
          }
        }
      }
    }
  }
  out.push("delete", n);
  out.push("insert", m);
}

function diffRange(
  a: Int32Array,
  aLo: number,
  aHi: number,
  b: Int32Array,
  bLo: number,
  bHi: number,
  out: OpList,
  state: { budget: number }
) {
  let prefix = 0;
  while (aLo + prefix < aHi && bLo + prefix < bHi && a[aLo + prefix] === b[bLo + prefix]) prefix++;
  out.push("equal", prefix);
  aLo += prefix;
  bLo += prefix;

  let suffix = 0;
  while (aHi - suffix > aLo && bHi - suffix > bLo && a[aHi - 1 - suffix] === b[bHi - 1 - suffix]) {
    suffix++;
  }
  aHi -= suffix;
  bHi -= suffix;

  if (aLo === aHi) out.push("insert", bHi - bLo);
  else if (bLo === bHi) out.push("delete", aHi - aLo);
  else bisect(a, aLo, aHi, b, bLo, bHi, out, state);

  out.push("equal", suffix);
}

function normalize(ops: DiffOp[]): DiffOp[] {
  const out = new OpList();
  let del = 0;
  let ins = 0;
  const flush = () => {
    out.push("delete", del);
    out.push("insert", ins);
    del = 0;
    ins = 0;
  };
  for (const op of ops) {
    if (op.type === "equal") {
      flush();
      out.push("equal", op.count);
    } else if (op.type === "delete") del += op.count;
    else ins += op.count;
  }
  flush();
  return out.ops;
}

function myersDiff<T>(a: readonly T[], b: readonly T[], options: { budget?: number } = {}): DiffOp[] {
  const [x, y] = intern(a, b);
  const out = new OpList();
  const state = { budget: options.budget ?? DEFAULT_BUDGET };
  diffRange(x, 0, x.length, y, 0, y.length, out, state);
  return normalize(out.ops);
}

const MIN_SIMILARITY = 0.4;

function diffWords(oldLine: string, newLine: string): { old: DiffSegment[]; new: DiffSegment[] } | null {
  if (oldLine === newLine) return null;
  const a = tokenize(oldLine);
  const b = tokenize(newLine);
  const ops = myersDiff(a, b, { budget: 200_000 });

  type Piece = { type: DiffOpType; old: string; new: string };
  const pieces: Piece[] = [];
  let i = 0;
  let j = 0;
  for (const op of ops) {
    const oldText = op.type === "insert" ? "" : a.slice(i, i + op.count).join("");
    const newText = op.type === "delete" ? "" : b.slice(j, j + op.count).join("");
    if (op.type !== "insert") i += op.count;
    if (op.type !== "delete") j += op.count;
    pieces.push({ type: op.type, old: oldText, new: newText });
  }

  let same = 0;
  for (const piece of pieces) if (piece.type === "equal") same += piece.old.trim().length;
  const longest = Math.max(oldLine.trim().length, newLine.trim().length, 1);
  if (same / longest < MIN_SIMILARITY) return null;

  const toSegments = (side: "old" | "new") => {
    const segments: DiffSegment[] = [];
    for (const piece of pieces) {
      const text = piece[side];
      if (!text) continue;
      const changed = piece.type !== "equal";
      const last = segments[segments.length - 1];
      if (last && last.changed === changed) last.text += text;
      else segments.push({ text, changed });
    }
    const merged: DiffSegment[] = [];
    for (let k = 0; k < segments.length; k++) {
      const seg = segments[k] as DiffSegment;
      const prev = merged[merged.length - 1];
      const next = segments[k + 1];
      const short = seg.text.trim() === "" || seg.text.length === 1;
      if (!seg.changed && short && prev?.changed && next?.changed) {
        prev.text += seg.text + next.text;
        k++;
      } else if (prev && prev.changed === seg.changed) prev.text += seg.text;
      else merged.push({ ...seg });
    }
    return merged;
  };
  return { old: toSegments("old"), new: toSegments("new") };
}

function refineWords(lines: DiffLine[]): DiffLine[] {
  let i = 0;
  while (i < lines.length) {
    if (lines[i]?.kind !== "remove") {
      i++;
      continue;
    }
    const removeStart = i;
    while (lines[i]?.kind === "remove") i++;
    const addStart = i;
    while (lines[i]?.kind === "add") i++;
    const pairs = Math.min(addStart - removeStart, i - addStart);
    for (let p = 0; p < pairs; p++) {
      const removed = lines[removeStart + p] as DiffLine;
      const added = lines[addStart + p] as DiffLine;
      const words = diffWords(removed.text, added.text);
      if (words) {
        removed.segments = words.old;
        added.segments = words.new;
      }
    }
  }
  return lines;
}

function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines.map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
}

function countChanges(lines: DiffLine[]) {
  let additions = 0;
  let deletions = 0;
  for (const line of lines) {
    if (line.kind === "add") additions++;
    else if (line.kind === "remove") deletions++;
  }
  return { additions, deletions };
}

function makeHunk(lines: DiffLine[], oldBefore: number, newBefore: number, heading?: string): DiffHunk {
  let oldLines = 0;
  let newLines = 0;
  for (const line of lines) {
    if (line.oldNumber !== undefined) oldLines++;
    if (line.newNumber !== undefined) newLines++;
  }
  const oldStart = oldLines ? oldBefore + 1 : oldBefore;
  const newStart = newLines ? newBefore + 1 : newBefore;
  const { additions, deletions } = countChanges(lines);
  return {
    id: `h-${oldStart}-${newStart}`,
    oldStart,
    oldLines,
    newStart,
    newLines,
    ...(heading ? { heading } : {}),
    lines,
    additions,
    deletions,
  };
}

export function diffText(
  oldText: string,
  newText: string,
  options: { path?: string; oldPath?: string; context?: number } = {}
): DiffFile {
  const { context = 3 } = options;
  const a = splitLines(oldText);
  const b = splitLines(newText);
  const ops = myersDiff(a, b);

  const all: DiffLine[] = [];
  const cursors: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  for (const op of ops) {
    for (let c = 0; c < op.count; c++) {
      cursors.push([i, j]);
      if (op.type === "equal") {
        all.push({ kind: "context", text: b[j] as string, oldNumber: i + 1, newNumber: j + 1 });
        i++;
        j++;
      } else if (op.type === "delete") {
        all.push({ kind: "remove", text: a[i] as string, oldNumber: i + 1 });
        i++;
      } else {
        all.push({ kind: "add", text: b[j] as string, newNumber: j + 1 });
        j++;
      }
    }
  }

  const hunks: DiffHunk[] = [];
  let k = 0;
  while (k < all.length) {
    if (all[k]?.kind === "context") {
      k++;
      continue;
    }
    const start = Math.max(0, k - context);
    let end = k;
    let lastChange = k;
    while (end < all.length) {
      if (all[end]?.kind !== "context") lastChange = end;
      else if (end - lastChange > context * 2) break;
      end++;
    }
    const stop = Math.min(all.length, lastChange + context + 1);
    const lines = refineWords(all.slice(start, stop));
    const [oldBefore, newBefore] = cursors[start] as [number, number];
    hunks.push(makeHunk(lines, oldBefore, newBefore));
    k = stop;
  }

  const totals = countChanges(all);
  const status: DiffFileStatus =
    options.oldPath && options.path && options.oldPath !== options.path
      ? "renamed"
      : oldText === "" && newText !== ""
        ? "added"
        : newText === "" && oldText !== ""
          ? "deleted"
          : "modified";

  return {
    path: options.path ?? "",
    ...(options.oldPath && options.oldPath !== options.path ? { oldPath: options.oldPath } : {}),
    status,
    hunks,
    additions: totals.additions,
    deletions: totals.deletions,
  };
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;

function stripPrefix(path: string) {
  const clean = path.replace(/\t.*$/, "").trim();
  if (clean === "/dev/null") return undefined;
  return clean.replace(/^"(.*)"$/, "$1").replace(/^[ab]\//, "");
}

export function parsePatch(text: string, options: { path?: string } = {}): DiffFile[] {
  const rows = text.split("\n");
  if (rows[rows.length - 1] === "") rows.pop();
  const files: Array<{
    path: string;
    oldPath?: string;
    status?: DiffFileStatus;
    hunks: DiffHunk[];
    oldNum: number;
    newNum: number;
  }> = [];
  let cur: (typeof files)[number] | undefined;
  let openHunk: DiffHunk | undefined;

  const ensureFile = (p = options.path ?? "patch.diff"): (typeof files)[number] => {
    const entry: (typeof files)[number] = { path: p, hunks: [], oldNum: 1, newNum: 1 };
    files.push(entry);
    cur = entry;
    openHunk = undefined;
    return entry;
  };

  for (let r = 0; r < rows.length; r++) {
    const line = (rows[r] ?? "").replace(/\r$/, "");
    if (line.startsWith("diff --git ")) {
      const m = /^diff --git "?a\/(.+?)"? "?b\/(.+?)"?$/.exec(line);
      const entry = ensureFile(m?.[2] ?? options.path ?? "patch.diff");
      if (m?.[1] && m[2] && m[1] !== m[2]) entry.oldPath = m[1];
      continue;
    }
    if (line.startsWith("--- ") && rows[r + 1]?.startsWith("+++ ")) {
      const entry = cur && cur.hunks.length === 0 ? cur : ensureFile();
      const from = stripPrefix(line.slice(4));
      const to = stripPrefix((rows[r + 1] ?? "").slice(4));
      if (!from) entry.status = "added";
      if (!to) entry.status = "deleted";
      entry.path = to ?? from ?? entry.path;
      if (from && to && from !== to) entry.oldPath = from;
      r++;
      continue;
    }
    const hm = HUNK_HEADER.exec(line);
    if (hm) {
      const entry = cur ?? ensureFile();
      const oldStart = Number(hm[1]);
      const oldLines = hm[2] === undefined ? 1 : Number(hm[2]);
      const newStart = Number(hm[3]);
      const newLines = hm[4] === undefined ? 1 : Number(hm[4]);
      openHunk = {
        id: `h-${oldStart}-${newStart}`,
        oldStart,
        oldLines,
        newStart,
        newLines,
        heading: hm[5]?.trim() || undefined,
        lines: [],
        additions: 0,
        deletions: 0,
      };
      entry.hunks.push(openHunk);
      entry.oldNum = oldLines === 0 ? oldStart + 1 : oldStart;
      entry.newNum = newLines === 0 ? newStart + 1 : newStart;
      continue;
    }
    if (/^[+\- ]/.test(line)) {
      const entry = cur ?? ensureFile();
      if (!openHunk) {
        openHunk = {
          id: "h-1-1",
          oldStart: 1,
          oldLines: 0,
          newStart: 1,
          newLines: 0,
          lines: [],
          additions: 0,
          deletions: 0,
        };
        entry.hunks.push(openHunk);
      }
      const sign = line[0];
      const body = line.slice(1);
      if (sign === "+") {
        openHunk.lines.push({ kind: "add", text: body, newNumber: entry.newNum++ });
      } else if (sign === "-") {
        openHunk.lines.push({ kind: "remove", text: body, oldNumber: entry.oldNum++ });
      } else {
        openHunk.lines.push({
          kind: "context",
          text: body,
          oldNumber: entry.oldNum++,
          newNumber: entry.newNum++,
        });
      }
    }
  }

  return files.map((f) => {
    const hunks = f.hunks.map((h) => {
      refineWords(h.lines);
      return { ...h, ...countChanges(h.lines) };
    });
    const additions = hunks.reduce((s, h) => s + h.additions, 0);
    const deletions = hunks.reduce((s, h) => s + h.deletions, 0);
    return {
      path: f.path,
      oldPath: f.oldPath,
      status: f.status ?? "modified",
      hunks,
      additions,
      deletions,
    };
  });
}

function buildSplitRows(lines: DiffLine[]) {
  const rows: Array<{ left?: DiffLine; right?: DiffLine }> = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line) break;
    if (line.kind === "context") {
      rows.push({ left: line, right: line });
      i++;
      continue;
    }
    const removes: DiffLine[] = [];
    while (lines[i]?.kind === "remove") {
      removes.push(lines[i] as DiffLine);
      i++;
    }
    const adds: DiffLine[] = [];
    while (lines[i]?.kind === "add") {
      adds.push(lines[i] as DiffLine);
      i++;
    }
    const maxLen = Math.max(removes.length, adds.length);
    for (let k = 0; k < maxLen; k++) {
      rows.push({ left: removes[k], right: adds[k] });
    }
  }
  return rows;
}

function renderLineSegments(line: DiffLine) {
  if (!line.segments || line.segments.length === 0) {
    return line.text || " ";
  }
  return line.segments.map((seg, idx) =>
    seg.changed ? (
      <mark
        key={idx}
        className={line.kind === "add" ? "ps-diff__word-add" : "ps-diff__word-del"}
      >
        {seg.text}
      </mark>
    ) : (
      <React.Fragment key={idx}>{seg.text}</React.Fragment>
    )
  );
}

export function DiffViewer({
  file: fileProp,
  patch,
  oldText = "",
  newText = "",
  path = "file.ts",
  oldPath,
  defaultView = "unified",
  view: viewProp,
  onViewChange,
  viewToggle = true,
  wrap = true,
  context = 3,
  maxHeight,
  statusLabel,
  className,
}: DiffViewerProps) {
  const [internalView, setInternalView] = React.useState<DiffView>(defaultView);
  const [copied, setCopied] = React.useState(false);

  const activeView = viewProp ?? internalView;
  const setView = (next: DiffView) => {
    if (viewProp === undefined) setInternalView(next);
    onViewChange?.(next);
  };

  const diffFile = React.useMemo<DiffFile>(() => {
    if (fileProp) return fileProp;
    if (patch !== undefined) {
      return parsePatch(patch, { path })[0] ?? diffText("", "", { path });
    }
    return diffText(oldText, newText, { path, oldPath, context });
  }, [fileProp, patch, oldText, newText, path, oldPath, context]);

  const rawTextForCopy = React.useMemo(() => {
    if (patch) return patch;
    if (newText) return newText;
    return diffFile.hunks
      .flatMap((h) => h.lines.map((l) => `${l.kind === "add" ? "+" : l.kind === "remove" ? "-" : " "}${l.text}`))
      .join("\n");
  }, [patch, newText, diffFile]);

  const handleCopy = () => {
    navigator.clipboard
      ?.writeText(rawTextForCopy)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1400);
      })
      .catch(() => {});
  };

  return (
    <div
      data-ui="diff-viewer"
      data-wrap={wrap ? "true" : "false"}
      className={className ? `ps-diff ${className}` : "ps-diff"}
    >
      <div className="ps-diff__header">
        <div className="ps-diff__meta">
          <span className="ps-diff__path mono" title={diffFile.path}>
            {diffFile.oldPath ? `${diffFile.oldPath} -> ${diffFile.path}` : diffFile.path}
          </span>
          {statusLabel ? <span className="ps-diff__status">{statusLabel}</span> : null}
          <span className="ps-diff__stats num">
            <span className="ps-diff__stat-add">+{diffFile.additions}</span>
            <span className="ps-diff__stat-del">-{diffFile.deletions}</span>
          </span>
        </div>

        <div className="ps-diff__controls">
          {viewToggle ? (
            <div className="ps-diff__switcher" role="group" aria-label="Diff layout view">
              <button
                type="button"
                className="ps-diff__mode-btn"
                aria-pressed={activeView === "unified"}
                onClick={() => setView("unified")}
              >
                <Rows2 size={14} strokeWidth={1.5} aria-hidden="true" />
                <span>Unified</span>
              </button>
              <button
                type="button"
                className="ps-diff__mode-btn"
                aria-pressed={activeView === "split"}
                onClick={() => setView("split")}
              >
                <Columns2 size={14} strokeWidth={1.5} aria-hidden="true" />
                <span>Split</span>
              </button>
            </div>
          ) : null}

          <button
            type="button"
            className="ps-diff__copy-btn"
            aria-label={copied ? "Copied diff" : "Copy diff"}
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
        className="ps-diff__body"
        style={maxHeight ? { maxHeight: `${maxHeight}px` } : undefined}
      >
        {diffFile.hunks.length === 0 ? (
          <div className="ps-diff__empty">No changes detected between compared files.</div>
        ) : (
          diffFile.hunks.map((hunk) => (
            <div key={hunk.id} className="ps-diff__hunk">
              <div className="ps-diff__hunk-head mono num">
                <span>{`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`}</span>
                {hunk.heading ? <span className="ps-diff__hunk-fn">{hunk.heading}</span> : null}
              </div>

              {activeView === "unified" ? (
                <div className="ps-diff__lines">
                  {hunk.lines.map((line, li) => (
                    <div key={li} className={`ps-diff__row is-${line.kind}`}>
                      <span className="ps-diff__ln num">{line.oldNumber ?? ""}</span>
                      <span className="ps-diff__ln num">{line.newNumber ?? ""}</span>
                      <span className="ps-diff__sign mono">
                        {line.kind === "add" ? "+" : line.kind === "remove" ? "-" : " "}
                      </span>
                      <code className="ps-diff__code mono">{renderLineSegments(line)}</code>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="ps-diff__split">
                  {buildSplitRows(hunk.lines).map((pair, pi) => (
                    <div key={pi} className="ps-diff__split-row">
                      <div
                        className={`ps-diff__split-cell ${
                          pair.left ? `is-${pair.left.kind}` : "is-empty"
                        }`}
                      >
                        <span className="ps-diff__ln num">{pair.left?.oldNumber ?? ""}</span>
                        <span className="ps-diff__sign mono">
                          {pair.left?.kind === "remove" ? "-" : " "}
                        </span>
                        <code className="ps-diff__code mono">
                          {pair.left ? renderLineSegments(pair.left) : ""}
                        </code>
                      </div>
                      <div
                        className={`ps-diff__split-cell ${
                          pair.right ? `is-${pair.right.kind}` : "is-empty"
                        }`}
                      >
                        <span className="ps-diff__ln num">{pair.right?.newNumber ?? ""}</span>
                        <span className="ps-diff__sign mono">
                          {pair.right?.kind === "add" ? "+" : " "}
                        </span>
                        <code className="ps-diff__code mono">
                          {pair.right ? renderLineSegments(pair.right) : ""}
                        </code>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

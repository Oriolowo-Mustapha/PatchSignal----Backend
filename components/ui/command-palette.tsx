"use client";

import * as React from "react";
import { CornerDownLeft, Search, X } from "lucide-react";

/**
 * Adapted from 21st.dev `Command Palette` (id: 45520, author: aadixc0de).
 * Rebuilt as a zero-dependency native <dialog> palette bound to Midnight Black / Pure White / Lime tokens.
 */

export interface CommandPaletteItem {
  id: string;
  group: string;
  label: string;
  subtitle?: string;
  keywords?: string[];
  icon?: React.ReactNode;
  shortcut?: string;
  badge?: string;
  disabled?: boolean;
  onSelect: () => void;
}

export interface CommandPaletteGroupMeta {
  id: string;
  label: string;
}

export interface CommandPaletteTriggerProps extends React.ComponentProps<"button"> {
  hotkey?: string | null;
  children?: React.ReactNode;
}

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: CommandPaletteItem[];
  groups?: CommandPaletteGroupMeta[];
  placeholder?: string;
  label?: string;
  emptyText?: string;
  enableGlobalHotkey?: boolean;
}

function noopSubscribe() {
  return () => {};
}

function isApplePlatform() {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = nav.userAgentData?.platform ?? nav.platform ?? "";
  return /mac|iphone|ipad|ipod/i.test(platform);
}

function useApplePlatform() {
  return React.useSyncExternalStore(noopSubscribe, isApplePlatform, () => false);
}

type MatchRange = readonly [start: number, end: number];

const WORD_BREAK = /[\s\-_/.:,()[\]]/;

function fold(text: string) {
  const lower = text.toLowerCase();
  const stripped = lower.normalize("NFD").replace(/\p{M}/gu, "");
  return stripped.length === lower.length ? stripped : lower;
}

function mergeRanges(ranges: MatchRange[]): MatchRange[] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}

function fuzzyMatch(query: string, text: string): { score: number; ranges: MatchRange[] } | null {
  const q = fold(query.trim());
  if (!q) return { score: 0, ranges: [] };
  const t = fold(text);

  let best = -1;
  for (let i = t.indexOf(q); i !== -1; i = t.indexOf(q, i + 1)) {
    if (best === -1) best = i;
    if (i === 0 || WORD_BREAK.test(t[i - 1] ?? "")) {
      best = i;
      break;
    }
  }
  if (best !== -1) {
    const atStart = best === 0 || WORD_BREAK.test(t[best - 1] ?? "");
    return {
      score: 1000 + (atStart ? 200 : 0) - best - (t.length - q.length) * 0.5,
      ranges: [[best, best + q.length]],
    };
  }

  const words = q.split(/\s+/).filter(Boolean);
  if (words.length > 1) {
    const ranges: MatchRange[] = [];
    for (const word of words) {
      const at = t.indexOf(word);
      if (at === -1) {
        ranges.length = 0;
        break;
      }
      ranges.push([at, at + word.length]);
    }
    if (ranges.length > 0) {
      return { score: 600 - (t.length - q.length) * 0.5, ranges: mergeRanges(ranges) };
    }
  }

  const needle = q.replace(/\s+/g, "");
  const ranges: [number, number][] = [];
  let score = 0;
  let ti = 0;
  let prev = -2;
  for (const ch of needle) {
    let found = prev === ti - 1 && t[ti] === ch ? ti : -1;
    for (let j = ti; found !== ti && j < t.length; j++) {
      if (t[j] !== ch) continue;
      if (found === -1) found = j;
      if (j === 0 || WORD_BREAK.test(t[j - 1] ?? "")) {
        found = j;
        break;
      }
    }
    if (found === -1) return null;
    const wordStart = found === 0 || WORD_BREAK.test(t[found - 1] ?? "");
    score += wordStart ? 12 : 1;
    if (found === prev + 1) {
      score += 6;
      const last = ranges[ranges.length - 1];
      if (last) last[1] = found + 1;
    } else {
      score -= Math.min(found - ti, 8) * 0.5;
      ranges.push([found, found + 1]);
    }
    prev = found;
    ti = found + 1;
  }

  const strays = ranges.filter(
    ([start, end]) => end - start === 1 && start > 0 && !WORD_BREAK.test(t[start - 1] ?? "")
  ).length;
  if (strays > 1) return null;

  return { score: score - t.length * 0.05, ranges };
}

function Emphasis({ text, ranges }: { text: string; ranges: readonly MatchRange[] }) {
  if (!ranges.length) return <>{text}</>;
  const segments: { text: string; match: boolean }[] = [];
  let at = 0;
  for (const [s, e] of ranges) {
    if (s > at) segments.push({ text: text.slice(at, s), match: false });
    if (e > s) segments.push({ text: text.slice(s, e), match: true });
    at = Math.max(at, e);
  }
  if (at < text.length) segments.push({ text: text.slice(at), match: false });

  return (
    <>
      {segments.map((seg, i) =>
        seg.match ? (
          <mark key={i} className="ps-cmd-mark">
            {seg.text}
          </mark>
        ) : (
          <span key={i}>{seg.text}</span>
        )
      )}
    </>
  );
}

export function CommandPaletteTrigger({
  hotkey = "mod+k",
  className,
  children = "Jump to…",
  ...props
}: CommandPaletteTriggerProps) {
  const apple = useApplePlatform();
  const keys = hotkey === "mod+k" ? [apple ? "⌘" : "Ctrl", "K"] : hotkey ? [hotkey] : [];

  return (
    <button
      type="button"
      data-ui="command-palette-trigger"
      aria-keyshortcuts={hotkey === "mod+k" ? "Meta+K Control+K" : undefined}
      className={className ? `ps-cmd-trigger ${className}` : "ps-cmd-trigger"}
      {...props}
    >
      <Search size={14} strokeWidth={1.5} aria-hidden="true" className="ps-cmd-trigger__icon" />
      <span className="ps-cmd-trigger__label">{children}</span>
      {keys.length > 0 ? (
        <span className="ps-cmd-trigger__keys" aria-hidden="true">
          {keys.map((k) => (
            <kbd key={k} className="ps-kbd">
              {k}
            </kbd>
          ))}
        </span>
      ) : null}
    </button>
  );
}

export function CommandPalette({
  open,
  onOpenChange,
  items,
  groups = [],
  placeholder = "Search views, actions, or endpoints…",
  label = "Command palette",
  emptyText = "No matching commands found.",
  enableGlobalHotkey = true,
}: CommandPaletteProps) {
  const dialogRef = React.useRef<HTMLDialogElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [query, setQuery] = React.useState("");
  const [activeIndex, setActiveIndex] = React.useState(0);
  const baseId = React.useId();
  const listboxId = `${baseId}-listbox`;

  React.useEffect(() => {
    if (!enableGlobalHotkey) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enableGlobalHotkey, open, onOpenChange]);

  React.useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setQuery("");
      setActiveIndex(0);
      dialog.showModal();
      window.requestAnimationFrame(() => inputRef.current?.focus());
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  React.useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleClose = () => {
      onOpenChange(false);
    };
    const handleClick = (event: MouseEvent) => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      const inside =
        rect.top <= event.clientY &&
        event.clientY <= rect.top + rect.height &&
        rect.left <= event.clientX &&
        event.clientX <= rect.left + rect.width;
      if (!inside) dialog.close();
    };
    dialog.addEventListener("close", handleClose);
    dialog.addEventListener("click", handleClick);
    return () => {
      dialog.removeEventListener("close", handleClose);
      dialog.removeEventListener("click", handleClick);
    };
  }, [onOpenChange]);

  const ranked = React.useMemo(() => {
    const q = query.trim();
    if (!q) {
      return items.map((item) => ({ item, score: 0, ranges: [] as MatchRange[] }));
    }
    const matches: Array<{ item: CommandPaletteItem; score: number; ranges: MatchRange[]; idx: number }> = [];
    items.forEach((item, idx) => {
      const labelHit = fuzzyMatch(q, item.label);
      const subHit = !labelHit && item.subtitle ? fuzzyMatch(q, item.subtitle) : null;
      const kwString = item.keywords?.join(" ") ?? "";
      const kwHit = !labelHit && !subHit && kwString ? fuzzyMatch(q, kwString) : null;
      if (labelHit) {
        matches.push({ item, score: labelHit.score, ranges: labelHit.ranges, idx });
      } else if (subHit) {
        matches.push({ item, score: subHit.score * 0.7, ranges: [], idx });
      } else if (kwHit) {
        matches.push({ item, score: kwHit.score * 0.55, ranges: [], idx });
      }
    });
    return matches
      .sort((a, b) => b.score - a.score || a.idx - b.idx)
      .map(({ idx: _idx, ...rest }) => rest);
  }, [items, query]);

  const grouped = React.useMemo(() => {
    const metaMap = new Map(groups.map((g, order) => [g.id, { label: g.label, order }]));
    const buckets = new Map<
      string,
      { id: string; label: string; order: number; best: number; rows: typeof ranked }
    >();
    let seq = groups.length;
    for (const row of ranked) {
      const key = row.item.group || "Actions";
      let bucket = buckets.get(key);
      if (!bucket) {
        const meta = metaMap.get(key);
        bucket = {
          id: key,
          label: meta?.label ?? key,
          order: meta ? meta.order : seq++,
          best: row.score,
          rows: [],
        };
        buckets.set(key, bucket);
      }
      bucket.rows.push(row);
    }
    const searching = query.trim().length > 0;
    return [...buckets.values()].sort((a, b) =>
      searching ? b.best - a.best || a.order - b.order : a.order - b.order
    );
  }, [ranked, groups, query]);

  const flatRows = React.useMemo(() => grouped.flatMap((g) => g.rows), [grouped]);
  const enabledIndexes = React.useMemo(
    () => flatRows.map((r, i) => (r.item.disabled ? -1 : i)).filter((i) => i !== -1),
    [flatRows]
  );

  const safeActive = enabledIndexes.includes(activeIndex)
    ? activeIndex
    : (enabledIndexes[0] ?? -1);

  const optionId = (idx: number) => `${baseId}-opt-${idx}`;

  const runItem = (item: CommandPaletteItem) => {
    if (item.disabled) return;
    onOpenChange(false);
    item.onSelect();
  };

  const moveCursor = (nextIdx: number) => {
    setActiveIndex(nextIdx);
    const el = document.getElementById(optionId(nextIdx));
    el?.scrollIntoView({ block: "nearest" });
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    const ctrlOnly = e.ctrlKey && !e.metaKey && !e.altKey;
    if (e.key === "ArrowDown" || (ctrlOnly && e.key === "n")) {
      e.preventDefault();
      if (!enabledIndexes.length) return;
      const at = enabledIndexes.indexOf(safeActive);
      const next = enabledIndexes[(at + 1) % enabledIndexes.length];
      if (next !== undefined) moveCursor(next);
    } else if (e.key === "ArrowUp" || (ctrlOnly && e.key === "p")) {
      e.preventDefault();
      if (!enabledIndexes.length) return;
      const at = enabledIndexes.indexOf(safeActive);
      const next = enabledIndexes[(at - 1 + enabledIndexes.length) % enabledIndexes.length];
      if (next !== undefined) moveCursor(next);
    } else if (e.key === "Home") {
      e.preventDefault();
      if (enabledIndexes[0] !== undefined) moveCursor(enabledIndexes[0]);
    } else if (e.key === "End") {
      e.preventDefault();
      const last = enabledIndexes[enabledIndexes.length - 1];
      if (last !== undefined) moveCursor(last);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = safeActive >= 0 ? flatRows[safeActive]?.item : undefined;
      if (hit) runItem(hit);
    }
  };

  let flatCursor = -1;

  return (
    <dialog
      ref={dialogRef}
      data-ui="command-palette"
      className="ps-cmd-dialog"
      aria-label={label}
      {...({ closedby: "any" } as Record<string, string>)}
    >
      <div className="ps-cmd-head">
        <Search size={16} strokeWidth={1.5} aria-hidden="true" className="ps-cmd-head__icon" />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={safeActive >= 0 ? optionId(safeActive) : undefined}
          aria-label={label}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          className="ps-cmd-input"
          placeholder={placeholder}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={handleInputKeyDown}
        />
        {query ? (
          <button
            type="button"
            className="ps-cmd-clear"
            aria-label="Clear search"
            onClick={() => {
              setQuery("");
              setActiveIndex(0);
              inputRef.current?.focus();
            }}
          >
            <X size={14} strokeWidth={1.5} aria-hidden="true" />
          </button>
        ) : (
          <button
            type="button"
            className="ps-cmd-clear"
            aria-label="Close command palette"
            onClick={() => onOpenChange(false)}
          >
            <X size={14} strokeWidth={1.5} aria-hidden="true" />
          </button>
        )}
      </div>

      <div id={listboxId} role="listbox" aria-label="Commands" className="ps-cmd-list">
        {flatRows.length === 0 ? (
          <div className="ps-cmd-empty">{emptyText}</div>
        ) : (
          grouped.map((group) => (
            <div key={group.id} role="group" aria-label={group.label} className="ps-cmd-group">
              <div className="ps-cmd-group__label">{group.label}</div>
              {group.rows.map((row) => {
                flatCursor += 1;
                const rowIdx = flatCursor;
                const isActive = rowIdx === safeActive;
                return (
                  <button
                    key={row.item.id}
                    id={optionId(rowIdx)}
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    disabled={row.item.disabled}
                    data-active={isActive ? "true" : undefined}
                    className="ps-cmd-row"
                    onMouseEnter={() => {
                      if (!row.item.disabled) setActiveIndex(rowIdx);
                    }}
                    onClick={() => runItem(row.item)}
                  >
                    <span className="ps-cmd-row__left">
                      {row.item.icon ? (
                        <span className="ps-cmd-row__icon" aria-hidden="true">
                          {row.item.icon}
                        </span>
                      ) : null}
                      <span className="ps-cmd-row__text">
                        <span className="ps-cmd-row__title">
                          <Emphasis text={row.item.label} ranges={row.ranges} />
                        </span>
                        {row.item.subtitle ? (
                          <span className="ps-cmd-row__sub">{row.item.subtitle}</span>
                        ) : null}
                      </span>
                    </span>
                    <span className="ps-cmd-row__right">
                      {row.item.badge ? <span className="ps-cmd-badge">{row.item.badge}</span> : null}
                      {row.item.shortcut ? (
                        <kbd className="ps-kbd">{row.item.shortcut}</kbd>
                      ) : isActive ? (
                        <CornerDownLeft size={14} strokeWidth={1.5} aria-hidden="true" />
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>

      <div className="ps-cmd-foot">
        <span className="ps-cmd-hint">
          <kbd className="ps-kbd">↑↓</kbd>
          <span>Navigate</span>
        </span>
        <span className="ps-cmd-hint">
          <kbd className="ps-kbd">↵</kbd>
          <span>Select</span>
        </span>
        <span className="ps-cmd-hint">
          <kbd className="ps-kbd">Esc</kbd>
          <span>Close</span>
        </span>
      </div>
    </dialog>
  );
}

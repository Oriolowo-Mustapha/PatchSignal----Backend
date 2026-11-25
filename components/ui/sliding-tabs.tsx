"use client";

import * as React from "react";

/**
 * Inspired by 21st.dev `Animated Tabs` (id: 24930) & `Vercel Tabs`.
 * Tracks the active item bounds with ResizeObserver to glide a solid indicator on [data-ui="sliding-tabs"].
 */

export interface SlidingTabItem<T extends string = string> {
  id: T;
  label: string;
  count?: number;
  icon?: React.ReactNode;
  codeHint?: string;
}

export interface SlidingTabsProps<T extends string = string> {
  items: ReadonlyArray<SlidingTabItem<T>>;
  value: T;
  onChange: (next: T) => void;
  ariaLabel: string;
  variant?: "pill" | "underline";
  mode?: "tablist" | "group";
  tabIdPrefix?: string;
  fullWidth?: boolean;
  className?: string;
}

export function SlidingTabs<T extends string = string>({
  items,
  value,
  onChange,
  ariaLabel,
  variant = "pill",
  mode = "group",
  tabIdPrefix,
  fullWidth = false,
  className,
}: SlidingTabsProps<T>) {
  const trackRef = React.useRef<HTMLDivElement>(null);
  const btnRefs = React.useRef<Record<string, HTMLButtonElement | null>>({});
  const [indicator, setIndicator] = React.useState<{ x: number; w: number; ready: boolean }>({
    x: 0,
    w: 0,
    ready: false,
  });

  const measure = React.useCallback(() => {
    const activeEl = btnRefs.current[value];
    if (!activeEl) return;
    setIndicator({
      x: activeEl.offsetLeft,
      w: activeEl.offsetWidth,
      ready: true,
    });
  }, [value]);

  React.useEffect(() => {
    measure();
    const track = trackRef.current;
    if (!track || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(track);
    Object.values(btnRefs.current).forEach((el) => {
      if (el) ro.observe(el);
    });
    return () => ro.disconnect();
  }, [measure, items]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, idx: number) => {
    if (mode !== "tablist") return;
    let nextIdx: number | null = null;
    if (e.key === "ArrowRight") nextIdx = (idx + 1) % items.length;
    else if (e.key === "ArrowLeft") nextIdx = (idx - 1 + items.length) % items.length;
    else if (e.key === "Home") nextIdx = 0;
    else if (e.key === "End") nextIdx = items.length - 1;
    if (nextIdx !== null) {
      e.preventDefault();
      const target = items[nextIdx];
      if (!target) return;
      onChange(target.id);
      const btn = btnRefs.current[target.id];
      btn?.focus();
      btn?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  };

  return (
    <div
      ref={trackRef}
      data-ui="sliding-tabs"
      data-variant={variant}
      data-full={fullWidth ? "true" : undefined}
      role={mode}
      aria-label={ariaLabel}
      className={className ? `ps-sliding-tabs ${className}` : "ps-sliding-tabs"}
      style={
        {
          "--st-x": `${indicator.x}px`,
          "--st-w": `${indicator.w}px`,
          "--st-opacity": indicator.ready ? "1" : "0",
        } as React.CSSProperties
      }
    >
      <span className="ps-sliding-tabs__indicator" aria-hidden="true" />
      {items.map((item, idx) => {
        const isActive = item.id === value;
        const tabProps =
          mode === "tablist"
            ? {
                role: "tab" as const,
                id: tabIdPrefix ? `${tabIdPrefix}-${item.id}` : undefined,
                "aria-selected": isActive,
                tabIndex: isActive ? 0 : -1,
              }
            : {
                "aria-pressed": isActive,
              };

        return (
          <button
            key={item.id}
            ref={(el) => {
              btnRefs.current[item.id] = el;
            }}
            type="button"
            data-active={isActive ? "true" : undefined}
            className="ps-sliding-tabs__btn"
            onClick={() => {
              onChange(item.id);
              btnRefs.current[item.id]?.scrollIntoView({ block: "nearest", inline: "nearest" });
            }}
            onKeyDown={(e) => handleKeyDown(e, idx)}
            {...tabProps}
          >
            {item.icon ? (
              <span className="ps-sliding-tabs__icon" aria-hidden="true">
                {item.icon}
              </span>
            ) : null}
            <span>{item.label}</span>
            {item.codeHint ? <code className="ps-sliding-tabs__code num">{item.codeHint}</code> : null}
            {typeof item.count === "number" ? (
              <span className="ps-sliding-tabs__count num">{item.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

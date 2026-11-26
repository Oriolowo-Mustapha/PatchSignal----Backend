"use client";

import * as React from "react";
import { BrandMark } from "@/components/brand-mark";

export function Spinner({
  size = 16,
  label,
  className,
}: {
  size?: number;
  label?: string;
  className?: string;
}) {
  return (
    <span
      className={className ? `ps-spinner ${className}` : "ps-spinner"}
      role={label ? "status" : undefined}
      aria-live={label ? "polite" : undefined}
      aria-hidden={label ? undefined : "true"}
    >
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle
          cx="12"
          cy="12"
          r="9"
          stroke="currentColor"
          strokeOpacity="0.24"
          strokeWidth="2.5"
        />
        <path
          d="M21 12a9 9 0 0 0-9-9"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </svg>
      {label ? <span className="visually-hidden">{label}</span> : null}
    </span>
  );
}

export function ActivityBar({ label = "Running task" }: { label?: string }) {
  return (
    <div className="ps-activity-bar" role="status" aria-label={label}>
      <span className="ps-activity-bar__fill" aria-hidden="true" />
    </div>
  );
}

export function SkeletonBox({
  height = 16,
  width = "100%",
  radius = 8,
  className,
}: {
  height?: number | string;
  width?: number | string;
  radius?: number | string;
  className?: string;
}) {
  return (
    <span
      className={className ? `ps-skel ${className}` : "ps-skel"}
      style={{ height, width, borderRadius: radius }}
      aria-hidden="true"
    />
  );
}

export function InvestigationSkeleton() {
  return (
    <div className="ps-skel-stack" role="status" aria-label="Loading investigation">
      <div className="ps-skel-card">
        <div className="ps-skel-row">
          <SkeletonBox height={26} width="42%" radius={6} />
          <div style={{ display: "flex", gap: 8 }}>
            <SkeletonBox height={32} width={88} radius={8} />
            <SkeletonBox height={32} width={140} radius={8} />
          </div>
        </div>
        <SkeletonBox height={16} width="78%" />
        <SkeletonBox height={16} width="54%" />
        <SkeletonBox height={52} width="100%" radius={10} />
      </div>

      <div style={{ display: "flex", gap: 10 }}>
        <SkeletonBox height={34} width={132} radius={8} />
        <SkeletonBox height={34} width={110} radius={8} />
        <SkeletonBox height={34} width={116} radius={8} />
        <SkeletonBox height={34} width={128} radius={8} />
      </div>

      <div className="ps-skel-card">
        <SkeletonBox height={20} width="32%" radius={6} />
        <SkeletonBox height={88} width="100%" radius={8} />
        <SkeletonBox height={56} width="100%" radius={8} />
      </div>
    </div>
  );
}

export function WorkspaceSkeleton() {
  return (
    <div className="ps-skel-ws" role="status" aria-label="Loading PatchSignal workspace">
      <div className="ps-skel-ws__bar">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <BrandMark size={20} animated />
          <SkeletonBox height={18} width={110} radius={6} />
        </div>
        <SkeletonBox height={32} width={280} radius={8} />
        <SkeletonBox height={32} width={130} radius={8} />
      </div>

      <div className="ps-skel-ws__grid">
        <aside className="ps-skel-ws__rail" aria-hidden="true">
          <SkeletonBox height={36} width="100%" radius={8} />
          <SkeletonBox height={68} width="100%" radius={10} />
          <SkeletonBox height={68} width="100%" radius={10} />
          <SkeletonBox height={68} width="100%" radius={10} />
          <SkeletonBox height={68} width="100%" radius={10} />
        </aside>
        <main className="ps-skel-ws__main">
          <InvestigationSkeleton />
        </main>
      </div>
    </div>
  );
}

export function DocsSkeleton() {
  return (
    <div className="ps-skel-ws" role="status" aria-label="Loading API documentation">
      <div className="ps-skel-ws__bar">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <BrandMark size={20} animated />
          <SkeletonBox height={18} width={150} radius={6} />
        </div>
        <SkeletonBox height={32} width={220} radius={8} />
      </div>

      <div className="ps-skel-ws__grid">
        <aside className="ps-skel-ws__rail" aria-hidden="true">
          <SkeletonBox height={14} width="60%" radius={4} />
          <SkeletonBox height={28} width="100%" radius={6} />
          <SkeletonBox height={28} width="100%" radius={6} />
          <SkeletonBox height={28} width="100%" radius={6} />
          <SkeletonBox height={28} width="100%" radius={6} />
          <SkeletonBox height={28} width="100%" radius={6} />
        </aside>
        <main className="ps-skel-ws__main">
          <div className="ps-skel-stack">
            <SkeletonBox height={40} width="48%" radius={8} />
            <SkeletonBox height={18} width="72%" radius={6} />
            <SkeletonBox height={160} width="100%" radius={12} />
            <SkeletonBox height={160} width="100%" radius={12} />
          </div>
        </main>
      </div>
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="ps-skel-ws" role="status" aria-label="Loading PatchSignal dashboard">
      <div className="ps-skel-ws__bar">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <BrandMark size={20} animated />
          <SkeletonBox height={18} width={130} radius={6} />
        </div>
        <SkeletonBox height={32} width={220} radius={8} />
        <SkeletonBox height={32} width={160} radius={8} />
      </div>

      <main className="ps-skel-dash">
        <div className="ps-skel-row">
          <div style={{ display: "grid", gap: 8 }}>
            <SkeletonBox height={28} width={220} radius={6} />
            <SkeletonBox height={16} width={320} radius={6} />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <SkeletonBox height={36} width={104} radius={8} />
            <SkeletonBox height={36} width={144} radius={8} />
          </div>
        </div>

        <div className="ps-skel-dash__kpis">
          <SkeletonBox height={108} width="100%" radius={12} />
          <SkeletonBox height={108} width="100%" radius={12} />
          <SkeletonBox height={108} width="100%" radius={12} />
          <SkeletonBox height={108} width="100%" radius={12} />
        </div>

        <div className="ps-skel-dash__grid">
          <SkeletonBox height={300} width="100%" radius={12} />
          <div className="ps-skel-stack">
            <SkeletonBox height={142} width="100%" radius={12} />
            <SkeletonBox height={142} width="100%" radius={12} />
          </div>
        </div>

        <SkeletonBox height={260} width="100%" radius={12} />
      </main>
    </div>
  );
}

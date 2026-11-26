"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  FolderGit2,
  GitPullRequest,
  Layers,
  LogOut,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { AlertBanner } from "@/components/ui/alert-banner";
import {
  CommandPalette,
  CommandPaletteTrigger,
  type CommandPaletteItem,
} from "@/components/ui/command-palette";
import { DashboardSkeleton, Spinner } from "@/components/ui/loaders";
import { ModalDialog } from "@/components/ui/modal-dialog";
import { ScrollReveal } from "@/components/ui/scroll-reveal";
import { SlidingTabs } from "@/components/ui/sliding-tabs";
import { AuthPanel } from "@/components/workspace/auth-panel";
import {
  apiClient,
  ApiRequestError,
  clearLegacyStoredToken,
  type HealthResponse,
  type InvestigationSummary,
  type UserProfile,
} from "@/lib/ui/api-client";
import {
  computeDashboardMetrics,
  isInvestigationNeedingAttention,
} from "@/lib/ui/dashboard-metrics";

type TableTab = "all" | "attention" | "reproduced" | "prs";

const STAGE_LABELS: Record<string, string> = {
  intake: "Intake",
  analyzed: "Analyzed",
  inspected: "Inspected",
  hypothesized: "Hypothesis",
  ran: "Verified",
  packaged: "Packaged",
};

function verdictBadgeClass(status: string) {
  if (status === "Reproduced") return "ws-pill ws-pill--pos";
  if (status === "Not_reproduced") return "ws-pill ws-pill--warn";
  if (status === "Inconclusive") return "ws-pill ws-pill--neg";
  return "ws-pill";
}

function formatShortDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function DashboardApp() {
  const router = useRouter();
  const [booting, setBooting] = React.useState(true);
  const [user, setUser] = React.useState<UserProfile | null>(null);
  const [investigations, setInvestigations] = React.useState<InvestigationSummary[]>([]);
  const [health, setHealth] = React.useState<HealthResponse | null>(null);
  const [refreshing, setRefreshing] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  const [tableTab, setTableTab] = React.useState<TableTab>("all");
  const [searchQuery, setSearchQuery] = React.useState("");
  const [stageFilter, setStageFilter] = React.useState<string | null>(null);
  const [verdictFilter, setVerdictFilter] = React.useState<string | null>(null);
  const [repoFilter, setRepoFilter] = React.useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);
  const searchInputRef = React.useRef<HTMLInputElement>(null);

  const loadDashboardData = React.useCallback(async (showSpinner = false) => {
    if (showSpinner) setRefreshing(true);
    setLoadError(null);
    try {
      const [listRes, healthRes] = await Promise.all([
        apiClient.listInvestigations(),
        apiClient.health().catch(() => null),
      ]);
      setInvestigations(listRes.investigations);
      if (healthRes) setHealth(healthRes);
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 401) {
        setUser(null);
        setInvestigations([]);
        return;
      }
      setLoadError(
        err instanceof Error
          ? err.message
          : "We couldn't load your latest dashboard summary. Please try refreshing."
      );
    } finally {
      if (showSpinner) setRefreshing(false);
    }
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    clearLegacyStoredToken();

    (async () => {
      try {
        const meRes = await apiClient.me();
        if (cancelled) return;
        setUser(meRes);
        const [listRes, healthRes] = await Promise.all([
          apiClient.listInvestigations().catch(() => null),
          apiClient.health().catch(() => null),
        ]);
        if (!cancelled) {
          if (listRes) setInvestigations(listRes.investigations);
          if (healthRes) setHealth(healthRes);
        }
      } catch {
        // Render auth panel cleanly when unauthenticated
      } finally {
        if (!cancelled) setBooting(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => {
    if (!user) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key === "/") {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        router.push("/workspace?new=1");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [user, router]);

  const handleSignOut = async () => {
    try {
      await apiClient.logout();
    } catch {
      // Clear local UI state regardless
    }
    clearLegacyStoredToken();
    setUser(null);
    setInvestigations([]);
  };

  const metrics = React.useMemo(
    () => computeDashboardMetrics(investigations),
    [investigations]
  );

  const filteredRows = React.useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return investigations.filter((inv) => {
      if (tableTab === "attention" && !isInvestigationNeedingAttention(inv)) return false;
      if (tableTab === "reproduced" && inv.status !== "Reproduced") return false;
      if (tableTab === "prs" && !inv.remediation?.prNumber && !inv.remediation?.prUrl) {
        return false;
      }
      if (stageFilter && inv.stage !== stageFilter) return false;
      if (verdictFilter && inv.status !== verdictFilter) return false;
      if (repoFilter && `${inv.owner}/${inv.repo}` !== repoFilter) return false;
      if (!q) return true;
      return (
        `${inv.owner}/${inv.repo}`.toLowerCase().includes(q) ||
        inv.description.toLowerCase().includes(q) ||
        (inv.summary || "").toLowerCase().includes(q) ||
        inv.stage.toLowerCase().includes(q)
      );
    });
  }, [investigations, tableTab, stageFilter, verdictFilter, repoFilter, searchQuery]);

  const paletteItems = React.useMemo<CommandPaletteItem[]>(() => {
    const items: CommandPaletteItem[] = [
      {
        id: "dash-new",
        group: "Actions",
        label: "New bug investigation",
        subtitle: "Open intake composer inside workspace",
        icon: <Plus size={16} strokeWidth={1.5} />,
        shortcut: "N",
        onSelect: () => router.push("/workspace?new=1"),
      },
      {
        id: "dash-workspace",
        group: "Navigation",
        label: "Open investigation workbench",
        icon: <Layers size={16} strokeWidth={1.5} />,
        onSelect: () => router.push("/workspace"),
      },
      {
        id: "dash-docs",
        group: "Navigation",
        label: "REST API Reference",
        icon: <BookOpen size={16} strokeWidth={1.5} />,
        onSelect: () => router.push("/docs"),
      },
    ];

    for (const inv of investigations) {
      items.push({
        id: `dash-inv-${inv.id}`,
        group: "Investigations",
        label: `${inv.owner}/${inv.repo}`,
        subtitle: inv.summary || inv.description,
        badge: inv.status.replace("_", " "),
        icon: <FolderGit2 size={16} strokeWidth={1.5} />,
        onSelect: () => router.push(`/workspace?id=${encodeURIComponent(inv.id)}`),
      });
    }
    return items;
  }, [investigations, router]);

  if (booting) {
    return <DashboardSkeleton />;
  }

  if (!user) {
    return (
      <AuthPanel
        onAuthenticated={async (profile) => {
          setUser(profile);
          await loadDashboardData(false);
        }}
      />
    );
  }

  const displayName = user.name?.trim() || user.email;
  const userInitial = displayName.charAt(0).toUpperCase();
  const hasActiveFacet = Boolean(stageFilter || verdictFilter || repoFilter);

  const clearFacetFilters = () => {
    setStageFilter(null);
    setVerdictFilter(null);
    setRepoFilter(null);
  };

  return (
    <div className="dash-shell">
      <header className="ws-topbar">
        <div className="ws-topbar__left">
          <Link href="/" className="ws-brand">
            <BrandMark size={20} pulseColor="#A3E635" animated />
            <span>PatchSignal</span>
          </Link>
          <span className="ws-topbar__sep" aria-hidden="true">
            /
          </span>
          <span className="ws-topbar__crumb">Dashboard</span>
        </div>

        <div className="ws-topbar__center">
          <CommandPaletteTrigger
            className="ws-cmd-trigger"
            onClick={() => setPaletteOpen(true)}
          >
            Jump to investigation, workspace, or docs…
          </CommandPaletteTrigger>
        </div>

        <div className="ws-topbar__right">
          <Link href="/workspace?new=1" className="ws-btn ws-btn--primary" style={{ textDecoration: "none" }}>
            <Plus size={15} strokeWidth={1.75} aria-hidden="true" />
            <span>New</span>
            <kbd className="ps-kbd ws-kbd--on-lime" aria-hidden="true">
              N
            </kbd>
          </Link>

          <Link href="/workspace" className="ws-topbar__link">
            Workspace
          </Link>

          <Link href="/docs" className="ws-topbar__link">
            API Docs
          </Link>

          <div className="ws-user-chip" title={user.email}>
            <span className="ws-user-avatar" aria-hidden="true">
              {userInitial}
            </span>
            <span className="ws-user-name">{displayName}</span>
          </div>

          <button
            type="button"
            className="ws-signout-btn"
            onClick={handleSignOut}
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut size={16} strokeWidth={1.5} aria-hidden="true" />
          </button>

          <button
            type="button"
            className="ws-btn dash-menu-btn"
            aria-label={mobileNavOpen ? "Close navigation menu" : "Open navigation menu"}
            aria-expanded={mobileNavOpen}
            onClick={() => setMobileNavOpen((prev) => !prev)}
          >
            <span className={`dash-burger ${mobileNavOpen ? "is-open" : ""}`} aria-hidden="true">
              <span className="dash-burger__line" />
              <span className="dash-burger__line" />
            </span>
          </button>
        </div>
      </header>

      <main id="main-content" className="dash-main ps-panel-enter">
        <div className="dash-head">
          <div>
            <h1 className="dash-head__title">Verification overview</h1>
            <p className="dash-head__sub">
              Track your bug investigations, automated fixes, Pull Requests, and system status in one place for {displayName}.
            </p>
          </div>
          <div className="dash-head__actions">
            <button
              type="button"
              className="ws-btn"
              disabled={refreshing}
              onClick={() => void loadDashboardData(true)}
            >
              <RefreshCw
                size={14}
                strokeWidth={1.75}
                className={refreshing ? "ps-icon-spin" : undefined}
                aria-hidden="true"
              />
              <span>{refreshing ? "Refreshing…" : "Refresh"}</span>
            </button>
            <Link href="/workspace" className="ws-btn ws-btn--primary" style={{ textDecoration: "none" }}>
              <span>Open workbench</span>
              <ArrowRight size={14} strokeWidth={1.75} aria-hidden="true" />
            </Link>
          </div>
        </div>

        {loadError ? (
          <AlertBanner
            variant="error"
            context="workspace"
            message={loadError}
            onDismiss={() => setLoadError(null)}
          />
        ) : null}

        {/* Row 1: 4 Compact Stat Cards (pure numbers + factual context) */}
        <section className="dash-kpi-grid" aria-label="Queue summary metrics">
          <article className="dash-kpi-card">
            <div className="dash-kpi-card__label">
              <span>Total investigations</span>
              <Layers size={15} strokeWidth={1.5} className="dash-kpi-card__icon" aria-hidden="true" />
            </div>
            <div className="dash-kpi-card__value num">{metrics.total}</div>
            <div className="dash-kpi-card__sub num">
              {metrics.uniqueRepos} {metrics.uniqueRepos === 1 ? "repository" : "repositories"} tracked
            </div>
          </article>

          <article className="dash-kpi-card dash-kpi-card--accent">
            <div className="dash-kpi-card__label">
              <span>Verified & fixed</span>
              <CheckCircle2 size={15} strokeWidth={1.5} className="dash-kpi-card__icon" aria-hidden="true" />
            </div>
            <div className="dash-kpi-card__value num">{metrics.verifiedFixCount}</div>
            <div className="dash-kpi-card__sub num">
              {metrics.verifiedRatePct}% of total queue
            </div>
          </article>

          <article className="dash-kpi-card">
            <div className="dash-kpi-card__label">
              <span>Pull Requests</span>
              <GitPullRequest size={15} strokeWidth={1.5} className="dash-kpi-card__icon" aria-hidden="true" />
            </div>
            <div className="dash-kpi-card__value num">{metrics.openPrCount}</div>
            <div className="dash-kpi-card__sub num">
              {metrics.ciPassingCount} CI passing · {metrics.ciFailingCount} failing
            </div>
          </article>

          <article className="dash-kpi-card">
            <div className="dash-kpi-card__label">
              <span>Needs attention</span>
              <AlertTriangle size={15} strokeWidth={1.5} className="dash-kpi-card__icon" aria-hidden="true" />
            </div>
            <div className="dash-kpi-card__value num">{metrics.needsAttentionCount}</div>
            <div className="dash-kpi-card__sub">Pending, inconclusive, or failing CI</div>
          </article>
        </section>

        {/* Row 2: Primary Verdict/Pipeline Visualization + Health & Repository Breakdown */}
        <ScrollReveal>
          <section className="dash-main-grid" aria-label="Pipeline distribution and system health">
            {/* Primary Visualization Card (inspired by 21st.dev Insight Cards) */}
            <div className="dash-card">
              <div className="dash-card__head">
                <div>
                  <h2 className="dash-card__title">Verdict & pipeline breakdown</h2>
                  <p className="dash-card__sub">
                    Click any verdict segment or workflow stage below to filter the investigations list.
                  </p>
                </div>
                {hasActiveFacet ? (
                  <button type="button" className="dash-clear-btn" onClick={clearFacetFilters}>
                    <X size={12} strokeWidth={1.75} aria-hidden="true" />
                    <span>Clear filter</span>
                  </button>
                ) : null}
              </div>

              <div className="dash-alloc-wrap">
                <div className="dash-alloc-bar" aria-label="Verdict distribution bar">
                  {metrics.total === 0 ? (
                    <span className="dash-alloc-seg dash-alloc-seg--neutral" style={{ flex: 1 }} />
                  ) : (
                    metrics.verdictSegments
                      .filter((seg) => seg.count > 0)
                      .map((seg) => (
                        <span
                          key={seg.id}
                          className={`dash-alloc-seg dash-alloc-seg--${seg.tone}`}
                          style={{ flexGrow: seg.count }}
                          title={`${seg.label}: ${seg.count} (${seg.sharePct}%)`}
                        />
                      ))
                  )}
                </div>

                <div className="dash-legend" role="group" aria-label="Filter by verdict">
                  {metrics.verdictSegments.map((seg) => {
                    const active = verdictFilter === seg.id;
                    return (
                      <button
                        key={seg.id}
                        type="button"
                        className={`dash-legend-btn ${active ? "is-active" : ""}`}
                        onClick={() =>
                          setVerdictFilter((cur) => (cur === seg.id ? null : seg.id))
                        }
                      >
                        <span className={`dash-dot dash-dot--${seg.tone}`} aria-hidden="true" />
                        <span>{seg.label}</span>
                        <span className="num" style={{ color: "var(--ink-muted)" }}>
                          {seg.count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="dash-stages" role="group" aria-label="Filter by workflow stage">
                {metrics.stages.map((st) => {
                  const active = stageFilter === st.id;
                  const scale = metrics.total > 0 ? st.count / metrics.total : 0;
                  return (
                    <button
                      key={st.id}
                      type="button"
                      className={`dash-stage-row ${active ? "is-active" : ""}`}
                      onClick={() =>
                        setStageFilter((cur) => (cur === st.id ? null : st.id))
                      }
                    >
                      <span className="dash-stage-row__name">{st.label}</span>
                      <span className="dash-stage-row__track" aria-hidden="true">
                        <span
                          className="dash-stage-row__fill"
                          style={{ transform: `scaleX(${scale})` }}
                        />
                      </span>
                      <span className="dash-stage-row__count num">
                        {st.count} ({st.sharePct}%)
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Secondary Stacked Utility Column */}
            <div className="dash-side-stack">
              {/* Service Health Card (inspired by 21st.dev Edge Cluster Status Card) */}
              <div className="dash-card">
                <div className="dash-card__head">
                  <div>
                    <h2 className="dash-card__title">Runtime & service health</h2>
                    <p className="dash-card__sub">Live readiness across storage and sandbox execution</p>
                  </div>
                  <Activity size={16} strokeWidth={1.5} style={{ color: "var(--lime)" }} aria-hidden="true" />
                </div>

                {health === null ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--ink-muted)" }}>
                    <Spinner size={14} />
                    <span>Checking service status…</span>
                  </div>
                ) : (
                  <ul className="dash-health-list">
                    <li className="dash-health-item">
                      <span className="dash-health-item__label">Data storage</span>
                      <span className={health.db.ok ? "ws-pill ws-pill--pos" : "ws-pill ws-pill--neg"}>
                        {health.db.ok ? "Healthy" : "Degraded"}
                      </span>
                    </li>
                    <li className="dash-health-item">
                      <span className="dash-health-item__label">Verification runner</span>
                      <span
                        className={
                          health.runner === "healthy"
                            ? "ws-pill ws-pill--pos"
                            : "ws-pill ws-pill--warn"
                        }
                      >
                        {health.runner === "healthy" ? "Connected" : "Standard mode"}
                      </span>
                    </li>
                    <li className="dash-health-item">
                      <span className="dash-health-item__label">Service status</span>
                      <span className={health.ok ? "ws-pill ws-pill--pos" : "ws-pill ws-pill--warn"}>
                        {health.ok ? "Operational" : "Limited"}
                      </span>
                    </li>
                  </ul>
                )}
              </div>

              {/* Repositories Breakdown Card */}
              <div className="dash-card">
                <div className="dash-card__head">
                  <div>
                    <h2 className="dash-card__title">Repositories</h2>
                    <p className="dash-card__sub">Click a repository to isolate its investigations</p>
                  </div>
                  <ShieldCheck size={16} strokeWidth={1.5} style={{ color: "var(--ink-muted)" }} aria-hidden="true" />
                </div>

                {metrics.repositories.length === 0 ? (
                  <p style={{ margin: 0, fontSize: 13, color: "var(--ink-muted)" }}>
                    No repositories submitted yet.
                  </p>
                ) : (
                  <ul className="dash-repo-list">
                    {metrics.repositories.slice(0, 6).map((r) => {
                      const active = repoFilter === r.fullName;
                      return (
                        <li key={r.fullName}>
                          <button
                            type="button"
                            className={`dash-repo-btn ${active ? "is-active" : ""}`}
                            onClick={() =>
                              setRepoFilter((cur) => (cur === r.fullName ? null : r.fullName))
                            }
                          >
                            <span className="dash-repo-btn__name">{r.fullName}</span>
                            <span className="dash-repo-btn__meta">
                              {r.ciFailing > 0 ? (
                                <span className="ws-pill ws-pill--neg num">{r.ciFailing} CI fail</span>
                              ) : r.openPrs > 0 ? (
                                <span className="ws-pill ws-pill--pos num">{r.openPrs} PR</span>
                              ) : null}
                              <span className="ws-pill num">{r.total}</span>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          </section>
        </ScrollReveal>

        {/* Row 3: Actionable Investigations Table (inspired by 21st.dev Stocks Dashboard) */}
        <ScrollReveal delayMs={60}>
          <section className="dash-card" aria-label="Investigations directory">
            <div className="dash-table-toolbar">
              <div>
                <h2 className="dash-card__title">Recent investigations ({filteredRows.length})</h2>
                <p className="dash-card__sub">
                  Jump directly into any investigation&apos;s workspace workbench, diff viewer, or CI checks.
                </p>
              </div>

              <div className="dash-table-tools">
                <SlidingTabs
                  ariaLabel="Filter table investigations"
                  mode="group"
                  variant="pill"
                  value={tableTab}
                  onChange={setTableTab}
                  items={[
                    { id: "all", label: "All", count: metrics.total },
                    { id: "attention", label: "Needs attention", count: metrics.needsAttentionCount },
                    { id: "reproduced", label: "Reproduced", count: metrics.reproducedCount },
                    { id: "prs", label: "Pull Requests", count: metrics.openPrCount },
                  ]}
                />

                <div className="dash-search-box">
                  <Search size={14} strokeWidth={1.5} aria-hidden="true" />
                  <input
                    ref={searchInputRef}
                    type="search"
                    aria-label="Search investigations"
                    placeholder="Filter repos or errors…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                  <kbd className="ps-kbd" aria-hidden="true">
                    /
                  </kbd>
                </div>
              </div>
            </div>

            {hasActiveFacet ? (
              <div className="dash-active-filters">
                <span>Active filters:</span>
                {verdictFilter ? (
                  <button
                    type="button"
                    className="dash-clear-btn"
                    onClick={() => setVerdictFilter(null)}
                  >
                    <span>Verdict: {verdictFilter.replace("_", " ")}</span>
                    <X size={12} aria-hidden="true" />
                  </button>
                ) : null}
                {stageFilter ? (
                  <button
                    type="button"
                    className="dash-clear-btn"
                    onClick={() => setStageFilter(null)}
                  >
                    <span>Stage: {STAGE_LABELS[stageFilter] ?? stageFilter}</span>
                    <X size={12} aria-hidden="true" />
                  </button>
                ) : null}
                {repoFilter ? (
                  <button
                    type="button"
                    className="dash-clear-btn"
                    onClick={() => setRepoFilter(null)}
                  >
                    <span>Repo: {repoFilter}</span>
                    <X size={12} aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            ) : null}

            <div className="dash-table-wrap">
              {filteredRows.length === 0 ? (
                <div className="dash-empty">
                  <h3 className="dash-empty__title">
                    {investigations.length === 0
                      ? "No investigations yet"
                      : "No investigations match these filters"}
                  </h3>
                  <p className="dash-empty__sub">
                    {investigations.length === 0
                      ? "Submit a public GitHub repository and failure logs to generate your first isolated verification run and fix."
                      : "Clear the search query or stage/verdict filters to view the rest of your queue."}
                  </p>
                  {investigations.length === 0 ? (
                    <Link
                      href="/workspace?new=1"
                      className="ws-btn ws-btn--primary"
                      style={{ textDecoration: "none" }}
                    >
                      <Plus size={14} strokeWidth={1.75} aria-hidden="true" />
                      <span>Create first investigation</span>
                    </Link>
                  ) : (
                    <button
                      type="button"
                      className="ws-btn"
                      onClick={() => {
                        clearFacetFilters();
                        setTableTab("all");
                        setSearchQuery("");
                      }}
                    >
                      Reset all filters
                    </button>
                  )}
                </div>
              ) : (
                <table className="dash-table">
                  <thead>
                    <tr>
                      <th scope="col">Repository & bug report</th>
                      <th scope="col">Stage</th>
                      <th scope="col">Verdict</th>
                      <th scope="col">PR / CI status</th>
                      <th scope="col">Created</th>
                      <th scope="col" className="dash-table__action-cell">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map((inv) => {
                      const prNum = inv.remediation?.prNumber;
                      const ciStatus = inv.remediation?.ciStatus;
                      return (
                        <tr key={inv.id}>
                          <td>
                            <div className="dash-row-repo">{`${inv.owner}/${inv.repo}`}</div>
                            <div className="dash-row-desc">{inv.summary || inv.description}</div>
                          </td>
                          <td data-label="Stage">
                            <span className="ws-pill">{STAGE_LABELS[inv.stage] ?? inv.stage}</span>
                          </td>
                          <td data-label="Verdict">
                            <span className={verdictBadgeClass(inv.status)}>
                              {inv.status.replace("_", " ")}
                            </span>
                          </td>
                          <td data-label="PR / CI">
                            {prNum ? (
                              <span
                                className={
                                  ciStatus === "passed"
                                    ? "ws-pill ws-pill--pos num"
                                    : ciStatus === "failed"
                                      ? "ws-pill ws-pill--neg num"
                                      : "ws-pill ws-pill--warn num"
                                }
                              >
                                {`PR #${prNum} · ${
                                  ciStatus === "passed"
                                    ? "CI passed"
                                    : ciStatus === "failed"
                                      ? "CI failing"
                                      : "CI running"
                                }`}
                              </span>
                            ) : inv.remediation?.status === "succeeded" ? (
                              <span className="ws-pill ws-pill--pos">Fix verified</span>
                            ) : inv.remediation?.status === "failed" ||
                              inv.remediation?.status === "exhausted" ? (
                              <span className="ws-pill ws-pill--neg">Fix failed</span>
                            ) : (
                              <span style={{ color: "var(--ink-muted)", fontSize: 12 }}>—</span>
                            )}
                          </td>
                          <td
                            data-label="Created"
                            className="num"
                            style={{ color: "var(--ink-muted)", whiteSpace: "nowrap" }}
                          >
                            {formatShortDate(inv.createdAt)}
                          </td>
                          <td className="dash-table__action-cell">
                            <Link
                              href={`/workspace?id=${encodeURIComponent(inv.id)}`}
                              className="dash-open-link"
                            >
                              <span>Open</span>
                              <ArrowRight size={13} strokeWidth={1.75} aria-hidden="true" />
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </ScrollReveal>
      </main>

      <ModalDialog
        open={mobileNavOpen}
        title="Navigation"
        onClose={() => setMobileNavOpen(false)}
      >
        <div className="dash-mobile-drawer">
          <div className="dash-mobile-group">
            <div className="dash-mobile-group__label">Account</div>
            <div className="dash-mobile-user">
              <span className="ws-user-avatar" aria-hidden="true">
                {userInitial}
              </span>
              <div className="dash-mobile-user__meta">
                <strong>{displayName}</strong>
                <span>{user.email}</span>
              </div>
            </div>
          </div>

          <div className="dash-mobile-group">
            <div className="dash-mobile-group__label">Workspace</div>
            <div className="dash-mobile-list">
              <Link
                href="/workspace"
                className="dash-mobile-link"
                onClick={() => setMobileNavOpen(false)}
              >
                <Layers size={16} strokeWidth={1.5} aria-hidden="true" />
                <span>Open workspace</span>
              </Link>
              <Link
                href="/docs"
                className="dash-mobile-link"
                onClick={() => setMobileNavOpen(false)}
              >
                <BookOpen size={16} strokeWidth={1.5} aria-hidden="true" />
                <span>API Docs</span>
              </Link>
              <button
                type="button"
                className="dash-mobile-link"
                onClick={() => {
                  setMobileNavOpen(false);
                  setPaletteOpen(true);
                }}
              >
                <Search size={16} strokeWidth={1.5} aria-hidden="true" />
                <span>Quick search</span>
              </button>
            </div>
          </div>

          <div className="dash-mobile-foot">
            <Link
              href="/workspace?new=1"
              className="ws-btn ws-btn--primary"
              style={{ width: "100%", height: 42, textDecoration: "none" }}
              onClick={() => setMobileNavOpen(false)}
            >
              <Plus size={15} strokeWidth={1.75} aria-hidden="true" />
              <span>New investigation</span>
            </Link>

            <button
              type="button"
              className="ws-btn"
              style={{ width: "100%", justifyContent: "center" }}
              onClick={() => {
                setMobileNavOpen(false);
                void handleSignOut();
              }}
            >
              <LogOut size={16} strokeWidth={1.5} aria-hidden="true" />
              <span>Sign out</span>
            </button>
          </div>
        </div>
      </ModalDialog>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        items={paletteItems}
        placeholder="Jump to investigation, create report, or open workspace…"
      />
    </div>
  );
}

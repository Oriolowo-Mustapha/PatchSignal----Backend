"use client";

import * as React from "react";
import Link from "next/link";
import {
  BookOpen,
  Filter,
  FolderGit2,
  Layers,
  LogOut,
  Plus,
  Search,
} from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { AlertBanner } from "@/components/ui/alert-banner";
import { InvestigationSkeleton, WorkspaceSkeleton } from "@/components/ui/loaders";
import {
  CommandPalette,
  CommandPaletteTrigger,
  type CommandPaletteItem,
} from "@/components/ui/command-palette";
import { ModalDialog } from "@/components/ui/modal-dialog";
import {
  apiClient,
  ApiRequestError,
  clearLegacyStoredToken,
  type InvestigationDetailRecord,
  type InvestigationSummary,
  type UserProfile,
} from "@/lib/ui/api-client";
import { AuthPanel } from "./auth-panel";
import { IntakeForm } from "./intake-form";
import { InvestigationDetail } from "./investigation-detail";

type StatusFilter = "all" | "Reproduced" | "Not_reproduced" | "Inconclusive" | "pending";

const STAGES_SEQUENCE = ["intake", "analyzed", "inspected", "hypothesized", "ran", "packaged"];

const STAGE_LABELS: Record<string, string> = {
  intake: "Intake",
  analyzed: "Analyzed",
  inspected: "Inspected",
  hypothesized: "Hypothesis",
  ran: "Verified",
  packaged: "Packaged",
};

function formatStageLabel(stage: string) {
  return STAGE_LABELS[stage] ?? stage;
}

function verdictBadgeClass(status: string) {
  if (status === "Reproduced") return "ws-pill ws-pill--pos";
  if (status === "Not_reproduced") return "ws-pill ws-pill--warn";
  if (status === "Inconclusive") return "ws-pill ws-pill--neg";
  return "ws-pill";
}

export function WorkspaceApp() {
  const [booting, setBooting] = React.useState(true);
  const [user, setUser] = React.useState<UserProfile | null>(null);
  const [investigations, setInvestigations] = React.useState<InvestigationSummary[]>([]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [detail, setDetail] = React.useState<InvestigationDetailRecord | null>(null);
  const [loadingDetail, setLoadingDetail] = React.useState(false);
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>("all");
  const [searchQuery, setSearchQuery] = React.useState("");
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [mobileQueueOpen, setMobileQueueOpen] = React.useState(false);
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  const refreshInFlightRef = React.useRef(false);

  const clearAuthState = React.useCallback(() => {
    clearLegacyStoredToken();
    setUser(null);
    setInvestigations([]);
    setSelectedId(null);
    setDetail(null);
    setMobileQueueOpen(false);
  }, []);

  const handleSignOut = React.useCallback(async () => {
    try {
      await apiClient.logout();
    } catch {
      // Clear local UI state even if network fails
    }
    clearAuthState();
  }, [clearAuthState]);

  React.useEffect(() => {
    let cancelled = false;
    clearLegacyStoredToken();

    (async () => {
      try {
        const meRes = await apiClient.me();
        if (cancelled) return;
        setUser(meRes);
        const listRes = await apiClient.listInvestigations().catch(() => null);
        if (!cancelled && listRes) {
          setInvestigations(listRes.investigations);
          const params =
            typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
          const requestedNew = params?.get("new") === "1";
          const requestedId = params?.get("id");
          if (requestedNew) {
            setSelectedId(null);
          } else if (
            requestedId &&
            listRes.investigations.some((item) => item.id === requestedId)
          ) {
            setSelectedId(requestedId);
          } else if (listRes.investigations.length > 0) {
            setSelectedId(listRes.investigations[0].id);
          }
        }
      } catch {
        // Unauthenticated — render auth screen
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
      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        setSelectedId(null);
        setMobileQueueOpen(false);
      } else if (e.key === "/") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [user]);

  const refreshSelected = React.useCallback(
    async (options?: { detailOnly?: boolean }) => {
      if (!user || !selectedId || refreshInFlightRef.current) return;
      refreshInFlightRef.current = true;
      try {
        if (options?.detailOnly) {
          const inv = await apiClient.getInvestigation(selectedId);
          setDetail(inv);
          setInvestigations((prev) =>
            prev.map((item) =>
              item.id === inv.id
                ? {
                    ...item,
                    stage: inv.stage,
                    status: inv.status,
                    summary: inv.summary ?? item.summary,
                  }
                : item
            )
          );
          setLoadError(null);
          return;
        }
        const [inv, listRes] = await Promise.all([
          apiClient.getInvestigation(selectedId),
          apiClient.listInvestigations(),
        ]);
        setDetail(inv);
        setInvestigations(listRes.investigations);
        setLoadError(null);
      } catch (err) {
        if (err instanceof ApiRequestError && err.status === 401) {
          clearAuthState();
          return;
        }
        setLoadError(
          err instanceof Error
            ? err.message
            : "We couldn't load this investigation right now. Please try again."
        );
      } finally {
        refreshInFlightRef.current = false;
      }
    },
    [user, selectedId, clearAuthState]
  );

  React.useEffect(() => {
    if (!user || !selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoadingDetail(true);
    setLoadError(null);
    apiClient
      .getInvestigation(selectedId)
      .then((inv) => {
        if (!cancelled) setDetail(inv);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiRequestError && err.status === 401) {
          clearAuthState();
          return;
        }
        setLoadError(
          err instanceof Error
            ? err.message
            : "We couldn't load this investigation right now. Please try again."
        );
      })
      .finally(() => {
        if (!cancelled) setLoadingDetail(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user, selectedId, clearAuthState]);

  const handleAuthenticated = async (profile: UserProfile) => {
    setUser(profile);
    try {
      const listRes = await apiClient.listInvestigations();
      setInvestigations(listRes.investigations);
      setSelectedId(listRes.investigations[0]?.id ?? null);
    } catch {
      // Queue starts empty until first submission
    }
  };

  const handleCreated = async (id: string, autoAnalyze: boolean) => {
    if (!user) return;
    if (autoAnalyze) {
      try {
        await apiClient.analyze(id);
      } catch {
        // Analysis can be retried from the detail view
      }
    }
    const listRes = await apiClient.listInvestigations();
    setInvestigations(listRes.investigations);
    setStatusFilter("all");
    setSelectedId(id);
  };

  const paletteItems = React.useMemo<CommandPaletteItem[]>(() => {
    const items: CommandPaletteItem[] = [
      {
        id: "act-new",
        group: "Actions",
        label: "New bug investigation",
        subtitle: "Open intake composer for a public GitHub issue",
        icon: <Plus size={16} strokeWidth={1.5} />,
        shortcut: "N",
        onSelect: () => {
          setSelectedId(null);
          setMobileQueueOpen(false);
        },
      },
      {
        id: "act-filter-all",
        group: "Filters",
        label: "Show all investigations",
        icon: <Filter size={16} strokeWidth={1.5} />,
        badge: String(investigations.length),
        onSelect: () => setStatusFilter("all"),
      },
      {
        id: "act-filter-repro",
        group: "Filters",
        label: "Filter by verdict: Reproduced",
        icon: <Filter size={16} strokeWidth={1.5} />,
        badge: String(investigations.filter((i) => i.status === "Reproduced").length),
        onSelect: () => setStatusFilter("Reproduced"),
      },
      {
        id: "act-filter-pending",
        group: "Filters",
        label: "Filter by verdict: Pending",
        icon: <Filter size={16} strokeWidth={1.5} />,
        badge: String(investigations.filter((i) => i.status === "pending").length),
        onSelect: () => setStatusFilter("pending"),
      },
    ];

    for (const inv of investigations) {
      items.push({
        id: `inv-${inv.id}`,
        group: "Investigations",
        label: `${inv.owner}/${inv.repo}`,
        subtitle: inv.summary || inv.description,
        badge: inv.status.replace("_", " "),
        keywords: [inv.stage, inv.status],
        icon: <FolderGit2 size={16} strokeWidth={1.5} />,
        onSelect: () => {
          setSelectedId(inv.id);
          setMobileQueueOpen(false);
        },
      });
    }

    return items;
  }, [investigations]);

  if (booting) {
    return <WorkspaceSkeleton />;
  }

  if (!user) {
    return <AuthPanel onAuthenticated={handleAuthenticated} />;
  }

  const displayName = user.name?.trim() || user.email;
  const userInitial = displayName.charAt(0).toUpperCase();

  const filterCounts = {
    all: investigations.length,
    Reproduced: investigations.filter((i) => i.status === "Reproduced").length,
    Not_reproduced: investigations.filter((i) => i.status === "Not_reproduced").length,
    Inconclusive: investigations.filter((i) => i.status === "Inconclusive").length,
    pending: investigations.filter((i) => i.status === "pending").length,
  };

  const filteredInvestigations = investigations.filter((inv) => {
    if (statusFilter !== "all" && inv.status !== statusFilter) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.trim().toLowerCase();
    return (
      `${inv.owner}/${inv.repo}`.toLowerCase().includes(q) ||
      inv.description.toLowerCase().includes(q) ||
      (inv.summary || "").toLowerCase().includes(q)
    );
  });

  const renderRailContent = (inDrawer: boolean) => (
    <>
      <div className="ws-rail__controls">
        <div className="ws-search-box">
          <Search size={15} strokeWidth={1.5} aria-hidden="true" />
          <input
            ref={inDrawer ? undefined : searchInputRef}
            type="search"
            aria-label="Filter repositories"
            placeholder="Filter queue…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {!inDrawer ? (
            <kbd className="ps-kbd" aria-hidden="true">
              /
            </kbd>
          ) : null}
        </div>
      </div>

      <div className="ws-rail__filters" role="group" aria-label="Filter by verdict">
        {(
          [
            ["all", "All"],
            ["Reproduced", "Reproduced"],
            ["Not_reproduced", "Not reproduced"],
            ["Inconclusive", "Inconclusive"],
            ["pending", "Pending"],
          ] as const
        ).map(([key, label]) => {
          const isActive = statusFilter === key;
          return (
            <button
              key={key}
              type="button"
              className="ws-filter-row"
              aria-pressed={isActive}
              onClick={() => setStatusFilter(key)}
            >
              <span className="ws-filter-row__label">
                {isActive ? <span className="ps-signal-dot" aria-hidden="true" /> : null}
                <span>{label}</span>
              </span>
              <span className="ws-filter-count num">{filterCounts[key]}</span>
            </button>
          );
        })}
      </div>

      <div className="ws-queue__head">
        <span>Triage queue</span>
        <span className="ws-filter-count num">{filteredInvestigations.length}</span>
      </div>

      <div className="ws-queue__list">
        {filteredInvestigations.length === 0 ? (
          <div className="ws-queue__empty">
            {investigations.length === 0
              ? "No investigations submitted yet. Start with a public GitHub issue."
              : "No investigations match the current filter."}
          </div>
        ) : (
          filteredInvestigations.map((inv) => {
            const isSelected = selectedId === inv.id;
            const stageIdx = Math.max(0, STAGES_SEQUENCE.indexOf(inv.stage));
            return (
              <button
                key={inv.id}
                type="button"
                className="ws-queue-item"
                data-selected={isSelected ? "true" : undefined}
                onClick={() => {
                  setSelectedId(inv.id);
                  if (inDrawer) setMobileQueueOpen(false);
                }}
              >
                <div className="ws-queue-item__top">
                  <span className="ws-queue-item__repo mono">
                    {inv.owner}/{inv.repo}
                  </span>
                  <span className={verdictBadgeClass(inv.status)}>{inv.status.replace("_", " ")}</span>
                </div>
                <div className="ws-queue-item__desc">{inv.summary || inv.description}</div>
                <div className="ws-queue-item__foot">
                  <span className="ws-queue-item__meta num">
                    {formatStageLabel(inv.stage)} · {inv.evidenceCount} evidence
                  </span>
                  <span className="ws-mini-stages" aria-hidden="true">
                    {STAGES_SEQUENCE.map((st, idx) => (
                      <span
                        key={st}
                        className={idx <= stageIdx ? "ws-mini-stage is-lit" : "ws-mini-stage"}
                      />
                    ))}
                  </span>
                </div>
              </button>
            );
          })
        )}
      </div>

      {inDrawer ? (
        <div className="ws-rail__foot">
          <div className="ws-drawer-user">
            <span className="ws-user-avatar" aria-hidden="true">
              {userInitial}
            </span>
            <div className="ws-drawer-user__meta">
              <strong>{displayName}</strong>
              <span>{user.email}</span>
            </div>
          </div>
          <Link href="/dashboard" className="ws-rail__link">
            <Layers size={16} strokeWidth={1.5} aria-hidden="true" />
            <span>Dashboard</span>
          </Link>
          <Link href="/docs" className="ws-rail__link">
            <BookOpen size={16} strokeWidth={1.5} aria-hidden="true" />
            <span>API Docs</span>
          </Link>
          <button
            type="button"
            className="ws-btn"
            style={{ width: "100%", justifyContent: "center" }}
            onClick={handleSignOut}
          >
            <LogOut size={16} strokeWidth={1.5} aria-hidden="true" />
            <span>Sign out</span>
          </button>
        </div>
      ) : null}
    </>
  );

  return (
    <div className="ws-ide">
      {/* Zone 1: Top Global Command Header */}
      <header className="ws-topbar">
        <div className="ws-topbar__left">
          <Link href="/" className="ws-brand">
            <BrandMark size={20} pulseColor="#A3E635" animated />
            <span>PatchSignal</span>
          </Link>
          <span className="ws-topbar__sep" aria-hidden="true">
            /
          </span>
          <span className="ws-topbar__crumb">
            {selectedId && detail ? (
              <span className="mono">{`${detail.owner}/${detail.repo}`}</span>
            ) : (
              "New investigation"
            )}
          </span>
          <button
            type="button"
            className="ws-btn ws-topbar__queue-btn"
            onClick={() => setMobileQueueOpen(true)}
          >
            <Layers size={15} strokeWidth={1.5} aria-hidden="true" />
            <span className="num">Queue ({filteredInvestigations.length})</span>
          </button>
        </div>

        <div className="ws-topbar__center">
          <CommandPaletteTrigger
            className="ws-topbar__cmd"
            onClick={() => setPaletteOpen(true)}
          >
            Search queue or jump…
          </CommandPaletteTrigger>
        </div>

        <div className="ws-topbar__right">
          <button
            type="button"
            className="ws-btn ws-btn--primary"
            onClick={() => {
              setSelectedId(null);
              setMobileQueueOpen(false);
            }}
          >
            <Plus size={15} strokeWidth={1.75} aria-hidden="true" />
            <span>New</span>
            <kbd className="ps-kbd ws-kbd--on-lime" aria-hidden="true">
              N
            </kbd>
          </button>

          <Link href="/dashboard" className="ws-topbar__link">
            Dashboard
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
        </div>
      </header>

      {/* Zone 2 & 3: Queue Rail + Workbench Canvas */}
      <div className="ws-body">
        <aside className="ws-rail" aria-label="Investigation triage queue">
          {renderRailContent(false)}
        </aside>

        <main id="main-content" className="ws-main">
          <div className="ws-main__inner">
            {selectedId && detail ? (
              <div key={detail.id} className="ps-panel-enter">
                <InvestigationDetail
                  investigation={detail}
                  onRefresh={refreshSelected}
                  onAuthExpired={clearAuthState}
                />
              </div>
            ) : selectedId && loadingDetail ? (
              <InvestigationSkeleton />
            ) : loadError ? (
              <AlertBanner
                variant="error"
                context="workspace"
                message={loadError}
                onDismiss={() => setLoadError(null)}
              />
            ) : (
              <div key="intake" className="ps-panel-enter">
                <IntakeForm onCreated={handleCreated} onAuthExpired={clearAuthState} />
              </div>
            )}
          </div>
        </main>
      </div>

      <ModalDialog
        open={mobileQueueOpen}
        title="Investigation queue"
        onClose={() => setMobileQueueOpen(false)}
      >
        <div className="ws-drawer-rail">{renderRailContent(true)}</div>
      </ModalDialog>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        items={paletteItems}
        placeholder="Search investigations, filter status, or start a new report…"
      />
    </div>
  );
}

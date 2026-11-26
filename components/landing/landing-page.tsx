"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Compass,
  FolderGit2,
  LogIn,
  Menu,
  ShieldCheck,
  TerminalSquare,
  UserPlus,
  X,
} from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { CodeBlockTabs } from "@/components/ui/code-block-tabs";
import { ScrollReveal } from "@/components/ui/scroll-reveal";
import {
  CommandPalette,
  CommandPaletteTrigger,
  type CommandPaletteItem,
} from "@/components/ui/command-palette";
import { HeroVerificationFrame } from "./hero-verification-frame";
import { PipelineDiagram } from "./pipeline-diagram";
import { VerdictSimulator } from "./verdict-simulator";

const STAGE_METRICS = [
  {
    index: "01",
    duration: "30s",
    name: "Report intake",
    clause: "Validate the public repository link, attach up to 3 screenshots, and capture expected versus actual state.",
    tone: "is-deep",
  },
  {
    index: "02",
    duration: "25s",
    name: "Evidence separation",
    clause: "Separate directly observed facts from reporter assumptions, hypotheses, and unanswered questions.",
    tone: "is-raised",
  },
  {
    index: "03",
    duration: "<2m",
    name: "Isolated test run",
    clause: "Pin target and baseline commit SHAs, prepare a minimal reproduction test, and run it offline.",
    tone: "is-lime",
  },
  {
    index: "04",
    duration: "1 click",
    name: "Issue-ready brief",
    clause: "Assign an honest verdict and compile an editable Markdown draft for manual maintainer approval.",
    tone: "is-white",
  },
];

const STANDARDS_TABLE = [
  {
    num: "01",
    standard: "Verified regression",
    condition: "Target commit fails the predicted assertion while baseline passes",
    handling: "Repeatable outcome check paired with exact command exit status",
    verdict: "Reproduced",
  },
  {
    num: "02",
    standard: "Clean execution",
    condition: "Target commit executes and finishes with zero test failures",
    handling: "Notes explicitly that one pass does not rule out another bug path",
    verdict: "Not reproduced",
  },
  {
    num: "03",
    standard: "Blocked environment",
    condition: "Missing dependency, syntax error, timeout, or unsupported project",
    handling: "Flagged transparently so setup failures never masquerade as healthy code",
    verdict: "Inconclusive",
  },
  {
    num: "04",
    standard: "Static path check",
    condition: "Generated reproduction test references missing files or disallowed imports",
    handling: "Caught before test execution and corrected before any commit run",
    verdict: "Auto-rejected",
  },
  {
    num: "05",
    standard: "Isolated runner",
    condition: "Public untrusted repository executes during bug verification",
    handling: "Read-only repository mount with outbound network disabled",
    verdict: "Bounded run",
  },
  {
    num: "06",
    standard: "Human sign-off",
    condition: "Completed investigation is ready for upstream triage",
    handling: "Generates an editable Markdown brief and prefilled draft link only",
    verdict: "Manual review",
  },
];

const ARTIFACT_TABS = [
  {
    id: "markdown",
    label: "Issue brief (Markdown)",
    highlightLines: [1, 4],
    code: [
      "### Reproduction Summary — Reproduced",
      "- **Repository**: meridian-dev/checkout-sdk (#418)",
      "- **Pinned target**: `8f4c21a9` (exit 1) · **Baseline**: `3c09b1d2` (exit 0)",
      "- **Predicted assertion**: `acceptEmail('ade+test@gmail.com')` -> expected `true`",
      "",
      "### Evidence Provenance",
      "- `observed` Screenshot 1 shows 'Invalid email address' under plus address input",
      "- `reported` Guest checkout stops prior to payment API submission",
    ].join("\n"),
  },
  {
    id: "json",
    label: "API payload",
    highlightLines: [2, 5],
    code: [
      "{",
      '  "status": "Reproduced",',
      '  "targetExitCode": 1,',
      '  "baselineExitCode": 0,',
      '  "readyToFile": true,',
      '  "artifactPath": "tests/patchsignal/repro-email-plus.test.ts"',
      "}",
    ].join("\n"),
  },
];

export function LandingPage({ initialAuthenticated = false }: { initialAuthenticated?: boolean }) {
  const isAuthenticated = initialAuthenticated;
  const router = useRouter();
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);
  const [paletteOpen, setPaletteOpen] = React.useState(false);

  const jumpTo = React.useCallback((hash: string) => {
    const el = document.querySelector(hash);
    if (el) el.scrollIntoView({ behavior: "smooth" });
  }, []);

  const paletteItems = React.useMemo<CommandPaletteItem[]>(() => {
    const items: CommandPaletteItem[] = [
      {
        id: "go-dashboard",
        group: "Navigation",
        label: "Operations Dashboard",
        subtitle: "Metrics, verdict breakdown, PR CI status, and service health",
        icon: <Compass size={16} strokeWidth={1.5} />,
        onSelect: () => router.push("/dashboard"),
      },
      {
        id: "go-workspace",
        group: "Workspace",
        label: "Open bug verification workspace",
        subtitle: "Submit a repository link or inspect your active queue",
        icon: <FolderGit2 size={16} strokeWidth={1.5} />,
        badge: "App",
        onSelect: () => router.push("/workspace"),
      },
      ...(!isAuthenticated
        ? [
            {
              id: "go-login",
              group: "Workspace",
              label: "Sign in to existing account",
              icon: <LogIn size={16} strokeWidth={1.5} />,
              onSelect: () => router.push("/login"),
            },
            {
              id: "go-signup",
              group: "Workspace",
              label: "Create a new workspace account",
              icon: <UserPlus size={16} strokeWidth={1.5} />,
              onSelect: () => router.push("/signup"),
            },
          ]
        : []),
      {
        id: "sec-pipeline",
        group: "Sections",
        label: "Architecture & signal pipeline",
        subtitle: "Parallel pinned-commit schematic and stage timing",
        icon: <Compass size={16} strokeWidth={1.5} />,
        onSelect: () => jumpTo("#pipeline"),
      },
      {
        id: "sec-verdicts",
        group: "Sections",
        label: "Interactive verdict simulator",
        subtitle: "Test target and baseline outcomes side by side",
        icon: <TerminalSquare size={16} strokeWidth={1.5} />,
        onSelect: () => jumpTo("#verdicts"),
      },
      {
        id: "sec-standards",
        group: "Sections",
        label: "Verification & safety standards",
        subtitle: "Review how Reproduced, Not reproduced, and Inconclusive work",
        icon: <ShieldCheck size={16} strokeWidth={1.5} />,
        onSelect: () => jumpTo("#standards"),
      },
      {
        id: "go-docs",
        group: "Developers",
        label: "REST API Reference",
        subtitle: "Endpoints for authentication, analysis, runs, and briefs",
        icon: <BookOpen size={16} strokeWidth={1.5} />,
        onSelect: () => router.push("/docs"),
      },
    ];
    return items;
  }, [router, jumpTo, isAuthenticated]);

  return (
    <div id="top" className="ps-landing">
      <header className="ps-nav">
        <div className="ps-nav__inner">
          <Link href="/" className="ps-nav__brand">
            <BrandMark size={22} pulseColor="#A3E635" animated />
            <span>PatchSignal</span>
          </Link>

          <nav className="ps-nav__center" aria-label="Primary navigation">
            <a href="#pipeline" className="ps-nav__link">
              Architecture
            </a>
            <a href="#verdicts" className="ps-nav__link">
              Verdicts
            </a>
            <a href="#standards" className="ps-nav__link">
              Standards
            </a>
            <span className="ps-nav__divider" aria-hidden="true" />
            <Link href={isAuthenticated ? "/workspace" : "/dashboard"} className="ps-nav__link">
              {isAuthenticated ? "Workspace" : "Dashboard"}
            </Link>
            <Link href="/docs" className="ps-nav__link">
              API Docs
            </Link>
          </nav>

          <div className="ps-nav__right">
            <CommandPaletteTrigger
              className="ps-nav__cmd"
              onClick={() => setPaletteOpen(true)}
            >
              Search
            </CommandPaletteTrigger>
            {!isAuthenticated ? (
              <Link href="/login" className="ps-nav__signin">
                Sign in
              </Link>
            ) : null}
            <Link href={isAuthenticated ? "/dashboard" : "/workspace"} className="ps-nav__action">
              <span>{isAuthenticated ? "Dashboard" : "Open workspace"}</span>
              <ArrowRight size={14} strokeWidth={1.75} aria-hidden="true" />
            </Link>
          </div>

          <button
            type="button"
            className="ps-nav__menu-btn"
            aria-label={mobileMenuOpen ? "Close navigation menu" : "Open navigation menu"}
            aria-expanded={mobileMenuOpen}
            aria-controls="ps-mobile-nav"
            onClick={() => setMobileMenuOpen((v) => !v)}
          >
            {mobileMenuOpen ? (
              <X size={18} strokeWidth={1.5} aria-hidden="true" />
            ) : (
              <Menu size={18} strokeWidth={1.5} aria-hidden="true" />
            )}
          </button>
        </div>

        {mobileMenuOpen ? (
          <nav id="ps-mobile-nav" className="ps-mobile-nav" aria-label="Mobile navigation">
            <a href="#pipeline" className="ps-mobile-nav__link" onClick={() => setMobileMenuOpen(false)}>
              Architecture
            </a>
            <a href="#verdicts" className="ps-mobile-nav__link" onClick={() => setMobileMenuOpen(false)}>
              Verdicts
            </a>
            <a href="#standards" className="ps-mobile-nav__link" onClick={() => setMobileMenuOpen(false)}>
              Standards
            </a>
            <Link
              href={isAuthenticated ? "/workspace" : "/dashboard"}
              className="ps-mobile-nav__link"
              onClick={() => setMobileMenuOpen(false)}
            >
              {isAuthenticated ? "Workspace" : "Dashboard"}
            </Link>
            <Link href="/docs" className="ps-mobile-nav__link" onClick={() => setMobileMenuOpen(false)}>
              API Docs
            </Link>
            {!isAuthenticated ? (
              <Link href="/login" className="ps-mobile-nav__link" onClick={() => setMobileMenuOpen(false)}>
                Sign in
              </Link>
            ) : null}
            <Link
              href={isAuthenticated ? "/dashboard" : "/workspace"}
              className="ps-mobile-nav__cta"
              onClick={() => setMobileMenuOpen(false)}
            >
              {isAuthenticated ? "Dashboard" : "Open workspace"}
            </Link>
          </nav>
        ) : null}
      </header>

      <main id="main-content">
        {/* Stage 1: Full-width Architectural Studio Hero + Multi-pane Workbench */}
        <section className="ps-hero" aria-label="Introduction">
          <div className="ps-frame ps-hero__frame">
            <span className="ps-crosshair ps-crosshair--tl" aria-hidden="true" />
            <span className="ps-crosshair ps-crosshair--tr" aria-hidden="true" />

            <div className="ps-hero__top">
              <div className="ps-hero__headline-col" data-load style={{ "--d": "40ms" } as React.CSSProperties}>
                <h1 className="ps-hero__display">
                  Reproduce GitHub bugs before anyone writes a patch
                </h1>
              </div>

              <div className="ps-hero__lead-col" data-load style={{ "--d": "110ms" } as React.CSSProperties}>
                <p className="ps-hero__lead">
                  PatchSignal turns issue descriptions and screenshots into isolated reproduction tests, commit-level exit comparisons, and review-ready briefs.
                </p>

                <div className="ps-hero__actions">
                  <Link href={isAuthenticated ? "/dashboard" : "/workspace"} className="ps-btn-lime">
                    <span>{isAuthenticated ? "Dashboard" : "Open workspace"}</span>
                    <ArrowRight size={16} strokeWidth={1.75} aria-hidden="true" />
                  </Link>
                  <a href="#verdicts" className="ps-btn-secondary">
                    Test verdict lab
                  </a>
                </div>

                <dl className="ps-hero__stats">
                  <div className="ps-hero__stat">
                    <dt>Screenshots per report</dt>
                    <dd className="num">3 max</dd>
                  </div>
                  <div className="ps-hero__stat">
                    <dt>Target vs baseline</dt>
                    <dd className="num">2 commits</dd>
                  </div>
                  <div className="ps-hero__stat">
                    <dt>Manual review before filing</dt>
                    <dd className="num">100%</dd>
                  </div>
                </dl>
              </div>
            </div>

            <div className="ps-hero__stage" data-load style={{ "--d": "170ms" } as React.CSSProperties}>
              <HeroVerificationFrame />
            </div>
          </div>
        </section>

        {/* Stage 2: Architecture Bento Grid + Orthogonal Signal Diagram */}
        <section id="pipeline" className="ps-section ps-section--surface">
          <div className="ps-frame ps-section__frame">
            <ScrollReveal>
              <div className="ps-section__head">
                <h2 className="ps-heading-lg">From bug report to verifiable execution</h2>
                <p className="ps-section__lead">
                  Every stage keeps reporter notes, screenshot facts, test assertions, and commit logs distinctly tagged so maintainers review hard evidence.
                </p>
              </div>
            </ScrollReveal>

            <ScrollReveal delayMs={70}>
              <div className="ps-bento">
              <div className="ps-bento__diagram">
                <PipelineDiagram />
              </div>

              <div className="ps-bento__sla">
                <div className="ps-sla-head">
                  <h3 className="ps-sla-title">Four-stage cadence</h3>
                  <span className="ps-sla-tag num">4 steps</span>
                </div>
                <div className="ps-sla-list">
                  {STAGE_METRICS.map((stage) => (
                    <div key={stage.index} className={`ps-sla-row ${stage.tone}`}>
                      <div className="ps-sla-row__top">
                        <span className="ps-sla-row__idx mono num">{stage.index}</span>
                        <strong className="ps-sla-row__name">{stage.name}</strong>
                        <span className="ps-sla-row__dur num">{stage.duration}</span>
                      </div>
                      <p className="ps-sla-row__clause">{stage.clause}</p>
                    </div>
                  ))}
                </div>
              </div>

              <article className="ps-bento__card ps-lift-card">
                <div className="ps-bento__card-head">
                  <span className="ps-bento__num mono num">A1</span>
                  <h3 className="ps-bento__title">Strict evidence provenance</h3>
                </div>
                <p className="ps-bento__copy">
                  Attached screenshots stay grounded as directly observed UI states, separated from reporter descriptions, open hypotheses, and unresolved environment questions.
                </p>
                <div className="ps-bento__chips">
                  <span className="ps-prov-tag is-observed">observed</span>
                  <span className="ps-prov-tag is-reported">reported</span>
                  <span className="ps-prov-tag is-hypothesis">hypothesis</span>
                  <span className="ps-prov-tag is-unknown">unknown</span>
                </div>
              </article>

              <article className="ps-bento__card ps-lift-card">
                <div className="ps-bento__card-head">
                  <span className="ps-bento__num mono num">A2</span>
                  <h3 className="ps-bento__title">Offline execution boundaries</h3>
                </div>
                <p className="ps-bento__copy">
                  Public repositories run read-only inside bounded offline environments. Missing imports and execution timeouts flag explicitly rather than reading as clean passes.
                </p>
                <div className="ps-bento__metrics num">
                  <span>Read-only mount</span>
                  <span>Network disabled</span>
                  <span>Static path validation</span>
                </div>
              </article>
            </div>
            </ScrollReveal>
          </div>
        </section>

        {/* Stage 3: Interactive Verdict Simulator on Midnight Black */}
        <section id="verdicts" className="ps-section ps-section--canvas">
          <div className="ps-frame ps-section__frame">
            <ScrollReveal>
              <div className="ps-showcase-top">
                <h2>Guesswork against proof</h2>
                <p>
                  An explanation remains a theory until a minimal assertion fails on the broken commit and passes on the baseline revision.
                </p>
              </div>
            </ScrollReveal>

            <ScrollReveal delayMs={70}>
              <VerdictSimulator />
            </ScrollReveal>
          </div>
        </section>

        {/* Stage 4: Pure White High-Contrast Standards Matrix & Output Brief */}
        <section id="standards" className="ps-section ps-section--white">
          <div className="ps-frame ps-frame--light ps-section__frame">
            <ScrollReveal>
              <div className="ps-rules-header">
                <h2 className="ps-rules-heading">
                  Clear verdicts,
                  <span className="ps-rules-heading__indent">never guesswork</span>
                </h2>
                <p className="ps-rules-lead">
                  Six mechanical rules govern how PatchSignal handles incomplete reports, missing modules, and final maintainer sign-off.
                </p>
              </div>
            </ScrollReveal>

            <ScrollReveal delayMs={70}>
              <div className="ps-rules-table-wrap">
              <table className="ps-rules-table">
                <caption className="visually-hidden">PatchSignal verification and safety standards</caption>
                <thead>
                  <tr>
                    <th scope="col">#</th>
                    <th scope="col">Standard</th>
                    <th scope="col">When it applies</th>
                    <th scope="col">How PatchSignal handles it</th>
                    <th scope="col">Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {STANDARDS_TABLE.map((row) => (
                    <tr key={row.standard}>
                      <td className="mono num">{row.num}</td>
                      <td>{row.standard}</td>
                      <td>{row.condition}</td>
                      <td>{row.handling}</td>
                      <td>
                        <span
                          className={
                            row.verdict === "Reproduced"
                              ? "ps-white-pill ps-white-pill--repro"
                              : "ps-white-pill"
                          }
                        >
                          {row.verdict === "Reproduced" ? (
                            <span className="ps-signal-dot" aria-hidden="true" />
                          ) : null}
                          {row.verdict}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            </ScrollReveal>

            <ScrollReveal delayMs={100}>
              <div className="ps-proof-pair">
              <div data-ui="package-preview" className="ps-package-preview">
                <div className="ps-package-preview__head">
                  <strong className="ps-package-preview__title">Review-ready evidence brief</strong>
                  <span className="ps-pill-lime">Reproduced</span>
                </div>
                <div className="ps-package-preview__meta">
                  <div>
                    <span className="ps-package-preview__k">Target commit</span>
                    <code className="num">8f4c21a9</code>
                  </div>
                  <div>
                    <span className="ps-package-preview__k">Baseline commit</span>
                    <code className="num">3c09b1d2</code>
                  </div>
                  <div>
                    <span className="ps-package-preview__k">Issue filing</span>
                    <span>Manual approval</span>
                  </div>
                </div>
                <pre className="ps-package-preview__code">
                  {`Observed [screenshot 1]: ade+test@gmail.com -> "Invalid email address"\nResult: target failed assertion (exit 1), baseline passed cleanly (exit 0)\nArtifact: tests/patchsignal/repro-email-plus.test.ts`}
                </pre>
              </div>

              <div className="ps-artifact-tabs">
                <CodeBlockTabs
                  title="Generated draft artifacts"
                  tabs={[...ARTIFACT_TABS]}
                  maxHeight={220}
                />
              </div>
            </div>
            </ScrollReveal>
          </div>
        </section>

        {/* Stage 5: Unified Solid Lime Action Close docked above Deep Midnight Footer */}
        <section className="ps-close-band" aria-label="Workspace launch">
          <div className="ps-frame">
            <ScrollReveal>
              <Link href={isAuthenticated ? "/dashboard" : "/workspace"} className="ps-cta-band">
                <div className="ps-cta-band__top">
                  <p className="ps-cta-band__note">
                    Submit a public GitHub repository and screenshots to produce a verified bug reproduction brief.
                  </p>
                  <span className="ps-cta-band__arrow">
                    <ArrowUpRight size={32} strokeWidth={1.5} aria-hidden="true" />
                  </span>
                </div>
                <div className="ps-cta-band__bottom">
                  <span className="ps-cta-band__verb">Verify</span>
                  <span className="ps-cta-band__meta">
                    {isAuthenticated ? "Go to dashboard" : "Open workspace"}
                  </span>
                </div>
              </Link>
            </ScrollReveal>
          </div>
        </section>
      </main>

      <footer className="ps-footer">
        <div className="ps-footer__inner">
          <div className="ps-footer__cols">
            <div className="ps-footer__brand-col">
              <Link href="/" className="ps-nav__brand">
                <BrandMark size={20} pulseColor="#A3E635" />
                <span>PatchSignal</span>
              </Link>
              <p className="ps-footer__blurb">
                Automated bug reproduction and verified issue triage for maintainers and engineering teams.
              </p>
            </div>

            <div className="ps-footer__col">
              <div className="ps-footer__col-title">Workflow</div>
              <a href="#pipeline">Architecture</a>
              <a href="#verdicts">Verdict simulator</a>
              <a href="#standards">Safety standards</a>
            </div>

            <div className="ps-footer__col">
              <div className="ps-footer__col-title">Workspace</div>
              <Link href="/dashboard">Dashboard</Link>
              <Link href="/workspace">Open workspace</Link>
              {!isAuthenticated ? <Link href="/login">Sign in</Link> : null}
              {!isAuthenticated ? <Link href="/signup">Create account</Link> : null}
            </div>

            <div className="ps-footer__col">
              <div className="ps-footer__col-title">Developers</div>
              <Link href="/docs">API Reference</Link>
              <a href="/api/openapi">OpenAPI specification</a>
              <a href="#top">Back to top</a>
            </div>
          </div>

          <div className="ps-footer__bottom">
            <div className="ps-footer__notes">
              <span>Isolated test runs</span>
              <span>Human-approved issue drafts</span>
              <span>Scoped private queues</span>
            </div>
            <span className="num">PatchSignal · 2026</span>
          </div>
        </div>
      </footer>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        items={paletteItems}
        placeholder="Jump to section, workspace, or API docs…"
      />
    </div>
  );
}

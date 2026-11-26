"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, FolderGit2, LogIn, Search, TerminalSquare } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { CodeBlockTabs } from "@/components/ui/code-block-tabs";
import {
  CommandPalette,
  CommandPaletteTrigger,
  type CommandPaletteItem,
} from "@/components/ui/command-palette";
import { Spinner } from "@/components/ui/loaders";
import { ScrollReveal } from "@/components/ui/scroll-reveal";
import { SlidingTabs } from "@/components/ui/sliding-tabs";
import "@/app/docs/docs.css";

type GroupFilter = "all" | "Authentication" | "Investigations & Verification";

type EndpointField = {
  name: string;
  type: string;
  required?: boolean;
  description: string;
};

type EndpointResponse = {
  status: string;
  description: string;
};

type EndpointSpec = {
  id: string;
  group: "Authentication" | "Investigations & Verification";
  method: "GET" | "POST";
  path: string;
  auth: "Public" | "Authenticated";
  summary: string;
  fields?: EndpointField[];
  responses: EndpointResponse[];
  curl: string;
  ts: string;
  sampleJson: string;
};

const ENDPOINTS: EndpointSpec[] = [
  {
    id: "auth-signup",
    group: "Authentication",
    method: "POST",
    path: "/api/auth/signup",
    auth: "Public",
    summary: "Create a PatchSignal workspace account and start an authenticated session",
    fields: [
      { name: "email", type: "string", required: true, description: "Account email address" },
      { name: "password", type: "string", required: true, description: "Minimum 8 characters" },
      { name: "name", type: "string", description: "Optional maintainer display name" },
    ],
    responses: [
      { status: "201", description: "Account created with active session and token" },
      { status: "400", description: "Invalid email format or password length" },
      { status: "409", description: "Email address already registered" },
      { status: "429", description: "Too many authentication attempts" },
    ],
    curl: `curl -X POST http://localhost:3000/api/auth/signup \\
  -H "Content-Type: application/json" \\
  -d '{"email":"maintainer@project.org","password":"strong-password-1","name":"Ada Lovelace"}'`,
    ts: `const res = await fetch("/api/auth/signup", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    email: "maintainer@project.org",
    password: "strong-password-1",
    name: "Ada Lovelace",
  }),
});
const profile = await res.json();`,
    sampleJson: `{
  "id": "usr_01J9A7K2",
  "email": "maintainer@project.org",
  "name": "Ada Lovelace",
  "createdAt": "2026-11-25T18:00:00.000Z"
}`,
  },
  {
    id: "auth-login",
    group: "Authentication",
    method: "POST",
    path: "/api/auth/login",
    auth: "Public",
    summary: "Sign in with existing credentials and issue an authenticated session",
    fields: [
      { name: "email", type: "string", required: true, description: "Registered email address" },
      { name: "password", type: "string", required: true, description: "Account password" },
    ],
    responses: [
      { status: "200", description: "Signed-in profile with active session" },
      { status: "401", description: "Invalid email or password" },
      { status: "429", description: "Too many login attempts" },
    ],
    curl: `curl -X POST http://localhost:3000/api/auth/login \\
  -H "Content-Type: application/json" \\
  -d '{"email":"maintainer@project.org","password":"strong-password-1"}'`,
    ts: `const res = await fetch("/api/auth/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    email: "maintainer@project.org",
    password: "strong-password-1",
  }),
});`,
    sampleJson: `{
  "id": "usr_01J9A7K2",
  "email": "maintainer@project.org",
  "lastLoginAt": "2026-11-25T18:10:00.000Z"
}`,
  },
  {
    id: "auth-logout",
    group: "Authentication",
    method: "POST",
    path: "/api/auth/logout",
    auth: "Public",
    summary: "Revoke the active workspace session and sign out",
    responses: [{ status: "200", description: "Session cleared cleanly" }],
    curl: `curl -X POST http://localhost:3000/api/auth/logout`,
    ts: `await fetch("/api/auth/logout", { method: "POST" });`,
    sampleJson: `{
  "ok": true
}`,
  },
  {
    id: "auth-me",
    group: "Authentication",
    method: "GET",
    path: "/api/auth/me",
    auth: "Authenticated",
    summary: "Return the currently signed-in account profile",
    responses: [
      { status: "200", description: "Authenticated user profile" },
      { status: "401", description: "Missing or expired session credentials" },
    ],
    curl: `curl http://localhost:3000/api/auth/me \\
  -H "Authorization: Bearer <token>"`,
    ts: `const res = await fetch("/api/auth/me", {
  headers: { Authorization: "Bearer " + token },
});
const me = await res.json();`,
    sampleJson: `{
  "id": "usr_01J9A7K2",
  "email": "maintainer@project.org",
  "name": "Ada Lovelace"
}`,
  },
  {
    id: "health",
    group: "Investigations & Verification",
    method: "GET",
    path: "/api/health",
    auth: "Public",
    summary: "Check service availability and active runner connectivity",
    responses: [{ status: "200", description: "Service health status payload" }],
    curl: `curl http://localhost:3000/api/health`,
    ts: `const res = await fetch("/api/health");
const status = await res.json();`,
    sampleJson: `{
  "ok": true,
  "runner": "reachable"
}`,
  },
  {
    id: "openapi",
    group: "Investigations & Verification",
    method: "GET",
    path: "/api/openapi",
    auth: "Public",
    summary: "Fetch the OpenAPI 3.0 specification document as JSON",
    responses: [{ status: "200", description: "Machine-readable OpenAPI 3.0 JSON" }],
    curl: `curl http://localhost:3000/api/openapi`,
    ts: `const spec = await fetch("/api/openapi").then((r) => r.json());`,
    sampleJson: `{
  "openapi": "3.0.3",
  "info": { "title": "PatchSignal API", "version": "0.1.0" }
}`,
  },
  {
    id: "inv-list",
    group: "Investigations & Verification",
    method: "GET",
    path: "/api/investigations",
    auth: "Authenticated",
    summary: "List your bug investigations ordered newest first (up to 50)",
    responses: [
      { status: "200", description: "Array of investigation summaries" },
      { status: "401", description: "Authentication required" },
    ],
    curl: `curl http://localhost:3000/api/investigations \\
  -H "Authorization: Bearer <token>"`,
    ts: `const res = await fetch("/api/investigations", {
  headers: { Authorization: "Bearer " + token },
});
const { investigations } = await res.json();`,
    sampleJson: `{
  "investigations": [
    {
      "id": "inv_12345",
      "owner": "meridian-dev",
      "repo": "checkout-sdk",
      "stage": "ran",
      "status": "Reproduced"
    }
  ]
}`,
  },
  {
    id: "inv-create",
    group: "Investigations & Verification",
    method: "POST",
    path: "/api/investigations",
    auth: "Authenticated",
    summary: "Stage 1: submit a public GitHub repository, bug report details, and up to 3 screenshots",
    fields: [
      { name: "repoUrl", type: "string", required: true, description: "Public https://github.com/owner/repo link" },
      { name: "description", type: "string", required: true, description: "Primary bug report summary" },
      { name: "expected", type: "string", description: "Expected application behavior" },
      { name: "actual", type: "string", description: "Observed failure behavior" },
      { name: "steps", type: "string", description: "Reproduction steps" },
      { name: "environment", type: "string", description: "Runtime, browser, or OS details" },
      { name: "errorText", type: "string", description: "Optional console or stack trace text" },
      { name: "screenshots", type: "file[]", description: "Up to 3 PNG/JPEG images (5 MB max each)" },
    ],
    responses: [
      { status: "201", description: "Created investigation identifier and attachment count" },
      { status: "400", description: "Missing required fields or invalid screenshot file" },
      { status: "403", description: "Repository outside configured allowlist policy" },
    ],
    curl: `curl -X POST http://localhost:3000/api/investigations \\
  -H "Authorization: Bearer <token>" \\
  -F "repoUrl=https://github.com/patchsignal/demo-signup" \\
  -F "description=Sign-up rejects ade+test@gmail.com"`,
    ts: `const fd = new FormData();
fd.append("repoUrl", "https://github.com/patchsignal/demo-signup");
fd.append("description", "Sign-up rejects ade+test@gmail.com");

const res = await fetch("/api/investigations", {
  method: "POST",
  body: fd,
});`,
    sampleJson: `{
  "id": "inv_12345",
  "stage": "intake",
  "attachmentCount": 1
}`,
  },
  {
    id: "inv-get",
    group: "Investigations & Verification",
    method: "GET",
    path: "/api/investigations/{id}",
    auth: "Authenticated",
    summary: "Retrieve the full investigation timeline, evidence items, runs, and latest verdict",
    responses: [
      { status: "200", description: "Complete investigation record" },
      { status: "404", description: "Investigation not found for this account" },
    ],
    curl: `curl http://localhost:3000/api/investigations/inv_12345 \\
  -H "Authorization: Bearer <token>"`,
    ts: `const res = await fetch("/api/investigations/inv_12345", {
  headers: { Authorization: "Bearer " + token },
});
const detail = await res.json();`,
    sampleJson: `{
  "id": "inv_12345",
  "owner": "patchsignal",
  "repo": "demo-signup",
  "stage": "packaged",
  "status": "Reproduced"
}`,
  },
  {
    id: "inv-events",
    group: "Investigations & Verification",
    method: "GET",
    path: "/api/investigations/{id}/events",
    auth: "Authenticated",
    summary: "Subscribe to Server-Sent Events (SSE) for real-time stage updates",
    responses: [{ status: "200", description: "Event stream (text/event-stream)" }],
    curl: `curl -N http://localhost:3000/api/investigations/inv_12345/events \\
  -H "Authorization: Bearer <token>"`,
    ts: `const events = new EventSource("/api/investigations/inv_12345/events");
events.onmessage = (ev) => console.log(JSON.parse(ev.data));`,
    sampleJson: `event: stage
data: {"id":"inv_12345","stage":"analyzed"}`,
  },
  {
    id: "inv-analyze",
    group: "Investigations & Verification",
    method: "POST",
    path: "/api/investigations/{id}/analyze",
    auth: "Authenticated",
    summary: "Stage 2: queue automated evidence extraction separating observed facts from open questions",
    responses: [
      { status: "202", description: "Background analysis job queued; poll investigation until completed" },
      { status: "200", description: "Evidence analysis already completed" },
      { status: "503", description: "Background queue temporarily unavailable" },
    ],
    curl: `curl -X POST http://localhost:3000/api/investigations/inv_12345/analyze \\
  -H "Authorization: Bearer <token>"`,
    ts: `const res = await fetch("/api/investigations/inv_12345/analyze", {
  method: "POST",
});`,
    sampleJson: `{
  "jobId": "job_01J9AB",
  "status": "queued"
}`,
  },
  {
    id: "inv-inspect",
    group: "Investigations & Verification",
    method: "POST",
    path: "/api/investigations/{id}/inspect",
    auth: "Authenticated",
    summary: "Stage 3: pin the target commit SHA and inspect the repository file tree",
    responses: [{ status: "200", description: "Default branch, commit SHA, and detected stack" }],
    curl: `curl -X POST http://localhost:3000/api/investigations/inv_12345/inspect \\
  -H "Authorization: Bearer <token>"`,
    ts: `const res = await fetch("/api/investigations/inv_12345/inspect", {
  method: "POST",
});
const tree = await res.json();`,
    sampleJson: `{
  "defaultBranch": "main",
  "sha": "8f4c21a9d0b1e23c4a5b6c7d8e9f001122334455",
  "ecosystem": "typescript"
}`,
  },
  {
    id: "inv-hypotheses",
    group: "Investigations & Verification",
    method: "POST",
    path: "/api/investigations/{id}/hypotheses",
    auth: "Authenticated",
    summary: "Stage 4: generate a repository-aware root-cause hypothesis and validated reproduction test",
    fields: [
      { name: "statement", type: "string", description: "Optional hypothesis statement override" },
      { name: "triggerConditions", type: "string", description: "Optional trigger input conditions" },
      { name: "expectedFailure", type: "string", description: "Optional expected assertion message" },
      { name: "targetFile", type: "string", description: "Optional source file path hint" },
    ],
    responses: [
      { status: "201", description: "Hypothesis and validated reproduction test artifact" },
      { status: "400", description: "Unsupported project stack or invalid test import paths" },
      { status: "502", description: "Upstream analysis service temporarily failed" },
    ],
    curl: `curl -X POST http://localhost:3000/api/investigations/inv_12345/hypotheses \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{}'`,
    ts: `const res = await fetch("/api/investigations/inv_12345/hypotheses", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({}),
});`,
    sampleJson: `{
  "statement": "Email regex omits '+' in local-part validation",
  "path": "tests/patchsignal/repro-email-plus.test.ts"
}`,
  },
  {
    id: "inv-runs",
    group: "Investigations & Verification",
    method: "POST",
    path: "/api/investigations/{id}/runs",
    auth: "Authenticated",
    summary: "Stages 5–6: execute the reproduction test in an isolated environment and assign the verdict",
    fields: [
      { name: "image", type: "string", description: "Pinned target build reference for isolated runner mode" },
      { name: "controlImage", type: "string", description: "Optional baseline build reference" },
      { name: "target", type: "object", description: "Manual outcome payload when recording offline results" },
      { name: "control", type: "object", description: "Optional manual baseline outcome payload" },
    ],
    responses: [{ status: "200", description: "Target/baseline run outputs and deterministic verdict" }],
    curl: `curl -X POST http://localhost:3000/api/investigations/inv_12345/runs \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{"image":"target-build@sha256:abc123"}'`,
    ts: `const res = await fetch("/api/investigations/inv_12345/runs", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ image: "target-build@sha256:abc123" }),
});`,
    sampleJson: `{
  "status": "Reproduced",
  "target": { "outcome": "failed", "exitCode": 1 },
  "control": { "outcome": "passed", "exitCode": 0 }
}`,
  },
  {
    id: "inv-remediate",
    group: "Investigations & Verification",
    method: "POST",
    path: "/api/investigations/{id}/remediate",
    auth: "Authenticated",
    summary: "Diagnose the root cause, propose file fixes, and iterate inside an isolated container/sandbox until checks pass",
    fields: [
      { name: "maxAttempts", type: "number", description: "Maximum repair attempts before stopping (1–5, default 3)" },
      { name: "customInstruction", type: "string", description: "Optional maintainer hint or file focus guidance" },
    ],
    responses: [
      { status: "200", description: "Remediation status, code patches, iteration logs, and pending PR draft" },
      { status: "502", description: "Fix generation or sandbox execution failed" },
    ],
    curl: `curl -X POST http://localhost:3000/api/investigations/inv_12345/remediate \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{"maxAttempts":3}'`,
    ts: `const res = await fetch("/api/investigations/inv_12345/remediate", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ maxAttempts: 3 }),
});`,
    sampleJson: `{
  "remediation": {
    "status": "succeeded",
    "currentAttempt": 1,
    "pr": { "status": "awaiting_approval", "branchName": "patchsignal/fix-inv12345" }
  }
}`,
  },
  {
    id: "inv-pr",
    group: "Investigations & Verification",
    method: "POST",
    path: "/api/investigations/{id}/pr",
    auth: "Authenticated",
    summary: "After explicit user approval, push verified fix commits to a branch and open a GitHub Pull Request",
    fields: [
      { name: "approved", type: "boolean", required: true, description: "Must be true to grant explicit permission to open a PR" },
      { name: "draft", type: "boolean", description: "Open as Draft Pull Request until GitHub Actions pass (default true)" },
      { name: "title", type: "string", description: "Optional edited Pull Request title" },
      { name: "body", type: "string", description: "Optional edited Pull Request body markdown" },
      { name: "branchName", type: "string", description: "Optional target branch name" },
    ],
    responses: [
      { status: "201", description: "Pull Request created with URL, number, and head commit SHA" },
      { status: "400", description: "Explicit approval missing or no verified patches available" },
      { status: "403", description: "Write-scoped GitHub token required to create branch/PR" },
    ],
    curl: `curl -X POST http://localhost:3000/api/investigations/inv_12345/pr \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{"approved":true,"draft":true}'`,
    ts: `const res = await fetch("/api/investigations/inv_12345/pr", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ approved: true, draft: true }),
});`,
    sampleJson: `{
  "pr": {
    "status": "created",
    "draft": true,
    "prNumber": 42,
    "prUrl": "https://github.com/owner/repo/pull/42"
  }
}`,
  },
  {
    id: "inv-pr-checks",
    group: "Investigations & Verification",
    method: "GET",
    path: "/api/investigations/{id}/pr/checks",
    auth: "Authenticated",
    summary: "Fetch GitHub Actions check runs and failure logs for the open Pull Request (POST with action: mark_ready promotes Draft to Ready)",
    fields: [],
    responses: [
      { status: "200", description: "Current CI status, individual check runs, and extracted failure logs" },
      { status: "400", description: "No open Pull Request found for this investigation" },
    ],
    curl: `curl http://localhost:3000/api/investigations/inv_12345/pr/checks \\
  -H "Authorization: Bearer <token>"`,
    ts: `const res = await fetch("/api/investigations/inv_12345/pr/checks");`,
    sampleJson: `{
  "ciStatus": "failed",
  "checks": [
    { "name": "Verify FarmHand / full-stack", "status": "completed", "conclusion": "failure" }
  ]
}`,
  },
  {
    id: "inv-pr-repair",
    group: "Investigations & Verification",
    method: "POST",
    path: "/api/investigations/{id}/pr/repair",
    auth: "Authenticated",
    summary: "Feed failing GitHub Actions logs into the remediation loop, verify locally, and push a follow-up commit onto the open PR branch",
    fields: [
      { name: "approved", type: "boolean", required: true, description: "Explicit permission to run repair and push a follow-up commit" },
      { name: "maxAttempts", type: "number", description: "Maximum fix attempts (1-5, default 3)" },
      { name: "customInstruction", type: "string", description: "Optional maintainer hint for CI repair" },
    ],
    responses: [
      { status: "200", description: "Updated remediation run and Pull Request head SHA" },
      { status: "400", description: "Approval missing or no failing checks detected" },
      { status: "403", description: "Write-scoped GitHub token required" },
    ],
    curl: `curl -X POST http://localhost:3000/api/investigations/inv_12345/pr/repair \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{"approved":true}'`,
    ts: `const res = await fetch("/api/investigations/inv_12345/pr/repair", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ approved: true }),
});`,
    sampleJson: `{
  "pushed": true,
  "pr": {
    "status": "created",
    "ciStatus": "pending",
    "ciRepairRounds": 1
  }
}`,
  },
  {
    id: "inv-package",
    group: "Investigations & Verification",
    method: "GET",
    path: "/api/investigations/{id}/package",
    auth: "Authenticated",
    summary: "Stage 7: compile an editable Markdown brief and prefilled GitHub issue draft link",
    responses: [{ status: "200", description: "Markdown report, issue draft URL, and readiness flags" }],
    curl: `curl http://localhost:3000/api/investigations/inv_12345/package \\
  -H "Authorization: Bearer <token>"`,
    ts: `const pkg = await fetch("/api/investigations/inv_12345/package").then((r) => r.json());`,
    sampleJson: `{
  "readyToFile": true,
  "blockingUnknowns": 0,
  "issueUrl": "https://github.com/patchsignal/demo-signup/issues/new?title=..."
}`,
  },
  {
    id: "files-get",
    group: "Investigations & Verification",
    method: "GET",
    path: "/api/files/{attachmentId}",
    auth: "Authenticated",
    summary: "Retrieve metadata and preview URL for an investigation screenshot you own",
    responses: [
      { status: "200", description: "Attachment metadata and secure preview link" },
      { status: "404", description: "Attachment not found or owned by another account" },
    ],
    curl: `curl http://localhost:3000/api/files/att_12345 \\
  -H "Authorization: Bearer <token>"`,
    ts: `const file = await fetch("/api/files/att_12345").then((r) => r.json());`,
    sampleJson: `{
  "id": "att_12345",
  "mime": "image/png",
  "sizeBytes": 148204
}`,
  },
];

export function DocsPageClient({
  initialAuthenticated = false,
}: {
  initialAuthenticated?: boolean;
}) {
  const isAuthenticated = initialAuthenticated;
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const [groupFilter, setGroupFilter] = React.useState<GroupFilter>("all");
  const [specVersion, setSpecVersion] = React.useState("0.1.0");
  const [loadingSpec, setLoadingSpec] = React.useState(true);
  const [paletteOpen, setPaletteOpen] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    fetch("/api/openapi", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { info?: { version?: string } } | null) => {
        if (!cancelled && data?.info?.version) setSpecVersion(data.info.version);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingSpec(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const normalized = query.trim().toLowerCase();
  const visibleEndpoints = ENDPOINTS.filter((ep) => {
    if (groupFilter !== "all" && ep.group !== groupFilter) return false;
    if (!normalized) return true;
    return (
      ep.path.toLowerCase().includes(normalized) ||
      ep.summary.toLowerCase().includes(normalized) ||
      ep.method.toLowerCase().includes(normalized)
    );
  });

  const groups: Array<"Authentication" | "Investigations & Verification"> = [
    "Authentication",
    "Investigations & Verification",
  ];

  const paletteItems = React.useMemo<CommandPaletteItem[]>(() => {
    const items: CommandPaletteItem[] = ENDPOINTS.map((ep) => ({
      id: `ep-${ep.id}`,
      group: ep.group,
      label: `${ep.method} ${ep.path}`,
      subtitle: ep.summary,
      badge: ep.auth,
      keywords: [ep.group, ep.method, ep.path],
      icon: <TerminalSquare size={16} strokeWidth={1.5} />,
      onSelect: () => {
        setGroupFilter("all");
        setQuery("");
        window.requestAnimationFrame(() => {
          document.getElementById(ep.id)?.scrollIntoView({ behavior: "smooth" });
        });
      },
    }));

    items.push(
      {
        id: "nav-dashboard",
        group: "Navigation",
        label: "Open operations dashboard",
        icon: <TerminalSquare size={16} strokeWidth={1.5} />,
        onSelect: () => router.push("/dashboard"),
      },
      {
        id: "nav-workspace",
        group: "Navigation",
        label: "Open verification workspace",
        icon: <FolderGit2 size={16} strokeWidth={1.5} />,
        onSelect: () => router.push("/workspace"),
      },
      ...(!isAuthenticated
        ? [
            {
              id: "nav-login",
              group: "Navigation",
              label: "Sign in to account",
              icon: <LogIn size={16} strokeWidth={1.5} />,
              onSelect: () => router.push("/login"),
            },
          ]
        : [])
    );

    return items;
  }, [router, isAuthenticated]);

  return (
    <div className="docs-shell">
      <header className="docs-header">
        <div className="docs-header__inner">
          <div className="docs-header__left">
            <Link href="/" className="docs-brand">
              <BrandMark size={20} pulseColor="#A3E635" animated />
              <span>PatchSignal</span>
            </Link>
            <span className="docs-header__sep" aria-hidden="true">
              /
            </span>
            <span className="docs-header__label">API Reference</span>
            <span
              className="docs-version-tag mono num"
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              {loadingSpec ? <Spinner size={12} label="Loading OpenAPI version" /> : null}
              <span>v{specVersion}</span>
            </span>
          </div>

          <div className="docs-header__right">
            <CommandPaletteTrigger
              className="docs-cmd-trigger"
              onClick={() => setPaletteOpen(true)}
            >
              Jump to endpoint…
            </CommandPaletteTrigger>
            <div className="docs-search">
              <Search size={15} strokeWidth={1.5} aria-hidden="true" />
              <input
                type="search"
                aria-label="Filter API endpoints"
                placeholder="Filter endpoints"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <Link href={isAuthenticated ? "/workspace" : "/dashboard"} className="docs-header__link">
              {isAuthenticated ? "Workspace" : "Dashboard"}
            </Link>
            {!isAuthenticated ? (
              <Link href="/login" className="docs-header__link">
                Sign in
              </Link>
            ) : null}
            <Link href={isAuthenticated ? "/dashboard" : "/workspace"} className="docs-header__cta">
              <span>{isAuthenticated ? "Dashboard" : "Open workspace"}</span>
              <ArrowRight size={14} strokeWidth={1.75} aria-hidden="true" />
            </Link>
          </div>
        </div>
      </header>

      <div className="docs-layout">
        <nav className="docs-rail" aria-label="API endpoints">
          {groups.map((group) => {
            const items = visibleEndpoints.filter((ep) => ep.group === group);
            if (items.length === 0) return null;
            return (
              <div key={group} className="docs-rail__group">
                <div className="docs-rail__title">{group}</div>
                {items.map((ep) => (
                  <a key={ep.id} href={`#${ep.id}`} className="docs-rail__item">
                    <span
                      className={`docs-method docs-method--sm ${
                        ep.method === "POST" ? "docs-method--post" : "docs-method--get"
                      }`}
                    >
                      {ep.method}
                    </span>
                    <span className="docs-rail__path">{ep.path}</span>
                  </a>
                ))}
              </div>
            );
          })}
        </nav>

        <main id="main-content" className="docs-main">
          <div className="docs-intro">
            <div className="docs-intro__top">
              <div>
                <h1 className="docs-h1">PatchSignal API Reference</h1>
                <p className="docs-lead">
                  Endpoints for account sessions, seven-stage bug investigation workflows, and prefilled GitHub issue briefs. Specification JSON is published at{" "}
                  <a href="/api/openapi" className="docs-openapi-link">
                    <code>/api/openapi</code>
                  </a>
                  .
                </p>
              </div>
            </div>

            <SlidingTabs
              ariaLabel="Filter endpoint group"
              mode="group"
              variant="pill"
              value={groupFilter}
              onChange={setGroupFilter}
              items={[
                { id: "all", label: "All endpoints", count: ENDPOINTS.length },
                {
                  id: "Authentication",
                  label: "Authentication",
                  count: ENDPOINTS.filter((e) => e.group === "Authentication").length,
                },
                {
                  id: "Investigations & Verification",
                  label: "Investigations & Verification",
                  count: ENDPOINTS.filter((e) => e.group === "Investigations & Verification")
                    .length,
                },
              ]}
            />
          </div>

          {groups.map((group) => {
            const items = visibleEndpoints.filter((ep) => ep.group === group);
            if (items.length === 0) return null;
            return (
              <section key={group} className="docs-section" aria-label={group}>
                <h2 className="docs-section__title">{group}</h2>

                {items.map((ep) => (
                  <ScrollReveal key={ep.id}>
                    <article id={ep.id} className="docs-card">
                      <div className="docs-card__head">
                        <div className="docs-card__sig">
                          <span
                            className={`docs-method ${
                              ep.method === "POST" ? "docs-method--post" : "docs-method--get"
                            }`}
                          >
                            {ep.method}
                          </span>
                          <code className="docs-path">{ep.path}</code>
                        </div>
                        <span className="docs-auth-tag">
                          {ep.auth === "Authenticated" ? (
                            <span className="ps-signal-dot" aria-hidden="true" />
                          ) : null}
                          {ep.auth}
                        </span>
                      </div>

                      <div className="docs-card__grid">
                        {/* Left Specification Column */}
                        <div className="docs-card__spec">
                          <p className="docs-summary">{ep.summary}</p>

                          {ep.fields && ep.fields.length > 0 ? (
                            <div className="docs-block">
                              <div className="docs-subhead">Request fields</div>
                              <div className="docs-table-wrap">
                                <table className="docs-table">
                                  <thead>
                                    <tr>
                                      <th scope="col">Field</th>
                                      <th scope="col">Type</th>
                                      <th scope="col">Description</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {ep.fields.map((field) => (
                                      <tr key={field.name}>
                                        <td>
                                          <code>{field.name}</code>
                                          {field.required ? (
                                            <span className="docs-req-tag">required</span>
                                          ) : null}
                                        </td>
                                        <td>
                                          <code>{field.type}</code>
                                        </td>
                                        <td>{field.description}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          ) : null}

                          <div className="docs-block">
                            <div className="docs-subhead">Responses</div>
                            <div className="docs-table-wrap">
                              <table className="docs-table">
                                <thead>
                                  <tr>
                                    <th scope="col">Status</th>
                                    <th scope="col">Meaning</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {ep.responses.map((res) => (
                                    <tr key={res.status}>
                                      <td className="num">
                                        <code>{res.status}</code>
                                      </td>
                                      <td>{res.description}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        </div>

                        {/* Right Multi-Tab Code & Payload Column */}
                        <div className="docs-card__code">
                          <CodeBlockTabs
                            tabs={[
                              { id: "curl", label: "cURL", code: ep.curl },
                              { id: "ts", label: "TypeScript", code: ep.ts },
                              { id: "json", label: "Response", code: ep.sampleJson },
                            ]}
                          />
                        </div>
                      </div>
                    </article>
                  </ScrollReveal>
                ))}
              </section>
            );
          })}
        </main>
      </div>

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        items={paletteItems}
        placeholder="Jump to endpoint by path or keyword…"
      />
    </div>
  );
}

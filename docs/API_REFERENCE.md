# PatchSignal Backend — Frontend API Reference (v0.1.0)

Backend for evidence-backed bug investigation. The frontend drives a 7-stage flow per investigation and renders the evidence package. Interactive Swagger UI and raw OpenAPI are served by the backend itself.

| Item | Value |
|---|---|
| Local base URL | `http://localhost:3000` |
| Production base URL | `https://patchsignal-backend.onrender.com` |
| Swagger UI | `{base}/docs` (click Authorize, paste token only) |
| OpenAPI JSON | `{base}/api/openapi` |
| Auth scheme | `Authorization: Bearer <JWT>` (7-day expiry) |
| Request/response format | JSON, except intake (`multipart/form-data`) and events (`text/event-stream`) |

> Note: on Render's free tier the service sleeps when idle. The first request can take ~60s or return 502 once — wait and reload.

## 1. End-to-end flow (call order)

1. `POST /api/auth/signup` (once) → save `token`
2. `POST /api/investigations` (multipart: repoUrl, description, screenshots) → save `id`
3. `POST /api/investigations/:id/analyze` → 202 job; poll GET until analysisJob.status is completed before inspection
4. `POST /api/investigations/:id/inspect` → pinned commit SHA, file tree, ecosystem
5. `POST /api/investigations/:id/hypotheses` → hypothesis + candidate Vitest
6. `POST /api/investigations/:id/runs` → execution result + deterministic status
7. `GET /api/investigations/:id/package` → markdown + prefilled GitHub issue URL
8. `GET /api/investigations/:id` anytime → full state; `GET .../events` → SSE stage progress

Poll `GET /:id` or consume the SSE stream for progress. Stage values: `intake → analyzed → inspected → hypothesized → ran → packaged`.

## 2. Authentication

All `/api/investigations/*` and `/api/files/*` routes require `Authorization: Bearer <token>`. Without it they return `401 {"error":"Bearer token required"}`. Objects are scoped per user: reading another user's investigation returns `404 {"error":"not found"}` (no existence leak). Public routes: `/api/health`, `/api/openapi`, `/docs`, `/api/auth/signup`, `/api/auth/login`.

### POST /api/auth/signup — register (public)

Body (JSON): `email` (required, valid email), `password` (required, min 8 chars), `name` (optional).

```
// 201
{ "id": "cmvb20xj...", "email": "you@example.com", "name": "You",
  "createdAt": "2026-10-16T14:19:53.183Z",
  "token": "eyJhbGciOi..." }
```

Errors: `400` bad email/short password, `409` email already registered, `503` auth misconfigured.

### POST /api/auth/login — login (public)

Body (JSON): `email`, `password`.

```
// 200
{ "id": "...", "email": "...", "name": "...", "createdAt": "...", "token": "eyJhbGciOi..." }
```

Errors: `401 {"error":"invalid credentials"}` (same for unknown email and wrong password).

### GET /api/auth/me — current user (Bearer)

```
// 200
{ "id": "...", "email": "...", "name": "...", "createdAt": "..." }
```

Frontend snippet:

```
const r = await fetch(base + "/api/auth/login", { method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email, password }) });
const { token } = await r.json();
localStorage.setItem("ps_token", token);
// later:
fetch(url, { headers: { Authorization: "Bearer " + localStorage.getItem("ps_token") } });
```

## 3. System

### GET /api/health — health (public)

```
// 200
{ "ok": true, "db": { "ok": true }, "runner": "http://localhost:5001", "store": "postgres" }
```

`store` is `postgres` (DATABASE_URL set) or `memory` (dev fallback). `db.ok false` means the API runs degraded.

## 4. Investigations

### POST /api/investigations — Stage 1 intake (Bearer, multipart)

Form fields:

| Field | Required | Notes |
|---|---|---|
| repoUrl | yes | Public `https://github.com/{owner}/{repo}` only; other hosts → 400 |
| description | yes | Free text, any language |
| expected / actual / steps / environment / errorText | no | Empty ones become Unknowns later |
| screenshots | no | 1–3 files, PNG/JPEG only, 5MB max each |

Local testing accepts any public repo (`ALLOWLIST_REPOS=*`); the hosted demo allowlists curated repos (others → `403`).

```
// 201
{ "id": "inv_e0497925", "store": "postgres", "attachments": 2 }
```

Screenshots upload to Cloudinary (server-side, signed); the response counts them. Their URLs come back inside `GET /:id` → `attachments[]` (`secureUrl` on the Cloudinary CDN — render with `f_auto,q_auto`).

Frontend upload snippet:

```
const form = new FormData();
form.append("repoUrl", repoUrl);
form.append("description", description);
form.append("expected", expected);
files.slice(0, 3).forEach(f => form.append("screenshots", f));
const r = await fetch(base + "/api/investigations", { method: "POST",
  headers: { Authorization: "Bearer " + token }, body: form });
// do NOT set content-type manually — the browser adds the multipart boundary
```

### GET /api/investigations/:id — full state (Bearer)

Returns the investigation with nested `evidence[]`, `questions[]`, `hypotheses[]` (each with `tests[]`, `runs[]`), `attachments[]`, `classifications[]`, plus `stage`, `status`, `commitSha`, `controlSha`. This is the main read model for evidence-review screens. `404` when missing or owned by another user.

### GET /api/investigations/:id/events — SSE progress (Bearer)

`Content-Type: text/event-stream`, emits `event: stage` + `data: {"id","stage"}`, then `event: done`. Note: browser `EventSource` cannot set headers — use `fetch` + reader with the Authorization header.

### POST /api/investigations/:id/analyze — Stage 2 extraction (Bearer)

Persists a background analysis job and responds immediately. It does not hold the HTTP connection open during model generation.

```json
{
  "id": "inv_example",
  "analysisJob": {"id":"job_example","status":"queued","error":null,"updatedAt":"2026-10-16T19:00:00Z"}
}
```

Response: **202 Accepted**, `Retry-After: 5`, `Cache-Control: no-store`. Poll authenticated `GET /api/investigations/:id` every five seconds. Its `analysisJob` contains `id`, `status` (`queued`, `running`, `completed`, `failed`), safe `error` and `updatedAt`. Lease tokens and internal attempt state are not public. Successful completion saves evidence/questions, sets `stage: analyzed` and completes the job atomically. Failure leaves the investigation without a verdict and exposes a retryable job error. Missing model configuration still produces explicitly labelled cached evidence (`modelId: cached-demo`). The worker preserves configured provider selection and passes up to three HTTPS screenshot URLs to URL-capable providers (Groq); the Gemini path still receives no image parts.

Repeated POSTs while queued/running return the same job; an explicit POST after failure requeues it. Already analyzed investigations return 200 without rerunning analysis. A database/migration error returns 503 before acceptance. Model failure is recorded on the job, not delivered later through the original POST response.

The model budget is one primary attempt and one fallback, each bounded to 25 seconds including cancellation, with a one-second delay between them. A hung SDK call is rejected even if it ignores cancellation. Queue waiting time depends on backlog. Postgres leases recover interrupted work on server startup and stop after three interruptions. This worker requires a long-lived Node process (Render web service); ephemeral serverless backend hosting needs a separate durable worker.

Provenance rules remain unchanged: observed facts require image/run evidence, reporter claims stay unverified, hypotheses need testing and blocking unknowns gate filing. GET investigation retains its documented Prisma/memory evidence shape.

### POST /api/investigations/:id/inspect — Stage 3 repo pin (Bearer)

Reads repo metadata, default branch, latest commit SHA, recursive tree, manifest via the GitHub API (server token; never clones).

```
// 200
{ "defaultBranch": "main", "sha": "9f5b8b4...",
  "fileCount": 128, "paths": ["src/...", "..."],
  "manifest": "package.json", "pkg": { ... },
  "ecosystem": "node-vitest" }
```

`ecosystem` is `node-vitest` or `unsupported` (unsupported → investigation ends `Inconclusive` with reason).

### POST /api/investigations/:id/hypotheses — Stage 4 (Bearer)

Body (JSON, all optional — defaults target the demo plus-sign bug): `statement`, `triggerConditions`, `expectedFailure`, `evidenceNeeded`.

```
// 201
{ "statement": "Email validation may exclude the plus sign",
  "triggerConditions": "Sign up with ade+test@gmail.com",
  "expectedFailure": "Form shows 'Invalid email address', expected account creation",
  "evidenceNeeded": "Vitest run failing with predicted assertion on target, passing on control",
  "path": "tests/patchsignal/repro-inv_e049.test.ts",
  "content": "import { describe ... } from \"vitest\"; ..." }
```

The test asserts correct behavior (fails on the bug, passes when fixed) and is stored as an artifact — never committed to the target repo.

### POST /api/investigations/:id/runs — Stages 5+6 (Bearer)

Two modes:

A. Docker path — body `{ "image": "<registry>/<repo>@sha256:<digest>", "controlImage": "..." }` dispatches target (+ control when `controlSha` exists) jobs to the runner and classifies. Each job: fresh container, no network, non-root, capped CPU/mem/pids, 120s kill.

B. Honest-inject path (no Docker needed) — body `{ "target": {...}, "control": {...} }` with each `{ role, outcome: passed|failed|error|timeout, exitCode, predictedAssertionFailed, unrelatedFailure }`. Only available when the server has no runner token configured; the response carries `"injected": true`.

```
// 200
{ "target": { "exitCode": 1, "outcome": "failed", ... }, "control": { ... },
  "status": "Reproduced", "rule": "CLS-2",
  "justification": "Target failed with predicted assertion (exit 1); control passed — test discriminates." }
```

Classification rules (deterministic, model never decides): `Reproduced` (CLS-2: target fails as predicted, control passes/absent); `Not_reproduced` (CLS-3: target passes — UI must note this does not prove absence); `Inconclusive` (CLS-4: setup/timeout/compile/unrelated failure — never file as proven). Render status in words, never color alone.

### GET /api/investigations/:id/package — Stage 7 (Bearer)

```
// 200
{ "markdown": "# PatchSignal evidence package — inv_...",
  "issueUrl": "https://github.com/{owner}/{repo}/issues/new?title=...&body=...",
  "copyToClipboard": false }
```

Render the markdown with an Edit-everything step, then an **Open on GitHub** button → `issueUrl` (prefilled new-issue page; nothing is ever posted automatically). If `copyToClipboard` is true the body exceeded URL limits — offer copy instead. Show "Not ready to file" while blocking unknowns remain.

### GET /api/files/:attachmentId — attachment lookup (Bearer)

Resolves an attachment to its Cloudinary `secureUrl`. In practice read `attachments[]` from `GET /:id` and hotlink the CDN URL directly.

## 5. Error catalog

| Code | Meaning | Frontend action |
|---|---|---|
| 400 | Bad input (URL, files, schema) | Show `error` string inline |
| 401 | Missing/invalid/expired token | Clear token → login screen |
| 403 | Repo outside hosted allowlist | Explain curated-demo restriction |
| 404 | Missing or another user's object | Treat as not found (no leak) |
| 409 | Email registered | Suggest login |
| 502 | Model/runner upstream failed | Show message + Retry button |
| 503 | Auth/model misconfigured | Contact backend / check env |

## 6. Limits and timing

Screenshots: 3 × 5MB PNG/JPEG. Analyze: up to ~30s (retries). Runner job: 120s max each. Render free tier: first request slow/502 on wake. JWT: 7 days, then re-login. Nothing is ever posted to GitHub by the API — filing is always a human click.

# PatchSignal — Demo Pack (judges + presentation)

## 1. One-liner

**PatchSignal turns open-source bug reports into inspectable investigations** — multimodal AI, repository-aware analysis, executable reproduction attempts, and evidence-backed results.

## 2. Problem statement (say this first, ~45s)

Maintainers drown in vague reports ("login doesn't work", a lone screenshot). The manual loop — interpret, inspect code, configure an environment, reproduce, ask follow-ups — burns hours. AI chatbots made it worse in one way: they generate *plausible* explanations and tests that prove nothing. A generated test might not run, might fail for an unrelated reason, or might test the wrong thing. The gap we close: **describing a possible defect vs. obtaining evidence you can investigate.**

## 3. Solution and core principle (~30s)

Given a public repo URL + report + screenshots, PatchSignal extracts structured evidence (Gemma 4), pins the repo commit, forms a hypothesis, generates a candidate test, **runs it in a disposable Docker sandbox**, and stamps one deterministic verdict: **Reproduced, Not reproduced, or Inconclusive** — with justification. Nothing is auto-filed to GitHub; a human clicks.

> An AI-generated explanation is a hypothesis. An observed execution result is evidence.

## 4. Architecture

```
Reporter / Frontend (teammate UI + Swagger /docs)
        │  HTTPS + Bearer JWT (per-user scoping, 404 on cross-user reads)
        ▼
Next.js 15 App Router (Node 24) ────────────── PostgreSQL (Render prod / PG18 local)
  ├─ /api/auth/* .................... signup/login/me (bcrypt-10, HS256 7d)
  ├─ POST intake .................... multipart, allowlist, Cloudinary screenshots
  ├─ POST analyze → 202 AnalysisJob ─▶ queue (Postgres) ─▶ worker (2s poll, 2-min lease, CAS claim)
  │       │                                              ├─ Gemini: gemma-4-31b-it → retry → gemma-4-26b-a4b-it
  │       │                                              └─ Groq (MODEL_PROVIDER=groq): GROQ_MODEL, forced tool call
  │       └─ Zod-validated record_evidence + provenance tags; modelId recorded per run
  ├─ POST inspect ................... Octokit read-only: SHA pin, tree, ecosystem detect;
  │                                     auto-Inconclusive (CLS-4) when unsupported
  ├─ POST hypotheses ................ one hypothesis + one Vitest (artifact, never committed)
  ├─ POST runs ...................... Docker path or honest-inject (token-absent only)
  ├─ Classification ................. deterministic rules CLS-2..4 — model explains, never decides
  ├─ GET package .................... markdown + prefilled issue URL (human files it)
  ├─ middleware ..................... CORS + per-request log line (Render observability)
  └─ Runner (separate host, token) ──▶ docker run --rm: no net, non-root, capped, 120s kill
```

Secrets live server-side only. Browser and containers never hold keys. Repo code is untrusted and never runs in the app process.

## 5. Implementation — code tour (file by file)

**Auth & request plumbing**
- `lib/auth.ts` — bcrypt hash/check, HS256 sign/verify (7d), `authUser()` (401s), `owns()` ownership gate. Users live in Postgres only.
- `middleware.ts` — CORS (env allowlist, `*` dev default, preflight 204) + `[api] METHOD path` log line so Render logs show traffic.
- `app/api/auth/{signup,login,me}/route.ts` — 201+token / 200+token / current user. Login 401 is generic either way.
- `app/page.tsx`, `app/docs/page.tsx` — backend index + Swagger UI (CDN, offline fallback list).

**Investigation pipeline** (`app/api/investigations/...`)
- `route.ts` (POST) — intake: github.com-only URL parse, allowlist (`*` = local testing), 1–3 PNG/JPEG ≤5MB, Cloudinary signed upload, `userId` scoping, memory-store fallback when no `DATABASE_URL`.
- `[id]/analyze/route.ts` — auth+owns, enqueue AnalysisJob → **202** (+`Retry-After`), dedupe while active; 503 only if the queue/DB is down.
- `[id]/inspect/route.ts` — SHA pin + tree + `node-vitest|unsupported`; **auto-Inconclusive CLS-4** on unsupported (official backend verdict, persisted).
- `[id]/hypotheses/route.ts` — one hypothesis + Vitest template asserting correct behavior; HYP-4 import check.
- `[id]/runs/route.ts` — Docker dispatch (target + control) or honest `"injected": true` classification when no runner token.
- `[id]/package/route.ts` — markdown + `issues/new?title=&body=` link, clipboard fallback past URL length.
- `[id]/events/route.ts` — SSE stage ticker (`fetch`-based, EventSource can't send Bearer).
- `app/api/files/[attachmentId]/route.ts` — attachment lookup (CDN serves bytes).

**AI layer**
- `lib/gemma/client.ts` — Gemini SDK, system prompt with prompt-injection data-blocks, images-before-text + sampling per gemma.ai best practices, `record_evidence` function declaration, 5-attempt schedule (31B×3, 26B×2) with validation errors fed back (EVD-6).
- `lib/groq/client.ts` — OpenAI-compatible fetch, forced tool call, Cloudinary image URLs as vision inputs, 3 attempts. Selected by `MODEL_PROVIDER=groq`.
- `lib/evidence/schema.ts` — Zod `record_evidence` shape, 4-tag provenance enum, `normalizeSource` for model wording variants.
- `lib/analysis/{jobs,worker,deadline}.ts` — durable queue: enqueue dedupe, CAS claim with 2-min lease, recovery ≤3 then visible fail, 25s bounded model calls, no fabricated verdicts; `instrumentation.ts` starts the worker (long-lived hosts only).
- `lib/github/client.ts` — Octokit read-only (meta, SHA, tree, file, issue search).
- `lib/cloudinary/client.ts` — signed server-side uploads, destroy on cleanup.

**Verification**
- `lib/classify/rules.ts` — CLS-2 Reproduced (target fails predicted + control passes), CLS-3 Not reproduced (target passes; ≠ proof of absence), CLS-4 Inconclusive (setup/timeout/compile/unrelated). + `rules.test.ts` (E1/E3/E4/E5/E6).
- `runner/src/server.ts` — token auth, one-job mutex, path-traversal rejection (`tests/patchsignal/*.test.ts` only), temp-dir mount `:ro`, `npx --no-install vitest run`, always `rm -f` (no orphans), digest resolve. Plus `provision-droplet.sh` + systemd unit for prod.
- `lib/store.ts` — process-global memory fallback (per-route module isolation forced `globalThis`).
- `prisma/schema.prisma` — User, Investigation, EvidenceItem, Question, Hypothesis, TestArtifact, Run, Classification, Attachment, AnalysisJob (+3 migrations).

## 6. Live demo script (~6 min)

Pre-demo: wake Render (hit `/api/health` twice), backend `npm start` uses migrate+start, runner up (`/health` → idle), tokens ready, screenshots ready (plus-sign signup error), one unsupported-eco repo URL ready.

| # | Min | Do (Swagger `/docs` or teammate UI) | Show |
|---|---|---|---|
| 1 | 0:00 | 30s pitch (§2) + principle (§3) | — |
| 2 | 0:45 | Signup → Authorize → intake with screenshot | 201 `{id}` |
| 3 | 1:30 | `POST analyze` → **202 job** → poll `GET :id` → evidence with tags + `modelId` | Observed vs Reported vs Hypothesis; Unknowns-as-questions |
| 4 | 3:00 | `inspect` → SHA + `node-vitest`; `hypotheses` → generated test | Template asserting correct behavior |
| 5 | 4:00 | `runs` (real Docker job) → **Reproduced + CLS-2 justification** | Exit code, digest, duration, logs |
| 6 | 5:00 | `package` → markdown + Open-on-GitHub (don't file); then the honest twin: unsupported repo → **Inconclusive CLS-4** | Human-only filing; "failed setup ≠ absent bug" |
| 7 | 5:45 | Close: metrics (25 tests/8 suites), deterministic rules, what's next (Adaption flywheel, more ecosystems) | — |

Branches: Gemini 503 spike → flip `MODEL_PROVIDER=groq` (same schema, recorded `modelId`); runner busy → 429, one-job v0.1; Render asleep → 60s wake warning; no Docker → honest-inject path, labelled `"injected": true`, never presented as a real run.

## 7. Metrics (verify before stage: `npm test`, `npm run typecheck`, production `next build`)

- 25 tests / 8 suites green (classify E-cases, queue CAS/lease/recovery, deadlines, provider clients, route gates)
- Typecheck + production build green; every run carries SHA, image digest, command, exit code, logs
- Live-verified: auth isolation (cross-user 404), allowlist 403→wildcard, PG round-trip, real Gemma 31B extraction, Docker timeout→`timeout` with no orphan containers
- False-reproduction rate target: zero (CLS-2 requires predicted failure + passing control)

## 8. Judge Q&A (the hard ones)

- *"Isn't this more AI slop?"* — Show the human-only filing step, the Unknowns list, and the Inconclusive case. The system is designed to say "I don't know" — status is computed, never generated.
- *"What if the model lies?"* — Zod rejects bad shapes; provenance tags separate observed from claimed; `normalizeSource` + validation-feedback retries fix wording without loosening rules.
- *"Why not auto-fix?"* — Out of scope by design; maintainers keep merge control. Evidence, not actions.
- *"Private repos / arbitrary ecosystems?"* — Allowlisted demo, read-only token, `node-vitest` only in v0.1; unsupported → Inconclusive with reason, never silent.
- *"Prompt injection via README?"* — Untrusted text sits in `<data>` blocks; status comes from code; model has no write tools (AT-6 pattern).
- *"Why two model providers?"* — Gemini hosts Gemma (prize path, open weights, self-hostable later); Groq is the reliability path for live demos. `modelId` on every extraction keeps it auditable.
- *"Scale?"* — Queue + leases already durable (crash recovery); runner moves to its own host(s); one-job mutex becomes a pool.

## 9. Prize mapping

- **Best Use of Gemma 4**: live 31B calls on real screenshots in the demo; README names IDs + where output drives runs; open weights → self-host story.
- **Best Open-Source AI Project**: public repo, Apache-2.0, replicable (`provision-droplet.sh`, migrations in `start`), skill-compatible procedure.
- **Best Use of Adaption AI**: status — pipeline scheduled, request path untouched (see README). Commit run ID + config + baseline-vs-adapted table before submission; never claim reproduction gains from extraction scores.

## 10. Pre-demo checklist

- [ ] `npm test` 25/25, typecheck clean, `npx next build` passes
- [ ] Local `.env` filled; Render env matches (Render PG URL, fresh JWT, runner token/URL, model keys)
- [ ] `prisma migrate deploy` applied on Render DB (or via `npm start` hook)
- [ ] Render woken (`/api/health` ×2), runner `/health` idle, ngrok URL fresh if used
- [ ] Demo screenshots + unsupported-eco repo URL ready; `MODEL_PROVIDER` decision made
- [ ] 90-sec recording backup in case venue network drops

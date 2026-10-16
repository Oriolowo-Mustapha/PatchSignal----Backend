# PatchSignal — Backend

**From reported bugs to reproducible evidence.** An AI-assisted system that turns a public GitHub repo URL plus a bug report and screenshots into an evidence package with one justified status: **Reproduced, Not reproduced, or Inconclusive**.

This repo holds the **backend** (Next.js + TypeScript + Prisma + PostgreSQL). The web UI is a separate track consuming this API.

## Problem

Maintainers drown in vague bug reports ("login doesn't work") while AI-generated explanations and tests prove nothing on their own — a generated test might not run, might fail for an unrelated reason, or might test the wrong thing.

## Solution

PatchSignal combines multimodal AI analysis (Gemma 4) with repository inspection, controlled test execution in disposable Docker sandboxes, and structured evidence collection. Core principle: **an AI-generated explanation is a hypothesis; an observed execution result is evidence.** Status is computed by deterministic rules, never asserted by the model. Nothing is ever posted to GitHub automatically — a human files every issue.

## Features (v0.1)

- JWT auth: signup / login / me (bcrypt-10, HS256, 7-day expiry); all investigation routes Bearer-guarded and per-user scoped
- Intake: repo URL, free text, 1–3 screenshots (PNG/JPEG, 5MB) → Cloudinary (signed, server-side)
- Gemma 4 evidence extraction with provenance tags (`observed|reported|hypothesis|unknown`), Zod-validated `record_evidence` function call, retry + fallback across demand spikes
- Repo inspection via read-only GitHub API: pinned commit SHA, file tree, ecosystem detect (`node-vitest`)
- One hypothesis + one candidate Vitest per investigation (artifacts, never committed upstream)
- Docker runner service: fresh container per job, no network, non-root, capped CPU/mem/pids, 120s kill, token auth, allowlisted commands only
- Deterministic classification (`CLS-2…CLS-4`) with unit tests; evidence package with prefilled GitHub issue link
- Swagger UI at `/docs`, OpenAPI JSON at `/api/openapi`

## Architecture

```
browser ──HTTPS──▶ Next.js (App Router API) ──▶ PostgreSQL (Render / local PG18)
   │                      │  ├─ Gemma 4 (Gemini API: gemma-4-31b-it → gemma-4-26b-a4b-it)
   │                      │  ├─ GitHub REST (read-only token) + Cloudinary (signed uploads)
   │                      │  └─ Runner client ──token──▶ Runner service ──execFile──▶ docker run --rm
   │                      │        (no keys in containers; one job at a time in v0.1)
   └── /docs (Swagger UI via CDN) + /api/openapi
```

Browser and runner containers never hold API keys. Repo code is untrusted input and never runs in the app process.

## Quickstart (local)

```powershell
npm install
# fill .env (see .env.example): DATABASE_URL, GEMINI_API_KEY, GITHUB_TOKEN,
# CLOUDINARY_*, RUNNER_TOKEN, JWT_SECRET, ALLOWLIST_REPOS
"C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -c "CREATE DATABASE patchsignal;"
npx prisma migrate dev
npm run dev        # :3000 — Swagger at /docs
```

Runner (second terminal, needs Docker daemon up):

```powershell
$env:RUNNER_TOKEN="<same as .env>"; $env:RUNNER_PORT="5001"; npm run runner:dev
```

Test flow: signup → Authorize in `/docs` → `POST /api/investigations` → `analyze` → `inspect` → `hypotheses` → `runs` → `package`. Full curl transcript in `BACKEND_TESTING.md`; frontend contract in `docs/API_REFERENCE.md`.

## Deploy (Render)

- Build command: `npm install; npx prisma migrate deploy; npm run build`
- Start command: `npm start` (never `npm run dev` in prod)
- Env: all `.env.example` keys with prod values (Render Postgres **Internal** URL for `DATABASE_URL`, fresh `JWT_SECRET`)
- The runner cannot run on Render (no Docker daemon) — host it on a Droplet/laptop and set `RUNNER_URL` to its public address; `RUNNER_TOKEN` must match on both sides

## How Gemma 4 is used (MLH — Best Use of Gemma 4)

- Live calls on real screenshots: `lib/gemma/client.ts` sends description + Files-API images to `gemma-4-31b-it` (fallback `gemma-4-26b-a4b-it`), structured through one declared function (`record_evidence`, schema in `lib/evidence/schema.ts`), validated with Zod, retried with the exact validation errors fed back (EVD-6)
- Prompts follow gemma.ai best practices: image parts before text (§4), standardized sampling `temperature 1.0 / top_p 0.95 / top_k 64` (§1), thinking `minimal` for extraction
- Gemma's output drives the run: hypotheses become the generated Vitest, but status itself is computed by unit-tested rules (`lib/classify/rules.ts`) — the model explains, never decides
- Why open weights matter: Apache-2.0 Gemma means the same prompts later run self-hosted (GPU Droplets / Gradient), no vendor lock on the reasoning layer

## Adaption (MLH — Best Use of Adaption AI)

Status: pipeline scheduled, not yet integrated into the request path (nothing in v0.1 waits on it). Plan: seed set (~100 public issues + 15–20 hand-written gold investigations, ~20 held out) → Adaption Adaptive-Data adapt on the training split only → score baseline vs adapted extraction on held-out cases (schema validity, completeness, unsupported-claim rate, provenance accuracy, question coverage). Run ID, config, and both score tables will be committed here plus pasted into this section. Dataset links to source issues; only invented/hand-written examples ship in full. End-to-end reproduction is evaluated separately and never claimed from extraction scores alone.

## Evaluation

- `npm test` — classification rules (E1 reproduced, E3 not-reproduced, E4/E5/E6 inconclusive)
- Live flow verified: intake → analyze (real 31B) → hypotheses → runs → package, plus auth isolation (cross-user 404, bad-token 401)
- Metrics tracked per plan: reproduction success, zero false-reproduction, execution rate, evidence completeness (SHA, digest, command, exit code, logs on every run)

## Credits

Google DeepMind (Gemma 4, gemma.ai docs), Adaption AI, DigitalOcean/Render hosting, Cloudinary, Prisma, Next.js, Vitest, Octokit. External datasets will be credited with source links as added.

## License

Apache-2.0 — see `LICENSE`.

## Background analysis deployment

`POST /api/investigations/:id/analyze` now returns 202 with a persisted job. Poll the investigation `analysisJob.status` until `completed` or `failed`; only completion advances `stage` to `analyzed`. Existing evidence provenance and deterministic classification rules are unchanged.

Deploy using `npm run build` and **`npm start`**. Start now runs `prisma migrate deploy` before Next boots, adding the additive AnalysisJob table. The startup instrumentation starts a single worker per long-lived Node process, with Postgres leases preventing concurrent execution of the same job across instances. Queued and expired jobs resume after restart; memory fallback is development-only and loses data on process exit. No extra worker service, Redis or credentials are introduced. A service stopped/asleep cannot process work until it wakes.

Each model request has a 25-second abort/deadline, with at most two attempts and a one-second fallback delay. An expired job lease can be recovered up to three times; explicit user retry is required after terminal failure. Evidence/questions/job completion commit in one transaction and stale lease holders cannot overwrite a later worker result. API job views omit lease tokens and provider exceptions.

Deploy backend first, then frontend support for analysisJob states. Existing frontends still receive normal detail/evidence shapes but should disable duplicate Analyze clicks while a job is queued/running. Serverless backends cannot rely on this timer worker; run this on the supplied Render Node service.

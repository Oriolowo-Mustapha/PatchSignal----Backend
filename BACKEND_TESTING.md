# PatchSignal backend (Next.js + Prisma + Cloudinary + Docker runner)

Backend only. UI is a separate track; this app serves the API.

## 1. Env
Copy `.env.example` to `.env.local` and fill:
- `DATABASE_URL` — local PG: `postgresql://postgres:<pw>@localhost:5432/patchsignal`. Create DB once:
  `"C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -c "CREATE DATABASE patchsignal;"`
- `GEMINI_API_KEY`, `GITHUB_TOKEN` (read-only), `RUNNER_TOKEN` (shared with runner)
- `CLOUDINARY_*` (server only), `ALLOWLIST_REPOS`, `CONTROL_SHA` (optional)
- Prod (Render): same keys + Render PG `DATABASE_URL`. No code change.

Without `DATABASE_URL` the API runs on an in-memory store (for testing intake before DB is wired).
Without `GEMINI_API_KEY`, `/analyze` queues labelled cached demo extraction; poll GET investigation until analysisJob completes.

## 2. Install + verify
```powershell
npm install
npx prisma generate
npm run typecheck
npm test        # classify rules E1,E3,E4,E5,E6
npm run dev     # :3000
```

## 3. Auth first (all /api/investigations* need Bearer; Activate Authorize 🔒 in /docs)
```powershell
# signup then login (save the token)
curl -X POST http://localhost:3000/api/auth/signup -H "content-type: application/json" -d '{"email":"you@example.com","password":"password123"}'
curl -X POST http://localhost:3000/api/auth/login -H "content-type: application/json" -d '{"email":"you@example.com","password":"password123"}'
$env:TOKEN="<token>"
curl http://localhost:3000/api/auth/me -H "Authorization: Bearer $env:TOKEN"
```

## 4. Test flow (no demo repo needed yet; add -H "Authorization: Bearer $env:TOKEN" to each call)
```powershell
# health
curl http://localhost:3000/api/health
# intake (allowlisted repo only)
curl -X POST http://localhost:3000/api/investigations -F repoUrl=https://github.com/patchsignal/demo-signup -F description="plus-sign emails fail"
# -> { id }
curl -X POST http://localhost:3000/api/investigations/ID/analyze
curl -X POST http://localhost:3000/api/investigations/ID/inspect   # needs GITHUB_TOKEN
curl -X POST http://localhost:3000/api/investigations/ID/hypotheses -H "content-type: application/json" -d "{}"
# runs without Docker: inject results honestly
curl -X POST http://localhost:3000/api/investigations/ID/runs -H "content-type: application/json" -d "{\"target\":{\"role\":\"target\",\"outcome\":\"failed\",\"exitCode\":1,\"predictedAssertionFailed\":true,\"unrelatedFailure\":false},\"control\":{\"role\":\"control\",\"outcome\":\"passed\",\"predictedAssertionFailed\":false,\"unrelatedFailure\":false}}"
curl http://localhost:3000/api/investigations/ID/package
```

## 4. Runner (needs Docker daemon up)
```powershell
$env:RUNNER_TOKEN="<same>"; $env:RUNNER_PORT="5001"; npm run runner:dev
```
Build demo images later (provided after building): `docker build -t demo-signup:target ./demo-repo` etc., then pass `{"image":"...@sha256:...","controlImage":"..."}` to `/runs`.

## 5. DB migrate
```powershell
npx prisma migrate dev   # local PG
# Render build command: prisma migrate deploy && next build
```

Async analysis verification is in `ASYNC_ANALYSIS_VERIFICATION.md`. The request now returns 202 before model work; poll job status before running inspect.

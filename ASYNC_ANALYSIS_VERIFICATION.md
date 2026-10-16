# Background analysis verification

The analyze handler persists an AnalysisJob and returns 202 before model generation. Auth and ownership checks remain in place. The long-lived Render Node process consumes jobs through startup instrumentation. Each job has a two-minute lease; competing workers use a compare-and-swap update, and completion checks the lease token in the same transaction as evidence/questions/stage writes. Duplicate submissions share one job; failed jobs require explicit retry. Interrupted leases recover up to three times and then fail visibly. No official verdict is inferred from analysis failure.

Model generation is limited to one primary and one fallback attempt, each with a 25-second timeout and transport abort; the fallback delay is one second. Deadline tests also cover SDK promises which ignore cancellation. A background failure is saved as a safe error without provider exception details. Cached demo evidence remains labelled when no model key is configured.

## Checks

25 tests across eight suites pass (`npm test -- --maxWorkers=1 --minWorkers=1`).

- Backend production Next build passes, including instrumentation compilation and route generation.
- TypeScript and Prisma schema validation pass.
- Unit/handler integration tests use explicit model/auth doubles and process-memory persistence; database lease tests use an explicit Prisma double. They cover duplicate claims, expiry/recovery, stale completion, bounded provider calls, 202 acceptance, authenticated ownership gates, queue failure, persisted success/failure and no fabricated verdict.
- The additive SQL migration and Prisma model are included. This environment has no PostgreSQL server or Docker; migration execution and cross-process PostgreSQL recovery have not been exercised against a live database.
- No production database, Render settings, real user credentials, paid model calls or runner execution were accessed for testing.

## Deploy

1. Merge and deploy this backend PR first to the long-lived Render web service. Build with npm run build and start with npm start. npm start runs prisma migrate deploy before next start, so migration failure stops startup. The migration creates a new AnalysisJob table/index/relation and does not delete existing records.
2. Deploy the paired frontend PR to render queued/running/failed/completed job states and disable duplicate Analyze submissions.
3. Verify a signed-in POST analyze returns 202 promptly. Poll GET investigation until analysisJob completes or fails. Confirm stage/evidence changes only on completion. Repeat POST while active and confirm the same job id.
4. Verify a service restart resumes queued/expired jobs. Existing authenticated investigation reads remain ownership-scoped.

The repository account has read-only upstream access, so this delivery uses a fork PR. Production deployment and live database verification require the upstream owner. The timer worker is not suitable for ephemeral serverless backends. An idle Render free service cannot process jobs while asleep; work resumes when the service wakes.

Upstream added a Groq provider while this PR was being implemented. The merge preserves MODEL_PROVIDER selection and screenshot URL forwarding, uses the selected provider key for cache fallback, and bounds Groq response/body reads to two 25-second attempts as well.

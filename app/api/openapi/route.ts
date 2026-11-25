import { NextResponse } from "next/server";

// Hand-maintained OpenAPI 3.0 for the backend. Served at /api/openapi,
// rendered at /docs via Swagger UI (CDN). No extra npm deps.
export async function GET() {
  return NextResponse.json({
    openapi: "3.0.3",
    info: {
      title: "PatchSignal backend",
      version: "0.1.0",
      description:
        "Evidence-backed bug investigation API. Flow: POST /api/investigations → analyze → inspect → hypotheses → runs → package. Without DATABASE_URL the API uses a process-memory store; without the selected provider API key /analyze queues labelled cached demo extraction.",
    },
    servers: [{ url: "http://localhost:3000" }],
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
        cookieAuth: { type: "apiKey", in: "cookie", name: "ps_session" },
      },
    },
    security: [{ bearerAuth: [] }, { cookieAuth: [] }],
    tags: [
      { name: "auth", description: "Signup, login, session logout, current user (public except /me)" },
      { name: "investigations", description: "Stages 1–7 of one bug investigation (Bearer JWT or HttpOnly ps_session cookie required)" },
    ],
    paths: {
      "/api/auth/signup": {
        post: {
          tags: ["auth"],
          security: [],
          summary: "Signup (public, sets HttpOnly ps_session cookie + returns JWT)",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["email", "password"],
                  properties: {
                    email: { type: "string", example: "tester@example.com" },
                    password: { type: "string", example: "password123" },
                    name: { type: "string" },
                  },
                },
              },
            },
          },
          responses: {
            "201": { description: "created user + Set-Cookie (ps_session) + token" },
            "400": { description: "bad email / invalid password length" },
            "409": { description: "email already registered" },
            "429": { description: "rate limit exceeded" },
          },
        },
      },
      "/api/auth/login": {
        post: {
          tags: ["auth"],
          security: [],
          summary: "Login (public, sets HttpOnly ps_session cookie + returns JWT)",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["email", "password"],
                  properties: {
                    email: { type: "string", example: "tester@example.com" },
                    password: { type: "string", example: "password123" },
                  },
                },
              },
            },
          },
          responses: {
            "200": { description: "user + Set-Cookie (ps_session) + token" },
            "401": { description: "invalid credentials" },
            "429": { description: "rate limit exceeded" },
          },
        },
      },
      "/api/auth/logout": {
        post: {
          tags: ["auth"],
          security: [],
          summary: "Revoke current session and clear ps_session cookie",
          responses: { "200": { description: "{ ok: true }" } },
        },
      },
      "/api/auth/me": {
        get: {
          tags: ["auth"],
          summary: "Current user",
          responses: { "200": { description: "user" }, "401": { description: "missing/invalid token" } },
        },
      },
      "/api/health": {
        get: {
          tags: ["investigations"],
          security: [],
          summary: "Health + store mode",
          responses: { "200": { description: "ok, db status, store mode" } },
        },
      },
      "/api/openapi": {
        get: {
          tags: ["investigations"],
          security: [],
          summary: "This OpenAPI document",
          responses: { "200": { description: "OpenAPI 3.0 JSON" } },
        },
      },
      "/api/investigations": {
        get: {
          tags: ["investigations"],
          summary: "List authenticated user's investigations (newest first, max 50)",
          responses: {
            "200": { description: "{ investigations: [...] }" },
            "401": { description: "missing/invalid token" },
          },
        },
        post: {
          tags: ["investigations"],
          summary: "Stage 1: intake (multipart)",
          requestBody: {
            required: true,
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  required: ["repoUrl", "description"],
                  properties: {
                    repoUrl: { type: "string", example: "https://github.com/patchsignal/demo-signup" },
                    description: { type: "string", example: "Sign-up rejects ade+test@gmail.com" },
                    expected: { type: "string" },
                    actual: { type: "string" },
                    steps: { type: "string" },
                    environment: { type: "string" },
                    errorText: { type: "string" },
                    screenshots: {
                      type: "array",
                      items: { type: "string", format: "binary" },
                      description: "1–3 PNG/JPEG, 5MB each",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "201": { description: "created { id, store, attachments }" },
            "400": { description: "missing fields / bad file" },
            "403": { description: "repo outside allowlist (REPO-5)" },
          },
        },
      },
      "/api/investigations/{id}": {
        get: {
          tags: ["investigations"],
          summary: "Current state, evidence and runs",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "investigation" }, "404": { description: "not found" } },
        },
      },
      "/api/investigations/{id}/events": {
        get: {
          tags: ["investigations"],
          summary: "SSE stage progress",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "text/event-stream" } },
        },
      },
      "/api/investigations/{id}/analyze": {
        post: {
          tags: ["investigations"],
          summary: "Stage 2: enqueue background evidence analysis; poll investigation.analysisJob",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "202": { description: "{ id, analysisJob: { id, status: queued|running, error, updatedAt } }; poll GET investigation until completed or failed" }, "200": { description: "Analysis already completed; load investigation evidence" }, "503": { description: "Job persistence unavailable; check database migrations" } },
        },
      },
      "/api/investigations/{id}/inspect": {
        post: {
          tags: ["investigations"],
          summary: "Stage 3: pin commit SHA + read tree via GitHub API (auto-Inconclusive CLS-4 when unsupported)",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "{ defaultBranch, sha, ecosystem }" } },
        },
      },
      "/api/investigations/{id}/hypotheses": {
        post: {
          tags: ["investigations"],
          summary: "Stage 4: dynamic repo-aware hypothesis + candidate Vitest (HYP-4 validated)",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    statement: { type: "string" },
                    triggerConditions: { type: "string" },
                    expectedFailure: { type: "string" },
                    evidenceNeeded: { type: "string" },
                    targetFile: { type: "string" },
                    content: { type: "string" },
                  },
                },
              },
            },
          },
          responses: {
            "201": { description: "hypothesis + test path/content + modelId" },
            "400": { description: "unsupported ecosystem or HYP-4 invalid test imports" },
            "502": { description: "model upstream failed" },
          },
        },
      },
      "/api/investigations/{id}/runs": {
        post: {
          tags: ["investigations"],
          summary: "Stage 5+6: dispatch to runner, deterministic classify",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    image: { type: "string", description: "pinned image@digest (Docker path)" },
                    controlImage: { type: "string" },
                    target: {
                      type: "object",
                      description: "honest result injection (testing without Docker)",
                      properties: {
                        role: { type: "string", example: "target" },
                        outcome: { type: "string", enum: ["passed", "failed", "error", "timeout"] },
                        exitCode: { type: "integer" },
                        predictedAssertionFailed: { type: "boolean" },
                        unrelatedFailure: { type: "boolean" },
                      },
                    },
                    control: { type: "object" },
                  },
                },
              },
            },
          },
          responses: { "200": { description: "{ target, control, status, rule, justification }" } },
        },
      },
      "/api/investigations/{id}/remediate": {
        post: {
          tags: ["investigations"],
          summary: "Diagnose root cause, suggest fix, and loop verification in container/sandbox till exit 0",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "{ remediation }" },
            "502": { description: "remediation loop failed" },
          },
        },
      },
      "/api/investigations/{id}/pr": {
        post: {
          tags: ["investigations"],
          summary: "Create GitHub Pull Request for verified fix after explicit user approval (approved: true)",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "201": { description: "{ pr, remediation }" },
            "400": { description: "approved: true required or no patches found" },
            "403": { description: "GITHUB_WRITE_TOKEN_NEEDED" },
          },
        },
      },
      "/api/investigations/{id}/package": {
        get: {
          tags: ["investigations"],
          summary: "Stage 7: markdown + prefilled GitHub issue URL + readiness metadata",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "{ markdown, issueUrl, copyToClipboard, readyToFile, blockingUnknowns }" } },
        },
      },
      "/api/files/{attachmentId}": {
        get: {
          tags: ["investigations"],
          summary: "Ownership-scoped attachment lookup (id or publicId -> CDN metadata)",
          parameters: [{ name: "attachmentId", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "{ id, publicId, secureUrl, mime, sizeBytes, width, height, investigationId }" },
            "404": { description: "not found or owned by another user" },
          },
        },
      },
    },
  });
}

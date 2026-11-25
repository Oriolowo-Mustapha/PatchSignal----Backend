import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const db = vi.hoisted(() => ({
  investigation: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  hypothesis: { findFirst: vi.fn() },
  run: { create: vi.fn() },
  classification: { create: vi.fn() },
  attachment: { findFirst: vi.fn() },
}));

const mocks = vi.hoisted(() => ({
  authUser: vi.fn(),
  dispatchJob: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ prisma: db }));
vi.mock("@/lib/auth", () => ({
  authUser: mocks.authUser,
  owns: (inv: { userId?: string | null } | null, userId: string) => inv?.userId === userId,
}));
vi.mock("@/lib/config", () => ({
  config: { runnerToken: "test-runner-token", runnerUrl: "http://runner.invalid" },
}));
vi.mock("@/lib/runner/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/runner/client")>()),
  dispatchJob: mocks.dispatchJob,
}));

import { GET as listGet } from "@/app/api/investigations/route";
import { POST as runPost } from "@/app/api/investigations/[id]/runs/route";
import { GET as packageGet } from "@/app/api/investigations/[id]/package/route";
import { GET as fileGet } from "@/app/api/files/[attachmentId]/route";

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost:5432/test");
  vi.clearAllMocks();
  mocks.authUser.mockResolvedValue({ userId: "user-1" });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const prismaInvestigation = {
  id: "inv_pg1",
  userId: "user-1",
  owner: "acme",
  repo: "shop",
  repoUrl: "https://github.com/acme/shop",
  description: "Negative coupon inflates price",
  summary: "Coupon handler accepts negative values",
  expected: "Reject negative coupon",
  actual: "Price increases",
  commitSha: "sha-target-1",
  controlSha: "sha-control-1",
  modelId: "gemma-4-31b-it",
  stage: "hypothesized",
  status: "pending",
  evidence: [{ text: "Coupon passes negative check", provenance: "hypothesis", source: "model" }],
  questions: [{ text: "Which currency?", blocking: true }],
  hypotheses: [
    {
      id: "hyp_1",
      statement: "Missing negative check",
      triggerConditions: "applyCoupon(-5)",
      expectedFailure: "throws InvalidCouponError",
      evidenceNeeded: "Vitest fail on target, pass on control",
      tests: [
        {
          id: "test_1",
          path: "tests/patchsignal/repro-inv_pg1.test.ts",
          content: `import { expect, it } from "vitest";\nimport { applyCoupon } from "../../src/coupon";\nit("rejects", () => expect(() => applyCoupon(-5)).toThrow());`,
        },
      ],
      runs: [
        {
          role: "target",
          outcome: "failed",
          exitCode: 1,
          revisionSha: "sha-target-1",
          imageDigest: "sha256:target",
          command: "vitest-json",
          durationMs: 420,
        },
        {
          role: "control",
          outcome: "passed",
          exitCode: 0,
          revisionSha: "sha-control-1",
          imageDigest: "sha256:control",
          command: "vitest-json",
          durationMs: 380,
        },
      ],
    },
  ],
  classifications: [
    {
      status: "Reproduced",
      rule: "CLS-2",
      justification: "Target failed with predicted assertion (exit 1); control passed — test discriminates.",
    },
  ],
};

describe("Postgres shape normalization across /runs, /package, and /files", () => {
  it("reads test artifact from Prisma hypotheses[0].tests[0], persists target + control Run rows, and sets stage=ran", async () => {
    db.investigation.findUnique.mockResolvedValue(prismaInvestigation);
    const targetReport = JSON.stringify({
      numTotalTests: 1,
      numFailedTests: 1,
      success: false,
      testResults: [
        {
          status: "failed",
          assertionResults: [{ status: "failed", failureMessages: ["AssertionError: expected function to throw"] }],
        },
      ],
    });
    const controlReport = JSON.stringify({
      numTotalTests: 1,
      numFailedTests: 0,
      success: true,
      testResults: [{ status: "passed", assertionResults: [{ status: "passed", failureMessages: [] }] }],
    });
    mocks.dispatchJob
      .mockResolvedValueOnce({
        jobId: "inv_pg1-target",
        exitCode: 1,
        durationMs: 420,
        outcome: "failed",
        reportJson: targetReport,
        stdout: targetReport,
        stderr: "",
        imageDigest: "sha256:target",
        truncated: false,
      })
      .mockResolvedValueOnce({
        jobId: "inv_pg1-control",
        exitCode: 0,
        durationMs: 380,
        outcome: "passed",
        reportJson: controlReport,
        stdout: controlReport,
        stderr: "",
        imageDigest: "sha256:control",
        truncated: false,
      });

    const req = new NextRequest("http://test/api/investigations/inv_pg1/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        image: "demo@sha256:target",
        controlImage: "demo@sha256:control",
      }),
    });
    const res = await runPost(req, { params: Promise.resolve({ id: "inv_pg1" }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.status).toBe("Reproduced");
    expect(mocks.dispatchJob).toHaveBeenCalledWith(
      expect.objectContaining({
        files: [
          {
            path: "tests/patchsignal/repro-inv_pg1.test.ts",
            content: prismaInvestigation.hypotheses[0].tests[0].content,
          },
        ],
      })
    );
    expect(db.run.create).toHaveBeenCalledTimes(2);
    expect(db.run.create).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({ hypothesisId: "hyp_1", role: "target", durationMs: 420 }),
    });
    expect(db.run.create).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({ hypothesisId: "hyp_1", role: "control", durationMs: 380 }),
    });
    expect(db.investigation.update).toHaveBeenCalledWith({
      where: { id: "inv_pg1" },
      data: { status: "Reproduced", stage: "ran" },
    });
  });

  it("renders full Prisma evidence, runs, summary title, and blockingUnknowns in /package and transitions stage=packaged", async () => {
    db.investigation.findUnique.mockResolvedValue({
      ...prismaInvestigation,
      stage: "ran",
      status: "Reproduced",
    });

    const res = await packageGet(new Request("http://test/api/investigations/inv_pg1/package"), {
      params: Promise.resolve({ id: "inv_pg1" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.readyToFile).toBe(false);
    expect(body.blockingUnknowns).toBe(1);
    expect(body.markdown).toContain("Coupon handler accepts negative values");
    expect(body.markdown).toContain("Reproduced (CLS-2)");
    expect(body.markdown).toContain("[hypothesis] (model) Coupon passes negative check");
    expect(body.markdown).toContain("[BLOCKING] Which currency?");
    expect(body.markdown).toContain("tests/patchsignal/repro-inv_pg1.test.ts");
    expect(body.markdown).toContain("**control**: outcome=passed");
    expect(body.issueUrl).toContain(encodeURIComponent("[PatchSignal] Coupon handler accepts negative values"));
    expect(db.investigation.update).toHaveBeenCalledWith({
      where: { id: "inv_pg1" },
      data: { stage: "packaged" },
    });
  });

  it("resolves owned attachments via /api/files/[attachmentId] and returns 404 for another user or missing ID", async () => {
    db.attachment.findFirst.mockResolvedValueOnce({
      id: "att_1",
      publicId: "patchsignal/inv_pg1/shot.png",
      secureUrl: "https://res.cloudinary.com/demo/image/upload/shot.png",
      mime: "image/png",
      sizeBytes: 1024,
      width: 800,
      height: 600,
      investigationId: "inv_pg1",
      investigation: { userId: "user-1" },
    });

    const okRes = await fileGet(new Request("http://test/api/files/att_1"), {
      params: Promise.resolve({ attachmentId: "att_1" }),
    });
    expect(okRes.status).toBe(200);
    expect(await okRes.json()).toEqual({
      id: "att_1",
      publicId: "patchsignal/inv_pg1/shot.png",
      secureUrl: "https://res.cloudinary.com/demo/image/upload/shot.png",
      mime: "image/png",
      sizeBytes: 1024,
      width: 800,
      height: 600,
      investigationId: "inv_pg1",
    });

    db.attachment.findFirst.mockResolvedValueOnce({
      id: "att_2",
      publicId: "other",
      secureUrl: "https://example.invalid/x.png",
      mime: "image/png",
      sizeBytes: 100,
      width: null,
      height: null,
      investigationId: "inv_other",
      investigation: { userId: "user-2" },
    });
    const forbiddenRes = await fileGet(new Request("http://test/api/files/att_2"), {
      params: Promise.resolve({ attachmentId: "att_2" }),
    });
    expect(forbiddenRes.status).toBe(404);

    db.attachment.findFirst.mockResolvedValueOnce(null);
    const missingRes = await fileGet(new Request("http://test/api/files/missing"), {
      params: Promise.resolve({ attachmentId: "missing" }),
    });
    expect(missingRes.status).toBe(404);
  });

  it("lists only the authenticated user's investigations via GET /api/investigations", async () => {
    db.investigation.findMany.mockResolvedValueOnce([prismaInvestigation]);
    const res = await listGet(new NextRequest("http://test/api/investigations"));
    expect(res.status).toBe(200);
    expect(db.investigation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-1" },
        orderBy: { createdAt: "desc" },
        take: 50,
      })
    );
    const body = await res.json();
    expect(body.investigations).toHaveLength(1);
    expect(body.investigations[0]).toMatchObject({
      id: "inv_pg1",
      owner: "acme",
      repo: "shop",
      summary: "Coupon handler accepts negative values",
      evidenceCount: 1,
      blockingUnknowns: 1,
    });
  });
});

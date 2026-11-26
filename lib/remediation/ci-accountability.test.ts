import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { runRemediationLoopMock, fetchPullRequestChecksMock, createFixPullRequestMock } = vi.hoisted(() => ({
  runRemediationLoopMock: vi.fn(),
  fetchPullRequestChecksMock: vi.fn(),
  createFixPullRequestMock: vi.fn(),
}));

vi.mock("@/lib/remediation/loop", () => ({
  runRemediationLoop: runRemediationLoopMock,
}));

vi.mock("@/lib/github/pr", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/github/pr")>();
  return {
    ...actual,
    fetchPullRequestChecks: fetchPullRequestChecksMock,
    createFixPullRequest: createFixPullRequestMock,
  };
});

import { POST as signup } from "@/app/api/auth/signup/route";
import { POST as repairPrRoute } from "@/app/api/investigations/[id]/pr/repair/route";
import { extractFailureLines } from "@/lib/github/pr";
import { selectRelevantRepoFiles } from "@/lib/remediation/proposer";
import { memoryStore } from "@/lib/store";

function extractCookie(setCookie: string | null): string {
  return (setCookie ?? "").split(";")[0];
}

describe("CI workflow awareness, log extraction & PR self-healing repair", () => {
  let userCookie = "";
  let userId = "";

  beforeEach(async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("JWT_SECRET", "ci-accountability-test-secret");
    runRemediationLoopMock.mockReset();
    fetchPullRequestChecksMock.mockReset();
    createFixPullRequestMock.mockReset();

    const email = `ci-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
    const res = await signup(
      new NextRequest("http://test/api/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password: "password123" }),
      })
    );
    const body = await res.json();
    userId = body.id;
    userCookie = extractCookie(res.headers.get("set-cookie"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("includes .github/workflows YAML and matching unit test files alongside matched source files", () => {
    const selected = selectRelevantRepoFiles(
      [
        ".github/workflows/verify.yml",
        "Team-HackForge.sln",
        "src/FarmHand.Infrastructure/Services/ConfigurationValidator.cs",
        "tests/FarmHand.UnitTests/Services/ConfigurationValidatorTests.cs",
        "src/FarmHand.API/Program.cs",
      ],
      [],
      "Unhandled exception in /src/src/FarmHand.Infrastructure/Services/ConfigurationValidator.cs:line 21",
      "Team-HackForge.sln",
      3
    );

    expect(selected).toContain("src/FarmHand.Infrastructure/Services/ConfigurationValidator.cs");
    expect(selected).toContain(".github/workflows/verify.yml");
    expect(selected).toContain("tests/FarmHand.UnitTests/Services/ConfigurationValidatorTests.cs");
  });

  it("extracts failing assertions & compiler errors from noisy GitHub Actions logs", () => {
    const log = [
      "2026-11-26T13:20:01.000Z Restore completed in 1.2s",
      "2026-11-26T13:20:05.000Z Determining projects to restore...",
      "2026-11-26T13:20:08.000Z   Failed Validate_ThrowsWhenModeMissing [42 ms]",
      "2026-11-26T13:20:08.001Z   Error Message:",
      "2026-11-26T13:20:08.002Z    Assert.Throws() Failure: No exception was thrown",
      "2026-11-26T13:20:09.000Z ##[error]Process completed with exit code 1.",
    ].join("\n");

    const extracted = extractFailureLines(log, 2000);
    expect(extracted).toContain("Assert.Throws() Failure");
    expect(extracted).toContain("Process completed with exit code 1");
    expect(extracted).not.toContain("2026-11-26T13:20:08");
  });

  it("requires approved: true on /pr/repair and pushes a verified CI follow-up commit when approved", async () => {
    const invId = "inv_ci_repair_1";
    memoryStore.create({
      id: invId,
      userId,
      repoUrl: "https://github.com/Oriolowo-Mustapha/Team-HackForge",
      owner: "Oriolowo-Mustapha",
      repo: "Team-HackForge",
      description: "Startup crash",
      stage: "packaged",
      status: "reproduced",
      attachments: [],
      inspection: {
        sha: "abc1234",
        ecosystem: "dotnet",
        defaultBranch: "main",
        paths: ["src/FarmHand.Infrastructure/Services/ConfigurationValidator.cs"],
        remediation: {
          status: "succeeded",
          maxAttempts: 3,
          currentAttempt: 1,
          updatedAt: new Date().toISOString(),
          patches: [
            {
              path: "src/FarmHand.Infrastructure/Services/ConfigurationValidator.cs",
              explanation: "Default empty Flutterwave:Mode",
              originalContent: "old",
              content: "new",
            },
          ],
          iterations: [],
          pr: {
            status: "created",
            title: "fix: default Flutterwave:Mode",
            body: "Verified",
            branchName: "patchsignal/fix-invci",
            baseBranch: "main",
            draft: true,
            prNumber: 7,
            prUrl: "https://github.com/Oriolowo-Mustapha/Team-HackForge/pull/7",
            headSha: "oldsha111",
            ciStatus: "failed",
            ciFailureLog: "Assert.Throws Failure in ConfigurationValidatorTests",
            ciRepairRounds: 0,
          },
        },
      },
      createdAt: new Date().toISOString(),
    });

    const denied = await repairPrRoute(
      new NextRequest(`http://test/api/investigations/${invId}/pr/repair`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: userCookie },
        body: JSON.stringify({ approved: false }),
      }),
      { params: Promise.resolve({ id: invId }) }
    );
    expect(denied.status).toBe(400);
    expect(runRemediationLoopMock).not.toHaveBeenCalled();

    fetchPullRequestChecksMock.mockResolvedValueOnce({
      ciStatus: "failed",
      checks: [{ id: 99, name: "Verify FarmHand / full-stack", status: "completed", conclusion: "failure" }],
      ciFailureLog: "Assert.Throws Failure in ConfigurationValidatorTests.cs:line 30",
      checkedAt: new Date().toISOString(),
    });

    runRemediationLoopMock.mockResolvedValueOnce({
      status: "succeeded",
      fixSummary: "Update ConfigurationValidatorTests expectation for default Disabled mode",
      maxAttempts: 3,
      currentAttempt: 1,
      updatedAt: new Date().toISOString(),
      patches: [
        {
          path: "tests/FarmHand.UnitTests/Services/ConfigurationValidatorTests.cs",
          explanation: "Update unit test for fallback behavior",
          originalContent: "Assert.Throws...",
          content: "Assert.Equal(\"Disabled\", result);",
        },
      ],
      iterations: [],
      pr: {
        status: "created",
        title: "fix: default Flutterwave:Mode",
        body: "Verified",
        branchName: "patchsignal/fix-invci",
        baseBranch: "main",
        draft: true,
        prNumber: 7,
        prUrl: "https://github.com/Oriolowo-Mustapha/Team-HackForge/pull/7",
        headSha: "oldsha111",
      },
    });

    createFixPullRequestMock.mockResolvedValueOnce({
      prUrl: "https://github.com/Oriolowo-Mustapha/Team-HackForge/pull/7",
      prNumber: 7,
      branchName: "patchsignal/fix-invci",
      baseBranch: "main",
      headSha: "newsha999",
      draft: true,
      updatedExisting: true,
    });

    const approved = await repairPrRoute(
      new NextRequest(`http://test/api/investigations/${invId}/pr/repair`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: userCookie },
        body: JSON.stringify({ approved: true, pushToPr: true }),
      }),
      { params: Promise.resolve({ id: invId }) }
    );

    expect(approved.status).toBe(200);
    const body = await approved.json();
    expect(body.pushed).toBe(true);
    expect(body.pr.headSha).toBe("newsha999");
    expect(body.pr.ciStatus).toBe("pending");
    expect(body.pr.ciRepairRounds).toBe(1);
    expect(runRemediationLoopMock.mock.calls[0][1].seedFailure.stderr).toContain(
      "ConfigurationValidatorTests"
    );
  });
});

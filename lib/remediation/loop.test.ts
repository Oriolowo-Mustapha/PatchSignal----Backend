import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { proposeFixMock, verifySandboxMock, createFixPullRequestMock } = vi.hoisted(() => ({
  proposeFixMock: vi.fn(),
  verifySandboxMock: vi.fn(),
  createFixPullRequestMock: vi.fn(),
}));

vi.mock("./proposer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./proposer")>();
  return {
    ...actual,
    proposeFixIteration: proposeFixMock,
  };
});

vi.mock("./sandbox-runner", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./sandbox-runner")>();
  return {
    ...actual,
    verifyPatchInSandbox: verifySandboxMock,
  };
});

vi.mock("@/lib/github/pr", () => ({
  CreatePullRequestError: class extends Error {
    status: number;
    code: string;
    constructor(message: string, status = 400, code = "GITHUB_PR_ERROR") {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
  createFixPullRequest: createFixPullRequestMock,
}));

import { POST as signup } from "@/app/api/auth/signup/route";
import { POST as createPrRoute } from "@/app/api/investigations/[id]/pr/route";
import { detectEcosystem } from "@/lib/github/client";
import { memoryStore } from "@/lib/store";
import { runRemediationLoop } from "./loop";
import { selectRelevantRepoFiles } from "./proposer";

function extractCookie(setCookie: string | null): string {
  return (setCookie ?? "").split(";")[0];
}

describe("Multi-stack detection, iterative remediation loop & permission-gated PR", () => {
  let userCookie = "";
  let userId = "";

  beforeEach(async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("JWT_SECRET", "remediation-loop-unit-test-secret");
    proposeFixMock.mockReset();
    verifySandboxMock.mockReset();
    createFixPullRequestMock.mockReset();

    const email = `rem-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
    const signupRes = await signup(
      new NextRequest("http://test/api/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password: "password123" }),
      })
    );
    const body = await signupRes.json();
    userId = body.id;
    userCookie = extractCookie(signupRes.headers.get("set-cookie"));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("detects dotnet repositories instead of rejecting them as unsupported", () => {
    const res = detectEcosystem(
      [
        "Team-HackForge.sln",
        "src/FarmHand.API/Program.cs",
        "src/FarmHand.API/FarmHand.API.csproj",
        "src/FarmHand.Infrastructure/Services/ConfigurationValidator.cs",
      ],
      null
    );
    expect(res.ecosystem).toBe("dotnet");
    expect(res.manifest).toBe("Team-HackForge.sln");
  });

  it("maps container stack-trace paths like /src/src/FarmHand... to repository files", () => {
    const selected = selectRelevantRepoFiles(
      [
        "README.md",
        "Team-HackForge.sln",
        "src/FarmHand.API/Program.cs",
        "src/FarmHand.Infrastructure/Services/ConfigurationValidator.cs",
        "src/FarmHand.Infrastructure/Persistence/AppDbContext.cs",
      ],
      [],
      `System.InvalidOperationException: Flutterwave:Mode must be Disabled, Simulated, or Live.
       at FarmHand.Infrastructure.Services.ConfigurationValidator.Validate(IConfiguration configuration, Boolean production)
       in /src/src/FarmHand.Infrastructure/Services/ConfigurationValidator.cs:line 21
       at Program.<Main>$(String[] args) in /src/src/FarmHand.API/Program.cs:line 107`,
      "Team-HackForge.sln",
      4
    );

    expect(selected[0]).toBe("src/FarmHand.Infrastructure/Services/ConfigurationValidator.cs");
    expect(selected).toContain("src/FarmHand.API/Program.cs");
  });

  it("iterates inside container/sandbox using previous stderr until exitCode === 0 and prepares awaiting_approval PR", async () => {
    const invId = "inv_dotnet_loop_1";
    memoryStore.create({
      id: invId,
      userId,
      repoUrl: "https://github.com/Oriolowo-Mustapha/Team-HackForge",
      owner: "Oriolowo-Mustapha",
      repo: "Team-HackForge",
      description: "Startup crashes with InvalidOperationException: Flutterwave:Mode must be Disabled, Simulated, or Live.",
      expected: "Boots cleanly or falls back when Flutterwave:Mode is omitted",
      actual: "Container exited with status 139",
      steps: "Deploy with empty Flutterwave:Mode",
      errorText: "in /src/src/FarmHand.Infrastructure/Services/ConfigurationValidator.cs:line 21",
      commitSha: "abc1234",
      stage: "inspected",
      status: "pending",
      attachments: [],
      inspection: {
        sha: "abc1234",
        ecosystem: "dotnet",
        manifest: "Team-HackForge.sln",
        defaultBranch: "main",
        paths: [
          "Team-HackForge.sln",
          "src/FarmHand.API/Program.cs",
          "src/FarmHand.Infrastructure/Services/ConfigurationValidator.cs",
        ],
      },
      createdAt: new Date().toISOString(),
    });

    proposeFixMock
      .mockResolvedValueOnce({
        diagnosis: "Flutterwave:Mode defaults to null instead of Disabled",
        fixSummary: "Default empty Flutterwave:Mode to Disabled during validation",
        verificationCommand: "dotnet build Team-HackForge.sln --nologo",
        patches: [
          {
            path: "src/FarmHand.Infrastructure/Services/ConfigurationValidator.cs",
            explanation: "Fallback to Disabled when Flutterwave:Mode is missing",
            originalContent: "throw new InvalidOperationException(\"Flutterwave:Mode...\");",
            content: "var mode = configuration[\"Flutterwave:Mode\"] ?? nameof(FlutterwaveMode.Disabled);",
          },
        ],
      })
      .mockResolvedValueOnce({
        diagnosis: "Missing namespace import for FlutterwaveMode enum",
        fixSummary: "Default empty Flutterwave:Mode to Disabled using literal check",
        verificationCommand: "dotnet build Team-HackForge.sln --nologo",
        patches: [
          {
            path: "src/FarmHand.Infrastructure/Services/ConfigurationValidator.cs",
            explanation: "Fallback safely to string \"Disabled\"",
            originalContent: "throw new InvalidOperationException(\"Flutterwave:Mode...\");",
            content: "var mode = string.IsNullOrWhiteSpace(configuration[\"Flutterwave:Mode\"]) ? \"Disabled\" : configuration[\"Flutterwave:Mode\"];",
          },
        ],
      });

    verifySandboxMock
      .mockResolvedValueOnce({
        runtime: "docker-container",
        dockerImage: "mcr.microsoft.com/dotnet/sdk:9.0",
        command: "dotnet build Team-HackForge.sln --nologo",
        exitCode: 1,
        outcome: "failed",
        durationMs: 1420,
        stdout: "",
        stderr: "error CS0103: The name 'FlutterwaveMode' does not exist in the current context",
      })
      .mockResolvedValueOnce({
        runtime: "docker-container",
        dockerImage: "mcr.microsoft.com/dotnet/sdk:9.0",
        command: "dotnet build Team-HackForge.sln --nologo",
        exitCode: 0,
        outcome: "passed",
        durationMs: 1890,
        stdout: "Build succeeded.\n 0 Warning(s)\n 0 Error(s)",
        stderr: "",
      });

    const result = await runRemediationLoop(invId, { maxAttempts: 4 });

    expect(result.status).toBe("succeeded");
    expect(result.iterations).toHaveLength(2);
    expect(proposeFixMock).toHaveBeenCalledTimes(2);
    // Attempt 2 must receive attempt 1 stderr so the LLM repairs its mistake
    expect(proposeFixMock.mock.calls[1][0].previousIteration.stderr).toContain("CS0103");
    expect(result.iterations[0].outcome).toBe("failed");
    expect(result.iterations[1].outcome).toBe("passed");
    expect(result.iterations[1].exitCode).toBe(0);
    expect(result.pr?.status).toBe("awaiting_approval");
    expect(result.pr?.branchName).toBe("patchsignal/fix-invdotne");
  });

  it("refuses PR creation without approved: true and opens PR only after explicit permission", async () => {
    const invId = "inv_pr_gate_1";
    memoryStore.create({
      id: invId,
      userId,
      repoUrl: "https://github.com/Oriolowo-Mustapha/Team-HackForge",
      owner: "Oriolowo-Mustapha",
      repo: "Team-HackForge",
      description: "Startup crash",
      stage: "ran",
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
              explanation: "Default Flutterwave:Mode to Disabled",
              originalContent: "old",
              content: "new",
            },
          ],
          iterations: [],
          pr: {
            status: "awaiting_approval",
            title: "fix: default Flutterwave:Mode to Disabled",
            body: "Verified build passes",
            branchName: "patchsignal/fix-invprgat",
            baseBranch: "main",
          },
        },
      },
      createdAt: new Date().toISOString(),
    });

    // 1. Denied when approved is false
    const deniedRes = await createPrRoute(
      new NextRequest(`http://test/api/investigations/${invId}/pr`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: userCookie },
        body: JSON.stringify({ approved: false }),
      }),
      { params: Promise.resolve({ id: invId }) }
    );
    expect(deniedRes.status).toBe(400);
    expect(createFixPullRequestMock).not.toHaveBeenCalled();

    // 2. Created when approved is true
    createFixPullRequestMock.mockResolvedValueOnce({
      prUrl: "https://github.com/Oriolowo-Mustapha/Team-HackForge/pull/42",
      prNumber: 42,
      branchName: "patchsignal/fix-invprgat",
      baseBranch: "main",
      headSha: "deadbeef1234",
    });

    const approvedRes = await createPrRoute(
      new NextRequest(`http://test/api/investigations/${invId}/pr`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: userCookie },
        body: JSON.stringify({ approved: true }),
      }),
      { params: Promise.resolve({ id: invId }) }
    );
    expect(approvedRes.status).toBe(201);
    const body = await approvedRes.json();
    expect(body.pr.status).toBe("created");
    expect(body.pr.prNumber).toBe(42);
    expect(body.pr.prUrl).toBe("https://github.com/Oriolowo-Mustapha/Team-HackForge/pull/42");
    expect(createFixPullRequestMock).toHaveBeenCalledTimes(1);
  });
});

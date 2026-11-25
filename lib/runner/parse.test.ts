import { describe, expect, it } from "vitest";
import { classify } from "@/lib/classify/rules";
import { analyzeRunnerOutput } from "./parse";

describe("analyzeRunnerOutput", () => {
  it("detects predicted assertion failure from Vitest JSON report", () => {
    const report = JSON.stringify({
      numTotalTests: 1,
      numFailedTests: 1,
      success: false,
      testResults: [
        {
          status: "failed",
          assertionResults: [
            {
              status: "failed",
              title: "accepts plus sign email",
              failureMessages: ["AssertionError: expected false to be true"],
            },
          ],
        },
      ],
    });
    const parsed = analyzeRunnerOutput({
      role: "target",
      outcome: "failed",
      exitCode: 1,
      stdout: report,
      stderr: "",
      reportJson: report,
    });
    expect(parsed.unrelatedFailure).toBe(false);
    expect(parsed.predictedAssertionFailed).toBe(true);
    expect(classify(parsed, null).status).toBe("Reproduced");
  });

  it("marks 'target module missing' as unrelatedFailure so it classifies Inconclusive, never Reproduced", () => {
    const report = JSON.stringify({
      numTotalTests: 1,
      numFailedTests: 1,
      success: false,
      testResults: [
        {
          status: "failed",
          assertionResults: [
            {
              status: "failed",
              title: "asserts correct behaviour",
              failureMessages: [
                "AssertionError: target module missing — mark Inconclusive, do not fake pass: expected null to be truthy",
              ],
            },
          ],
        },
      ],
    });
    const parsed = analyzeRunnerOutput({
      role: "target",
      outcome: "failed",
      exitCode: 1,
      stdout: report,
      reportJson: report,
    });
    expect(parsed.unrelatedFailure).toBe(true);
    expect(parsed.predictedAssertionFailed).toBe(false);
    expect(classify(parsed, null).status).toBe("Inconclusive");
  });

  it("inspects stderr for SyntaxError or Cannot find module", () => {
    const parsed = analyzeRunnerOutput({
      role: "target",
      outcome: "failed",
      exitCode: 1,
      stdout: "",
      stderr: "Error: Cannot find module '../../src/validation/email'",
    });
    expect(parsed.unrelatedFailure).toBe(true);
    expect(classify(parsed, null).status).toBe("Inconclusive");
  });

  it("flags Vitest suite load crash with numTotalTests=0 as unrelatedFailure", () => {
    const report = JSON.stringify({
      numTotalTests: 0,
      numFailedTests: 0,
      success: false,
      testResults: [{ status: "failed", message: "Unexpected token" }],
    });
    const parsed = analyzeRunnerOutput({
      role: "target",
      outcome: "failed",
      exitCode: 1,
      reportJson: report,
    });
    expect(parsed.unrelatedFailure).toBe(true);
    expect(classify(parsed, null).status).toBe("Inconclusive");
  });

  it("marks control timeout or stderr SyntaxError as unrelatedFailure", () => {
    const timedOut = analyzeRunnerOutput({ role: "control", outcome: "timeout", exitCode: 1 });
    expect(timedOut.unrelatedFailure).toBe(true);

    const syntaxErr = analyzeRunnerOutput({
      role: "control",
      outcome: "failed",
      exitCode: 1,
      stderr: "SyntaxError: Unexpected identifier",
    });
    expect(syntaxErr.unrelatedFailure).toBe(true);
  });
});

import type { ClassifiableRun, RunOutcome } from "@/lib/classify/rules";

export type RawRunnerOutput = {
  role: "target" | "control";
  outcome: RunOutcome;
  exitCode?: number | null;
  stdout?: string;
  stderr?: string;
  reportJson?: string;
};

type VitestJsonReport = {
  numTotalTests?: number;
  numFailedTests?: number;
  success?: boolean;
  testResults?: {
    status?: string;
    message?: string;
    assertionResults?: {
      status?: string;
      title?: string;
      failureMessages?: string[];
    }[];
  }[];
};

const UNRELATED_FAILURE_RE =
  /Cannot find module|ERR_MODULE_NOT_FOUND|Failed to resolve import|Failed to load url|SyntaxError|ReferenceError|ECONNREFUSED|ENOTFOUND|target module missing|No test files found|Vitest cannot be imported/i;

const ASSERTION_FAILURE_RE =
  /AssertionError|expected|toBe|toEqual|toThrow|toContain|toMatch|FAIL\b|invalid email/i;

const STOP_WORDS = new Set([
  "should",
  "would",
  "could",
  "which",
  "where",
  "there",
  "their",
  "about",
  "error",
  "failed",
  "expected",
  "actual",
  "value",
]);

function parseVitestReport(raw?: string, stdout?: string): VitestJsonReport | null {
  const tryParse = (candidate: string): VitestJsonReport | null => {
    if (!candidate.trim()) return null;
    try {
      const parsed = JSON.parse(candidate) as VitestJsonReport;
      if (parsed && typeof parsed === "object" && ("testResults" in parsed || "numTotalTests" in parsed)) {
        return parsed;
      }
    } catch {
      return null;
    }
    return null;
  };

  if (raw) {
    const direct = tryParse(raw);
    if (direct) return direct;
  }
  if (stdout) {
    const lastEnd = stdout.lastIndexOf("}");
    if (lastEnd !== -1) {
      let idx = stdout.indexOf("{");
      let checks = 0;
      while (idx !== -1 && idx < lastEnd && checks < 25) {
        checks++;
        const slice = stdout.slice(idx, lastEnd + 1);
        if (slice.includes('"testResults"') || slice.includes('"numTotalTests"')) {
          const parsed = tryParse(slice);
          if (parsed) return parsed;
        }
        idx = stdout.indexOf("{", idx + 1);
      }
    }
  }
  return null;
}

function hasExpectedFailureOverlap(text: string, expectedFailure?: string): boolean {
  if (!expectedFailure) return false;
  const lowText = text.toLowerCase();
  const tokens = expectedFailure
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((t) => t.length >= 4 && !STOP_WORDS.has(t));
  return tokens.some((token) => lowText.includes(token));
}

export function analyzeRunnerOutput(run: RawRunnerOutput, expectedFailure?: string): ClassifiableRun {
  const stdout = run.stdout ?? "";
  const stderr = run.stderr ?? "";
  const report = parseVitestReport(run.reportJson, stdout);

  const suiteMessages: string[] = [];
  const failureMessages: string[] = [];
  if (report?.testResults) {
    for (const suite of report.testResults) {
      if (typeof suite.message === "string" && suite.message.trim()) {
        suiteMessages.push(suite.message);
      }
      if (Array.isArray(suite.assertionResults)) {
        for (const a of suite.assertionResults) {
          if (Array.isArray(a.failureMessages)) {
            for (const msg of a.failureMessages) {
              if (typeof msg === "string" && msg.trim()) failureMessages.push(msg);
            }
          }
        }
      }
    }
  }

  const combined = [stdout, stderr, ...suiteMessages, ...failureMessages].join("\n");
  const zeroTestsFailed = Boolean(report && report.numTotalTests === 0 && report.success === false);

  const unrelatedFailure =
    run.outcome === "error" ||
    run.outcome === "timeout" ||
    (run.outcome === "failed" && (UNRELATED_FAILURE_RE.test(combined) || zeroTestsFailed));

  let predictedAssertionFailed = false;
  if (run.role === "target" && run.outcome === "failed" && !unrelatedFailure) {
    if (report && typeof report.numFailedTests === "number") {
      predictedAssertionFailed = report.numFailedTests > 0 && failureMessages.length > 0;
    } else {
      predictedAssertionFailed =
        ASSERTION_FAILURE_RE.test(combined) || hasExpectedFailureOverlap(combined, expectedFailure);
    }
  }

  return {
    role: run.role,
    outcome: run.outcome,
    exitCode: run.exitCode,
    predictedAssertionFailed,
    unrelatedFailure,
    stdout,
  };
}

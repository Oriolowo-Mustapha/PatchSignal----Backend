import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  generateContent: vi.fn(),
  fetchRepoFile: vi.fn(),
}));

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent: mocks.generateContent };
  },
}));

vi.mock("@/lib/github/client", () => ({
  fetchRepoFile: mocks.fetchRepoFile,
}));

vi.mock("@/lib/config", () => ({
  config: {
    geminiApiKey: "",
    gemmaPrimary: "gemma-4-31b-it",
    gemmaFallback: "gemma-4-26b-a4b-it",
    modelProvider: "gemini",
    groqApiKey: "",
    groqModel: "",
  },
}));

import { config } from "@/lib/config";
import { buildFallbackHypothesis, generateHypothesis, validateTestImports } from "./generator";

beforeEach(() => {
  vi.clearAllMocks();
  (config as { geminiApiKey: string }).geminiApiKey = "";
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("validateTestImports (HYP-4)", () => {
  const testPath = "tests/patchsignal/repro-inv12345.test.ts";
  const repoPaths = [
    "package.json",
    "src/cart/discount.ts",
    "src/utils/index.ts",
    "src/auth/session.tsx",
  ];

  it("accepts vitest and valid relative imports (exact, extensionless, /index.ts, .js->.ts ESM)", () => {
    const code = [
      `import { describe, expect, it } from "vitest";`,
      `import { applyDiscount } from "../../src/cart/discount";`,
      `import { helper } from "../../src/utils";`,
      `import { session } from "../../src/auth/session.js";`,
      `describe("ok", () => { it("runs", () => expect(true).toBe(true)); });`,
    ].join("\n");
    const res = validateTestImports(testPath, code, repoPaths);
    expect(res.ok).toBe(true);
    expect(res.missing).toEqual([]);
    expect(res.forbidden).toEqual([]);
  });

  it("rejects nonexistent relative imports, root-escaping paths, and forbidden Node modules", () => {
    const code = [
      `import { readFileSync } from "node:fs";`,
      `import { exec } from "child_process";`,
      `import { ghost } from "../../src/does/not-exist";`,
      `import { escape } from "../../../outside-repo";`,
    ].join("\n");
    const res = validateTestImports(testPath, code, repoPaths);
    expect(res.ok).toBe(false);
    expect(res.forbidden).toEqual(expect.arrayContaining(["node:fs", "child_process"]));
    expect(res.missing).toEqual(
      expect.arrayContaining(["../../src/does/not-exist -> src/does/not-exist", "../../../outside-repo"])
    );
  });
});

describe("buildFallbackHypothesis", () => {
  it("derives hypothesis and candidate file from actual investigation data without demo-signup leakage", () => {
    const hyp = buildFallbackHypothesis({
      investigationId: "inv_cart9999",
      description: "Cart discount overflows when coupon is negative",
      summary: "Negative coupon increases total instead of rejecting",
      expected: "Reject negative coupon",
      actual: "Total becomes negative",
      steps: "Call applyDiscount with -10",
      evidenceItems: [
        { text: "Discount logic lacks negative guard", provenance: "hypothesis", source: "model" },
      ],
      candidateAreas: [{ path: "src/cart/discount.ts", provenance: "hypothesis" }],
      repoPaths: ["package.json", "src/cart/discount.ts", "src/server.ts"],
    });

    expect(hyp.statement).toBe("Discount logic lacks negative guard");
    expect(hyp.triggerConditions).toBe("Call applyDiscount with -10");
    expect(hyp.expectedFailure).toContain("Reject negative coupon");
    expect(hyp.content).toContain('import * as targetModule from "../../src/cart/discount"');
    expect(hyp.content).not.toContain("src/validation/email");
  });
});

describe("generateHypothesis", () => {
  it("retries with HYP-4 feedback when the LLM generates an invalid import and succeeds on attempt 2", async () => {
    (config as { geminiApiKey: string }).geminiApiKey = "test-key";
    mocks.fetchRepoFile.mockResolvedValue("export function applyDiscount(p: number) { return p; }");

    mocks.generateContent
      .mockResolvedValueOnce({
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: {
                    args: {
                      statement: "Discount bug",
                      triggerConditions: "Negative coupon",
                      expectedFailure: "Throws error",
                      evidenceNeeded: "Vitest fail on target",
                      testCode: `import { it } from "vitest";\nimport { x } from "../../src/missing";\nit("x", () => {});`,
                    },
                  },
                },
              ],
            },
          },
        ],
      })
      .mockResolvedValueOnce({
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: {
                    args: {
                      statement: "Discount bug",
                      triggerConditions: "Negative coupon",
                      expectedFailure: "Throws error",
                      evidenceNeeded: "Vitest fail on target",
                      testCode: `import { expect, it } from "vitest";\nimport { applyDiscount } from "../../src/cart/discount";\nit("rejects negative", () => expect(() => applyDiscount(-1)).toThrow());`,
                    },
                  },
                },
              ],
            },
          },
        ],
      });

    const result = await generateHypothesis({
      investigationId: "inv_cart9999",
      owner: "acme",
      repo: "shop",
      commitSha: "abc123",
      description: "Negative coupon fails",
      summary: "Discount bug",
      evidenceItems: [],
      candidateAreas: [{ path: "src/cart/discount.ts" }],
      repoPaths: ["package.json", "src/cart/discount.ts"],
    });

    expect(mocks.generateContent).toHaveBeenCalledTimes(2);
    const secondCallText = mocks.generateContent.mock.calls[1][0].contents[0].parts[0].text;
    expect(secondCallText).toContain("HYP-4");
    expect(result.content).toContain("../../src/cart/discount");
    expect(result.modelId).toBe("gemma-4-26b-a4b-it");
  });
});

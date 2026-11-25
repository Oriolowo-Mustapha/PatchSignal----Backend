import { z } from "zod";

export const proposedHypothesisSchema = z.object({
  statement: z.string().min(1),
  triggerConditions: z.string().min(1),
  expectedFailure: z.string().min(1),
  evidenceNeeded: z.string().min(1),
  testCode: z.string().min(1),
});

export type ProposedHypothesis = z.infer<typeof proposedHypothesisSchema>;

export const proposeHypothesisFunctionDeclaration = {
  name: "propose_hypothesis",
  description: "Propose one falsifiable bug hypothesis and a candidate Vitest test asserting the expected behavior.",
  parameters: {
    type: "OBJECT",
    properties: {
      statement: { type: "STRING" },
      triggerConditions: { type: "STRING" },
      expectedFailure: { type: "STRING" },
      evidenceNeeded: { type: "STRING" },
      testCode: { type: "STRING" },
    },
    required: ["statement", "triggerConditions", "expectedFailure", "evidenceNeeded", "testCode"],
  },
} as const;

export const proposeHypothesisOpenAITool = {
  type: "function",
  function: {
    name: "propose_hypothesis",
    description: "Propose one falsifiable bug hypothesis and a candidate Vitest test asserting the expected behavior.",
    parameters: {
      type: "object",
      properties: {
        statement: { type: "string" },
        triggerConditions: { type: "string" },
        expectedFailure: { type: "string" },
        evidenceNeeded: { type: "string" },
        testCode: { type: "string" },
      },
      required: ["statement", "triggerConditions", "expectedFailure", "evidenceNeeded", "testCode"],
    },
  },
} as const;

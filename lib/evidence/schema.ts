import { z } from "zod";

export const provenanceSchema = z.enum(["observed", "reported", "hypothesis", "unknown"]);

// Normalize common model variants before strict validation:
// "field: expected" -> "field:expected", "Screenshot 1" -> "image:1",
// "user description"/"report" -> "description", "inference" -> "model".
// Anything else still fails validation (honest reject, retried with hint).
export function normalizeSource(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  const s = raw.trim().replace(/^field:\s*/i, "field:").replace(/^image:\s*/i, "image:").replace(/^run:\s*/i, "run:");
  const low = s.toLowerCase();
  if (/^image:\d+$/.test(low)) return low;
  if (/^field:\S+$/.test(s) || /^run:\S+$/.test(s)) return s;
  if (low === "model" || low === "inference" || low === "hypothesis") return "model";
  if (low === "description" || low === "report" || low === "user" || low.includes("user report") || low.includes("user-provided") || low.includes("user provided")) return "description";
  const img = low.match(/(?:image|screenshot|img)\s*[\s:#-]*(\d+)/);
  if (img) return `image:${img[1]}`;
  return s;
}

const sourceSchema = z.preprocess(
  normalizeSource,
  z
    .string()
    .refine(
      (s) =>
        s === "model" ||
        s === "description" ||
        s.startsWith("image:") ||
        s.startsWith("field:") ||
        s.startsWith("run:"),
      { message: "source must be image:N, field:X, run:Y, description, or model" }
    )
);

export const recordEvidenceSchema = z.object({
  summary: z.string().min(1),
  expected: z.object({
    text: z.string(),
    provenance: provenanceSchema,
    source: sourceSchema,
  }),
  actual: z.object({
    text: z.string(),
    provenance: provenanceSchema,
    source: sourceSchema,
  }),
  evidence: z
    .array(
      z.object({
        text: z.string().min(1),
        provenance: provenanceSchema,
        source: sourceSchema,
      })
    )
    .min(1),
  unknowns: z.array(
    z.object({
      item: z.string().min(1),
      question: z.string().min(1),
      blocking: z.boolean().default(false),
    })
  ),
  candidateAreas: z
    .array(
      z.object({
        path: z.string().min(1),
        provenance: z.preprocess(() => "hypothesis", z.literal("hypothesis")),
      })
    )
    .default([]),
});

export type RecordEvidence = z.infer<typeof recordEvidenceSchema>;

// record_evidence function declaration for Gemini structured output (§5.3)
export const recordEvidenceFunctionDeclaration = {
  name: "record_evidence",
  description: "Record structured bug evidence with provenance tags.",
  parameters: {
    type: "OBJECT",
    properties: {
      summary: { type: "STRING" },
      expected: {
        type: "OBJECT",
        properties: {
          text: { type: "STRING" },
          provenance: { type: "STRING", enum: ["observed", "reported", "hypothesis", "unknown"] },
          source: { type: "STRING" },
        },
        required: ["text", "provenance", "source"],
      },
      actual: {
        type: "OBJECT",
        properties: {
          text: { type: "STRING" },
          provenance: { type: "STRING", enum: ["observed", "reported", "hypothesis", "unknown"] },
          source: { type: "STRING" },
        },
        required: ["text", "provenance", "source"],
      },
      evidence: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            text: { type: "STRING" },
            provenance: { type: "STRING", enum: ["observed", "reported", "hypothesis", "unknown"] },
            source: { type: "STRING" },
          },
          required: ["text", "provenance", "source"],
        },
      },
      unknowns: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            item: { type: "STRING" },
            question: { type: "STRING" },
            blocking: { type: "BOOLEAN" },
          },
          required: ["item", "question"],
        },
      },
      candidateAreas: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            path: { type: "STRING" },
            provenance: { type: "STRING", enum: ["hypothesis"] },
          },
          required: ["path"],
        },
      },
    },
    required: ["summary", "expected", "actual", "evidence", "unknowns"],
  },
} as const;

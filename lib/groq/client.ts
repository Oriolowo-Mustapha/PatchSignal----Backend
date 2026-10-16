import { withDeadline } from "@/lib/analysis/deadline";
import { config } from "@/lib/config";
import { recordEvidenceSchema, type RecordEvidence } from "@/lib/evidence/schema";

// Groq path (OpenAI-compatible chat completions, plain fetch — no extra
// deps). Model comes from GROQ_MODEL in .env. Screenshots arrive as
// Cloudinary CDN URLs, passed as image_url inputs (max 3).
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

const TOOL_DEF = {
  type: "function",
  function: {
    name: "record_evidence",
    description: "Record structured bug evidence with provenance tags.",
    parameters: {
      type: "object",
      properties: {
        summary: { type: "string" },
        expected: {
          type: "object",
          properties: {
            text: { type: "string" },
            provenance: { type: "string", enum: ["observed", "reported", "hypothesis", "unknown"] },
            source: { type: "string" },
          },
          required: ["text", "provenance", "source"],
        },
        actual: {
          type: "object",
          properties: {
            text: { type: "string" },
            provenance: { type: "string", enum: ["observed", "reported", "hypothesis", "unknown"] },
            source: { type: "string" },
          },
          required: ["text", "provenance", "source"],
        },
        evidence: {
          type: "array",
          items: {
            type: "object",
            properties: {
              text: { type: "string" },
              provenance: { type: "string", enum: ["observed", "reported", "hypothesis", "unknown"] },
              source: { type: "string" },
            },
            required: ["text", "provenance", "source"],
          },
        },
        unknowns: {
          type: "array",
          items: {
            type: "object",
            properties: {
              item: { type: "string" },
              question: { type: "string" },
              blocking: { type: "boolean" },
            },
            required: ["item", "question"],
          },
        },
        candidateAreas: {
          type: "array",
          items: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
        },
      },
      required: ["summary", "expected", "actual", "evidence", "unknowns"],
    },
  },
};

const SYSTEM =
  "You are PatchSignal evidence extractor. Call record_evidence once with the full shape. " +
  "Tag every fact observed|reported|hypothesis|unknown. Observed ONLY if visible in an image. " +
  "Root causes stay hypothesis. Missing details become unknowns with questions. " +
  "Source allowlist, copy EXACTLY: screenshot N becomes \"image:N\"; user fields become " +
  "\"field:expected\", \"field:actual\", \"field:steps\", \"field:environment\", \"field:error\" or " +
  "\"description\"; your own inference becomes \"model\".";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyMsg = any;

export async function extractViaGroq(input: {
  description: string;
  fields: Record<string, string>;
  imageUrls: string[];
}): Promise<{ evidence: RecordEvidence; modelId: string }> {
  if (!config.groqApiKey) throw new Error("GROQ_API_KEY not set — add it to .env and restart.");
  if (!config.groqModel) throw new Error("GROQ_MODEL not set — add the model ID to .env and restart.");
  const model = config.groqModel;
  const dataText = [
    `Bug report description:\n${input.description}`,
    ...Object.entries(input.fields).map(([k, v]) => `${k}: ${v || "(empty — record Unknown)"}`),
  ].join("\n\n");

  let hint: string | undefined;
  let lastError = "no attempts made";
  for (const waitMs of [0, 1000]) {
    if (waitMs) await sleep(waitMs);
    try {
      const content: AnyMsg[] = [
        ...input.imageUrls.slice(0, 3).map((url) => ({ type: "image_url", image_url: { url } })),
        { type: "text", text: hint ? `Correction to your previous call: ${hint}\n\n${dataText}` : dataText },
      ];
      const res = await withDeadline(async signal => {
        const response = await fetch(GROQ_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${config.groqApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: SYSTEM },
            { role: "user", content },
          ],
          tools: [TOOL_DEF],
          tool_choice: "required",
          temperature: 1.0,
          top_p: 0.95,
          max_completion_tokens: 4096,
        }),
        signal,
        });
        return {ok:response.ok,status:response.status,text:await response.text()};
      },25_000);
      if (!res.ok) {
        lastError = `${model}: HTTP ${res.status} ${res.text.slice(0, 300)}`;
        hint = undefined;
        continue;
      }
      const body = JSON.parse(res.text) as AnyMsg;
      const msg = body?.choices?.[0]?.message;
      const call = msg?.tool_calls?.[0]?.function;
      let args: unknown = null;
      if (call?.arguments) {
        try {
          args = JSON.parse(call.arguments);
        } catch {
          lastError = `${model}: tool arguments not JSON`;
          hint = "Your record_evidence arguments were not valid JSON. Return valid JSON only.";
          continue;
        }
      } else if (typeof msg?.content === "string" && msg.content.includes("{")) {
        try {
          args = JSON.parse(msg.content.slice(msg.content.indexOf("{")));
        } catch {
          args = null;
        }
      }
      if (!args) {
        lastError = `${model}: no function call in response`;
        hint = "You must call record_evidence once with the full shape.";
        continue;
      }
      const parsed = recordEvidenceSchema.safeParse(args);
      if (parsed.success) return { evidence: parsed.data, modelId: model };
      const issues = parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")
        .slice(0, 600);
      lastError = `${model}: schema failure ${issues}`;
      hint = `Your previous record_evidence call failed validation: ${issues}. Fix ONLY those fields.`;
    } catch (e) {
      lastError = `${model}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300);
      hint = undefined;
    }
  }
  throw new Error(`Groq extraction failed after 2 attempts (${model}). Last: ${lastError}`);
}

import { config } from "@/lib/config";
import { getInvestigation } from "@/lib/investigations";
import { cachedDemoEvidence, extractEvidence, uploadImageToGemini } from "@/lib/gemma/client";
import { extractViaGroq } from "@/lib/groq/client";
import { recordEvidenceSchema } from "@/lib/evidence/schema";
import { withDeadline } from "@/lib/analysis/deadline";
import { prisma } from "@/lib/db/client";
import { memoryStore, useMemoryStore, type StoredAttachment } from "@/lib/store";
import { claim, complete, fail } from "./jobs";

type WorkerAttachment = {
  id?: string;
  publicId: string;
  secureUrl: string;
  mime: string;
  geminiFileUri?: string | null;
};

async function persistGeminiFileUri(
  investigationId: string,
  attachment: WorkerAttachment,
  geminiFileUri: string
) {
  if (useMemoryStore()) {
    const inv = memoryStore.get(investigationId);
    if (!inv) return;
    const updated: StoredAttachment[] = inv.attachments.map((item) =>
      (attachment.id && item.id === attachment.id) || item.publicId === attachment.publicId
        ? { ...item, geminiFileUri }
        : item
    );
    memoryStore.update(investigationId, { attachments: updated });
    return;
  }
  if (attachment.id) {
    await prisma.attachment.update({
      where: { id: attachment.id },
      data: { geminiFileUri },
    });
  } else {
    await prisma.attachment.updateMany({
      where: { publicId: attachment.publicId },
      data: { geminiFileUri },
    });
  }
}

async function resolveGeminiImageParts(
  investigationId: string,
  attachments: WorkerAttachment[]
): Promise<{ fileUri: string; mimeType: string }[]> {
  const parts: { fileUri: string; mimeType: string }[] = [];
  const maxBytes = config.maxScreenshotBytes ?? 5 * 1024 * 1024;

  for (const file of attachments.slice(0, 3)) {
    const mimeType = file.mime || "image/png";
    if (file.geminiFileUri) {
      parts.push({ fileUri: file.geminiFileUri, mimeType });
      continue;
    }
    if (file.secureUrl && file.secureUrl.startsWith("https://")) {
      const buf = await withDeadline(async (signal) => {
        const res = await fetch(file.secureUrl, { signal });
        if (!res.ok) {
          throw new Error(`Screenshot download failed (${res.status})`);
        }
        const bytes = Buffer.from(await res.arrayBuffer());
        if (bytes.length > maxBytes) {
          throw new Error("Screenshot exceeds maximum allowed size");
        }
        return bytes;
      }, 15_000);

      const geminiFileUri = await uploadImageToGemini(buf, mimeType, file.publicId);
      await persistGeminiFileUri(investigationId, file, geminiFileUri);
      parts.push({ fileUri: geminiFileUri, mimeType });
    }
  }
  return parts;
}

function classifyFailureReason(err: unknown): "busy" | "storage" | undefined {
  const msg = err instanceof Error ? err.message : String(err);
  if (/(?:\b429\b|\b503\b|UNAVAILABLE|rate_limit|high demand|aborted|timed out)/i.test(msg)) {
    return "busy";
  }
  if (/(?:\bP2028\b|Transaction|database|pool|connect|Can't reach)/i.test(msg)) {
    return "storage";
  }
  return undefined;
}

export async function runOne() {
  const job = await claim();
  if (!job) return false;
  try {
    const inv = await getInvestigation(job.investigationId);
    if (!inv) throw new Error("Investigation removed");
    const hasKey = config.modelProvider === "groq" ? !!config.groqApiKey : !!config.geminiApiKey;
    const attachments = (inv.attachments ?? []) as WorkerAttachment[];
    const imageUrls = attachments
      .map((file) => file.secureUrl)
      .filter((url) => url.startsWith("https://"))
      .slice(0, 3);
    const imageParts =
      hasKey && config.modelProvider !== "groq"
        ? await resolveGeminiImageParts(job.investigationId, attachments)
        : [];
    const extractInput = {
      description: inv.description,
      fields: {
        expected: inv.expected ?? "",
        actual: inv.actual ?? "",
        steps: inv.steps ?? "",
        environment: inv.environment ?? "",
        error: inv.errorText ?? "",
      },
      imageParts,
      imageUrls,
    };
    let result: { evidence: unknown; modelId: string };
    if (!hasKey) {
      result = { evidence: cachedDemoEvidence(), modelId: "cached-demo" };
    } else {
      try {
        result = await extractEvidence(extractInput);
      } catch (primaryErr) {
        if (config.modelProvider !== "groq" && config.groqApiKey && config.groqModel) {
          console.warn(
            "[analysis-worker] primary model unavailable, falling back to Groq:",
            job.investigationId,
            primaryErr instanceof Error ? primaryErr.message : String(primaryErr)
          );
          result = await extractViaGroq({
            description: extractInput.description,
            fields: extractInput.fields,
            imageUrls,
          });
        } else {
          throw primaryErr;
        }
      }
    }
    await complete(job, recordEvidenceSchema.parse(result.evidence), result.modelId, !hasKey);
  } catch (err) {
    console.error("[analysis-worker] job failed:", job.investigationId, err instanceof Error ? err.message : String(err));
    await fail(job, classifyFailureReason(err));
  }
  return true;
}

// This worker runs in the long-lived Node service. The queue and leases
// are persisted in Postgres; startup resumes queued/expired work after a crash.
// Keep a hot reference on globalThis so Next.js dev HMR picks up updated logic.
const registry = globalThis as typeof globalThis & {
  __ps_workerStarted?: boolean;
  __ps_runOne?: () => Promise<boolean>;
};
registry.__ps_runOne = runOne;

export function startAnalysisWorker() {
  registry.__ps_runOne = runOne;
  if (registry.__ps_workerStarted || process.env.NEXT_PHASE === "phase-production-build") return;
  registry.__ps_workerStarted = true;
  async function tick() {
    try {
      await (registry.__ps_runOne ? registry.__ps_runOne() : runOne());
    } catch {
      console.error("Analysis queue unavailable; retrying on next poll.");
    }
    setTimeout(() => void tick(), 2000).unref();
  }
  setTimeout(() => void tick(), 0).unref();
}

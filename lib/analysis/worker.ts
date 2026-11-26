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
  __ps_workerTimer?: ReturnType<typeof setTimeout>;
  __ps_workerRunning?: boolean;
  __ps_workerFailures?: number;
};
registry.__ps_runOne = runOne;

const IDLE_POLL_MS = 30_000;
const MAX_BACKOFF_MS = 120_000;

function scheduleTick(delayMs: number) {
  if (registry.__ps_workerTimer) {
    clearTimeout(registry.__ps_workerTimer);
  }
  registry.__ps_workerTimer = setTimeout(async () => {
    registry.__ps_workerTimer = undefined;
    let processed = false;
    let failed = false;
    if (!registry.__ps_workerRunning) {
      registry.__ps_workerRunning = true;
      try {
        processed = await (registry.__ps_runOne ? registry.__ps_runOne() : runOne());
      } catch (err) {
        failed = true;
        const failures = (registry.__ps_workerFailures ?? 0) + 1;
        registry.__ps_workerFailures = failures;
        // Log the first failure and then every 5th so an unreachable DB doesn't flood the console.
        if (failures === 1 || failures % 5 === 0) {
          const reason = err instanceof Error ? err.message.split("\n").filter(Boolean).pop() : String(err);
          console.error(
            `[analysis-worker] database unreachable (attempt ${failures}); backing off. ${reason ?? ""}`.trim()
          );
        }
      } finally {
        registry.__ps_workerRunning = false;
      }
    }
    if (!failed && registry.__ps_workerFailures) {
      console.info("[analysis-worker] database connection restored.");
      registry.__ps_workerFailures = 0;
    }
    const backoff = failed
      ? Math.min(IDLE_POLL_MS * 2 ** Math.min((registry.__ps_workerFailures ?? 1) - 1, 4), MAX_BACKOFF_MS)
      : processed
        ? 250
        : IDLE_POLL_MS;
    scheduleTick(backoff);
  }, delayMs);
  registry.__ps_workerTimer.unref();
}

export function startAnalysisWorker() {
  registry.__ps_runOne = runOne;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  if (!registry.__ps_workerStarted) {
    registry.__ps_workerStarted = true;
    // Give the server a moment to finish booting before the first DB poll.
    scheduleTick(3_000);
    return;
  }
  // Wake immediately when a new job is enqueued while worker is idle.
  scheduleTick(100);
}

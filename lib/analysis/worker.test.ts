import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

const mocks = vi.hoisted(() => ({
  extractEvidence: vi.fn(),
  uploadImageToGemini: vi.fn(),
}));

vi.mock("@/lib/config", () => ({
  config: {
    geminiApiKey: "test-gemini-key",
    modelProvider: "gemini",
    groqApiKey: "",
    maxScreenshotBytes: 5 * 1024 * 1024,
  },
}));

vi.mock("@/lib/gemma/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/gemma/client")>()),
  extractEvidence: mocks.extractEvidence,
  uploadImageToGemini: mocks.uploadImageToGemini,
}));

import { memoryStore } from "@/lib/store";
import { cachedDemoEvidence } from "@/lib/gemma/client";
import { enqueue } from "./jobs";
import { runOne } from "./worker";

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function createWithAttachment(attachment: {
  id: string;
  publicId: string;
  secureUrl: string;
  mime: string;
  sizeBytes: number;
  geminiFileUri?: string | null;
}) {
  const id = randomUUID();
  memoryStore.create({
    id,
    userId: "user-1",
    repoUrl: "https://github.com/a/b",
    owner: "a",
    repo: "b",
    description: "Screenshot bug",
    stage: "intake",
    status: "pending",
    attachments: [attachment],
    createdAt: new Date().toISOString(),
  });
  return id;
}

describe("analysis worker Gemini screenshot wiring", () => {
  it("reuses an existing geminiFileUri without re-uploading", async () => {
    const id = createWithAttachment({
      id: "att-1",
      publicId: "ps/att-1",
      secureUrl: "https://res.cloudinary.com/demo/image/upload/v1/sample.png",
      mime: "image/png",
      sizeBytes: 123,
      geminiFileUri: "https://generativelanguage.googleapis.com/v1beta/files/existing",
    });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    mocks.extractEvidence.mockResolvedValue({ evidence: cachedDemoEvidence(), modelId: "gemma-4-31b-it" });

    await enqueue(id);
    await runOne();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mocks.uploadImageToGemini).not.toHaveBeenCalled();
    expect(mocks.extractEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        imageParts: [
          { fileUri: "https://generativelanguage.googleapis.com/v1beta/files/existing", mimeType: "image/png" },
        ],
      })
    );
    expect(memoryStore.get(id)?.stage).toBe("analyzed");
  });

  it("downloads https secureUrl, uploads to Gemini Files API, persists geminiFileUri, and passes imageParts", async () => {
    const id = createWithAttachment({
      id: "att-2",
      publicId: "ps/att-2",
      secureUrl: "https://res.cloudinary.com/demo/image/upload/v1/shot.jpg",
      mime: "image/jpeg",
      sizeBytes: 456,
      geminiFileUri: null,
    });
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => Uint8Array.from([1, 2, 3, 4]).buffer,
    });
    vi.stubGlobal("fetch", fetchSpy);
    mocks.uploadImageToGemini.mockResolvedValue("https://generativelanguage.googleapis.com/v1beta/files/new-123");
    mocks.extractEvidence.mockResolvedValue({ evidence: cachedDemoEvidence(), modelId: "gemma-4-31b-it" });

    await enqueue(id);
    await runOne();

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://res.cloudinary.com/demo/image/upload/v1/shot.jpg",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(mocks.uploadImageToGemini).toHaveBeenCalledWith(expect.any(Buffer), "image/jpeg", "ps/att-2");
    expect(memoryStore.get(id)?.attachments[0]?.geminiFileUri).toBe(
      "https://generativelanguage.googleapis.com/v1beta/files/new-123"
    );
    expect(mocks.extractEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        imageParts: [
          { fileUri: "https://generativelanguage.googleapis.com/v1beta/files/new-123", mimeType: "image/jpeg" },
        ],
      })
    );
    expect(memoryStore.get(id)?.stage).toBe("analyzed");
  });

  it("fails the job safely without fabricating evidence when screenshot upload fails", async () => {
    const id = createWithAttachment({
      id: "att-3",
      publicId: "ps/att-3",
      secureUrl: "https://res.cloudinary.com/demo/image/upload/v1/broken.png",
      mime: "image/png",
      sizeBytes: 789,
      geminiFileUri: null,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 502, arrayBuffer: async () => new ArrayBuffer(0) })
    );

    await enqueue(id);
    await runOne();

    expect(mocks.extractEvidence).not.toHaveBeenCalled();
    const inv = memoryStore.get(id);
    expect(inv?.analysisJob?.status).toBe("failed");
    expect(inv?.analysisJob?.error).not.toContain("502");
    expect(inv?.stage).toBe("intake");
    expect(inv?.status).toBe("pending");
    expect(inv?.evidence).toBeUndefined();
  });
});

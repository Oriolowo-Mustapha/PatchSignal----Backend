import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { config, isAllowlisted } from "@/lib/config";
import { memoryStore, useMemoryStore, type StoredAttachment } from "@/lib/store";
import { prisma } from "@/lib/db/client";
import { authUser } from "@/lib/auth";
import { uploadScreenshot } from "@/lib/cloudinary/client";
import { uploadImageToGemini } from "@/lib/gemma/client";
import { getLatestClassification, getNormalizedEvidence } from "@/lib/investigations";

function toInvestigationSummary(inv: Record<string, unknown>) {
  const evidence = getNormalizedEvidence(inv);
  const cls = getLatestClassification(inv);
  const job = inv.analysisJob && typeof inv.analysisJob === "object" ? (inv.analysisJob as Record<string, unknown>) : null;
  const attachments = Array.isArray(inv.attachments) ? inv.attachments : [];
  return {
    id: String(inv.id ?? ""),
    repoUrl: String(inv.repoUrl ?? ""),
    owner: String(inv.owner ?? ""),
    repo: String(inv.repo ?? ""),
    description: String(inv.description ?? ""),
    summary: evidence.summary || null,
    stage: String(inv.stage ?? "intake"),
    status: String(inv.status ?? "pending"),
    commitSha: typeof inv.commitSha === "string" ? inv.commitSha : null,
    modelId: typeof inv.modelId === "string" ? inv.modelId : null,
    createdAt: inv.createdAt instanceof Date ? inv.createdAt.toISOString() : String(inv.createdAt ?? ""),
    analysisJob: job
      ? {
          id: String(job.id ?? ""),
          status: String(job.status ?? "queued"),
          error: typeof job.error === "string" ? job.error : null,
          updatedAt: job.updatedAt instanceof Date ? job.updatedAt.toISOString() : String(job.updatedAt ?? ""),
        }
      : null,
    latestClassification: cls
      ? {
          status: cls.status,
          rule: cls.rule ?? "",
          justification: cls.justification ?? "",
        }
      : null,
    attachmentCount: attachments.length,
    evidenceCount: evidence.items.length,
    blockingUnknowns: evidence.questions.filter((q) => q.blocking).length,
  };
}

export async function GET(req: NextRequest) {
  const auth = await authUser(req);
  if (auth instanceof NextResponse) return auth;

  if (useMemoryStore()) {
    const items = memoryStore
      .list()
      .filter((inv) => inv.userId === auth.userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 50)
      .map((inv) => toInvestigationSummary(inv as unknown as Record<string, unknown>));
    return NextResponse.json({ investigations: items }, { headers: { "Cache-Control": "no-store" } });
  }

  const rows = await prisma.investigation.findMany({
    where: { userId: auth.userId },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      analysisJob: { select: { id: true, status: true, error: true, updatedAt: true } },
      evidence: { select: { text: true, provenance: true, source: true } },
      questions: { select: { text: true, blocking: true } },
      attachments: { select: { id: true } },
      classifications: { orderBy: { decidedAt: "asc" }, select: { status: true, rule: true, justification: true } },
    },
  });
  const investigations = rows.map((row) => toInvestigationSummary(row as unknown as Record<string, unknown>));
  return NextResponse.json({ investigations }, { headers: { "Cache-Control": "no-store" } });
}

function parseRepo(url: string): { owner: string; repo: string } | null {
  try {
    const u = new URL(url.trim());
    if (u.hostname !== "github.com") return null;
    const [owner, repo] = u.pathname.replace(/^\//, "").replace(/\.git$/, "").split("/");
    if (!owner || !repo) return null;
    return { owner, repo };
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const auth = await authUser(req);
  if (auth instanceof NextResponse) return auth;

  const form = await req.formData();
  const repoUrl = String(form.get("repoUrl") ?? "");
  const description = String(form.get("description") ?? "");
  const expected = String(form.get("expected") ?? "");
  const actual = String(form.get("actual") ?? "");
  const steps = String(form.get("steps") ?? "");
  const environment = String(form.get("environment") ?? "");
  const errorText = String(form.get("errorText") ?? "");

  if (!repoUrl || !description) {
    return NextResponse.json({ error: "repoUrl and description are required" }, { status: 400 });
  }
  const parsed = parseRepo(repoUrl);
  if (!parsed) {
    return NextResponse.json({ error: "Only public github.com URLs accepted (INT-1)" }, { status: 400 });
  }
  if (!isAllowlisted(parsed.owner, parsed.repo)) {
    return NextResponse.json(
      { error: `Hosted demo investigates only: ${config.allowlist.join(", ")} (REPO-5)` },
      { status: 403 }
    );
  }

  const files = form.getAll("screenshots").filter((f) => f instanceof File) as File[];
  if (files.length > config.maxScreenshots) {
    return NextResponse.json({ error: `Max ${config.maxScreenshots} screenshots` }, { status: 400 });
  }
  for (const f of files) {
    if (!["image/png", "image/jpeg"].includes(f.type)) {
      return NextResponse.json({ error: `Only PNG/JPEG accepted, got ${f.type}` }, { status: 400 });
    }
    if (f.size > config.maxScreenshotBytes) {
      return NextResponse.json({ error: `${f.name} exceeds 5MB` }, { status: 400 });
    }
  }

  const id = `inv_${randomUUID().slice(0, 8)}`;
  const attachments: StoredAttachment[] = [];

  const cloudReady = Boolean(config.cloudinary.cloudName && config.cloudinary.apiKey && config.cloudinary.apiSecret);
  const shouldUploadGemini = Boolean(config.geminiApiKey) && config.modelProvider !== "groq";

  for (let idx = 0; idx < files.length; idx++) {
    const f = files[idx];
    const buf = Buffer.from(await f.arrayBuffer());
    const safeName = (f.name || "screenshot.png").replace(/[^a-zA-Z0-9.-]/g, "_");
    let publicId = `pending:${id}:${Date.now()}-${idx}-${safeName}`;
    let secureUrl = "";
    let width: number | null = null;
    let height: number | null = null;
    let sizeBytes = f.size;
    let geminiFileUri: string | null = null;

    if (cloudReady) {
      try {
        const up = await uploadScreenshot(buf, id, f.name || "screenshot.png");
        publicId = up.publicId;
        secureUrl = up.secureUrl;
        width = up.width ?? null;
        height = up.height ?? null;
        sizeBytes = up.bytes ?? f.size;
      } catch (e) {
        return NextResponse.json({ error: `Cloudinary upload failed: ${e instanceof Error ? e.message : e}` }, { status: 502 });
      }
    }

    if (shouldUploadGemini) {
      try {
        geminiFileUri = await uploadImageToGemini(buf, f.type, f.name || "screenshot.png", 10_000);
      } catch {
        // Best-effort at intake; worker retries from secureUrl if needed.
        geminiFileUri = null;
      }
    }

    attachments.push({
      id: randomUUID(),
      publicId,
      secureUrl,
      mime: f.type,
      sizeBytes,
      width,
      height,
      geminiFileUri,
    });
  }

  if (useMemoryStore()) {
    memoryStore.create({
      id,
      userId: auth.userId,
      repoUrl,
      owner: parsed.owner,
      repo: parsed.repo,
      description,
      expected,
      actual,
      steps,
      environment,
      errorText,
      stage: "intake",
      status: "pending",
      attachments,
      createdAt: new Date().toISOString(),
    });
    return NextResponse.json({ id, store: "memory", attachments: attachments.length, cloudinary: cloudReady }, { status: 201 });
  }

  const persistable = attachments.filter((a) => Boolean(a.secureUrl) || Boolean(a.geminiFileUri));
  const inv = await prisma.investigation.create({
    data: {
      id,
      userId: auth.userId,
      repoUrl,
      owner: parsed.owner,
      repo: parsed.repo,
      description,
      expected: expected || null,
      actual: actual || null,
      steps: steps || null,
      environment: environment || null,
      errorText: errorText || null,
      attachments: {
        create: persistable.map((a) => ({
          publicId: a.publicId,
          secureUrl: a.secureUrl,
          mime: a.mime,
          sizeBytes: a.sizeBytes,
          width: a.width ?? null,
          height: a.height ?? null,
          geminiFileUri: a.geminiFileUri ?? null,
        })),
      },
    },
  });
  return NextResponse.json({ id: inv.id, store: "postgres", attachments: persistable.length }, { status: 201 });
}

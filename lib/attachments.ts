import { prisma } from "@/lib/db/client";
import { memoryStore, useMemoryStore } from "@/lib/store";

export type ResolvedAttachment = {
  id: string;
  publicId: string;
  secureUrl: string;
  mime: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  investigationId: string;
};

export function resolveAttachment(inv: unknown, attachmentId: string): string | null {
  const list = (inv as { attachments?: { id?: string; publicId: string; secureUrl: string }[] }).attachments ?? [];
  return list.find((a) => a.id === attachmentId || a.publicId === attachmentId)?.secureUrl ?? null;
}

export async function findOwnedAttachment(attachmentId: string, userId: string): Promise<ResolvedAttachment | null> {
  if (useMemoryStore()) {
    for (const inv of memoryStore.list()) {
      if (inv.userId !== userId) continue;
      const found = inv.attachments.find((a) => a.id === attachmentId || a.publicId === attachmentId);
      if (found) {
        return {
          id: found.id ?? found.publicId,
          publicId: found.publicId,
          secureUrl: found.secureUrl,
          mime: found.mime,
          sizeBytes: found.sizeBytes,
          width: found.width ?? null,
          height: found.height ?? null,
          investigationId: inv.id,
        };
      }
    }
    return null;
  }
  const att = await prisma.attachment.findFirst({
    where: { OR: [{ id: attachmentId }, { publicId: attachmentId }] },
    include: { investigation: { select: { userId: true } } },
  });
  if (!att || att.investigation.userId !== userId) return null;
  return {
    id: att.id,
    publicId: att.publicId,
    secureUrl: att.secureUrl,
    mime: att.mime,
    sizeBytes: att.sizeBytes,
    width: att.width,
    height: att.height,
    investigationId: att.investigationId,
  };
}

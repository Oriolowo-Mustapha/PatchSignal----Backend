import { prisma } from "@/lib/db/client";
import { memoryStore, useMemoryStore, type StoredInvestigation } from "@/lib/store";

export async function getInvestigation(id: string) {
  if (useMemoryStore()) return memoryStore.get(id);
  const inv = await prisma.investigation.findUnique({
    where: { id },
    include: { analysisJob: { select: {id:true,status:true,error:true,updatedAt:true} }, evidence: true, questions: true, hypotheses: { include: { tests: true, runs: true } }, attachments: true, classifications: true },
  });
  return inv;
}

export async function saveClassification(invId: string, status: "Reproduced" | "Not_reproduced" | "Inconclusive", rule: string, justification: string) {
  if (useMemoryStore()) {
    return memoryStore.update(invId, { classification: { status, rule, justification }, status, stage: "packaged" });
  }
  await prisma.classification.create({ data: { investigationId: invId, status, rule, justification } });
  return prisma.investigation.update({ where: { id: invId }, data: { status, stage: "packaged" } });
}

export type { StoredInvestigation };

import { PrismaClient } from "@prisma/client";
import { normalizeDatabaseUrl } from "./retry";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

const resolvedDatabaseUrl = normalizeDatabaseUrl(process.env.DATABASE_URL);

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    ...(resolvedDatabaseUrl ? { datasources: { db: { url: resolvedDatabaseUrl } } } : {}),
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export async function dbHealthy(): Promise<{ ok: boolean; error?: string }> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "db unreachable" };
  }
}

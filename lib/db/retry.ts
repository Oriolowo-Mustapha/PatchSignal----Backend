export function normalizeDatabaseUrl(rawUrl?: string): string | undefined {
  if (!rawUrl || !rawUrl.trim()) return undefined;
  try {
    const parsed = new URL(rawUrl.trim());
    if (!parsed.protocol.startsWith("postgres")) return rawUrl.trim();
    const curLimit = Number(parsed.searchParams.get("connection_limit") ?? "0");
    if (!Number.isFinite(curLimit) || curLimit < 15) {
      parsed.searchParams.set("connection_limit", "15");
    }
    const curPoolTimeout = Number(parsed.searchParams.get("pool_timeout") ?? "0");
    if (!Number.isFinite(curPoolTimeout) || curPoolTimeout < 30) {
      parsed.searchParams.set("pool_timeout", "30");
    }
    const curConnectTimeout = Number(parsed.searchParams.get("connect_timeout") ?? "0");
    if (!Number.isFinite(curConnectTimeout) || curConnectTimeout < 30) {
      parsed.searchParams.set("connect_timeout", "30");
    }
    return parsed.toString();
  } catch {
    return rawUrl.trim();
  }
}

export function isTransientDbError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: string }).code ?? "";
  if (["P2024", "P1001", "P1002", "P1008", "P1017"].includes(code)) {
    return true;
  }
  const msg = err instanceof Error ? err.message : String(err);
  return /Timed out fetching a new connection|Can't reach database server|Server has closed the connection|Connection terminated unexpectedly|P2024/i.test(
    msg
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withDbRetry<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
  const backoffs = [250, 600, 1200];
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!isTransientDbError(err) || attempt === retries) {
        throw err;
      }
      await sleep(backoffs[attempt] ?? 600);
    }
  }
  throw lastError;
}

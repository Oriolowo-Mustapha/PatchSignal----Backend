import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const { findUniqueMock } = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  prisma: {
    session: {
      findUnique: findUniqueMock,
    },
  },
}));

import { authUser, SESSION_COOKIE_NAME, signToken } from "./auth";
import { isTransientDbError, normalizeDatabaseUrl } from "./db/retry";

describe("Prisma connection pool resilience & authUser", () => {
  beforeEach(() => {
    findUniqueMock.mockReset();
    vi.stubEnv("DATABASE_URL", "postgresql://postgres:secret@localhost:6543/postgres?pgbouncer=true");
    vi.stubEnv("JWT_SECRET", "unit-test-secret-for-auth-resilience");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("upgrades small connection_limit / timeout parameters in normalizeDatabaseUrl", () => {
    const normalized = normalizeDatabaseUrl(
      "postgresql://postgres:secret@aws-0-eu-central-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=5&pool_timeout=10&connect_timeout=5"
    );
    expect(normalized).toBeDefined();
    const parsed = new URL(normalized!);
    expect(parsed.searchParams.get("pgbouncer")).toBe("true");
    expect(parsed.searchParams.get("connection_limit")).toBe("15");
    expect(parsed.searchParams.get("pool_timeout")).toBe("30");
    expect(parsed.searchParams.get("connect_timeout")).toBe("30");
  });

  it("preserves larger pool limits when already configured above minimum", () => {
    const normalized = normalizeDatabaseUrl(
      "postgresql://postgres:secret@localhost:5432/postgres?connection_limit=25&pool_timeout=45&connect_timeout=60"
    );
    const parsed = new URL(normalized!);
    expect(parsed.searchParams.get("connection_limit")).toBe("25");
    expect(parsed.searchParams.get("pool_timeout")).toBe("45");
    expect(parsed.searchParams.get("connect_timeout")).toBe("60");
  });

  it("retries transient Prisma P2024 pool timeouts and returns 503 (never 401)", async () => {
    findUniqueMock.mockRejectedValue(
      Object.assign(
        new Error(
          "Timed out fetching a new connection from the connection pool. More info: http://pris.ly/d/connection-pool (Current connection pool timeout: 10, connection limit: 5)"
        ),
        { code: "P2024" }
      )
    );

    const token = signToken("user_123", "maintainer@example.com", "jti_test_abc");
    const req = new NextRequest("http://test/api/investigations/inv_1/inspect", {
      method: "POST",
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${token}`,
      },
    });

    const result = await authUser(req);
    expect(result).toBeInstanceOf(NextResponse);
    const res = result as NextResponse;
    expect(res.status).toBe(503);
    const payload = await res.json();
    expect(payload.error).toMatch(/Database connection busy/i);
    // Initial attempt + 2 transient retries from withDbRetry
    expect(findUniqueMock).toHaveBeenCalledTimes(3);
  });

  it("recovers cleanly when the second attempt succeeds after a P2024 pool timeout", async () => {
    findUniqueMock
      .mockRejectedValueOnce(
        Object.assign(new Error("Timed out fetching a new connection from the connection pool"), {
          code: "P2024",
        })
      )
      .mockResolvedValueOnce({
        id: "sess_1",
        userId: "user_123",
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
        user: { id: "user_123" },
      });

    const token = signToken("user_123", "maintainer@example.com", "jti_recover");
    const req = new NextRequest("http://test/api/investigations/inv_1/inspect", {
      method: "POST",
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=${token}`,
      },
    });

    const result = await authUser(req);
    expect(result).toEqual({
      userId: "user_123",
    });
    expect(findUniqueMock).toHaveBeenCalledTimes(2);
  });

  it("recognizes Windows Os 10054 ConnectionReset errors as transient DB failures", () => {
    const winResetErr = new Error(
      'Error in PostgreSQL connection: Error { kind: Io, cause: Some(Os { code: 10054, kind: ConnectionReset, message: "An existing connection was forcibly closed by the remote host." }) }'
    );
    expect(isTransientDbError(winResetErr)).toBe(true);
  });
});

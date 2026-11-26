import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { withDbRetry } from "@/lib/db/retry";
import { canUseMemoryAuth, memorySessionStore, memoryUserStore } from "@/lib/store";

export const SESSION_COOKIE_NAME = "ps_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const RATE_LIMIT_MAX_ATTEMPTS = 20;
const SESSION_CACHE_TTL_MS = 20_000;

const globalForAuth = globalThis as unknown as {
  __ps_devJwtSecret?: string;
  __ps_devJwtWarned?: boolean;
  __ps_authRateBuckets?: Map<string, number[]>;
  __ps_verifiedSessionCache?: Map<
    string,
    { userId: string; expiresAtMs: number; cachedUntil: number }
  >;
};

function secret(): string {
  const s = process.env.JWT_SECRET ?? "";
  if (s) return s;
  if (canUseMemoryAuth()) {
    if (!globalForAuth.__ps_devJwtSecret) {
      globalForAuth.__ps_devJwtSecret = randomBytes(32).toString("hex");
      if (!globalForAuth.__ps_devJwtWarned) {
        globalForAuth.__ps_devJwtWarned = true;
        console.warn("[auth] JWT_SECRET not set — using ephemeral dev secret (memory auth mode).");
      }
    }
    return globalForAuth.__ps_devJwtSecret;
  }
  throw new Error("JWT_SECRET not set — add it to .env and restart.");
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function checkPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function hashSessionJti(jti: string): string {
  return createHash("sha256").update(jti).digest("hex");
}

export function signToken(userId: string, email: string, jti?: string): string {
  return jwt.sign({ sub: userId, email, ...(jti ? { jti } : {}) }, secret(), {
    expiresIn: SESSION_TTL_SECONDS,
  });
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function validCredentials(email: string, password: string): string | null {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return "valid email required";
  if (password.length < 8) return "password must be at least 8 characters";
  if (password.length > 128) return "password must be 128 characters or fewer";
  return null;
}

export async function findUserById(id: string) {
  if (canUseMemoryAuth()) {
    const user = memoryUserStore.findById(id);
    if (!user) return null;
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      lastLoginAt: user.lastLoginAt ?? null,
      createdAt: user.createdAt,
    };
  }
  return withDbRetry(() =>
    prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, name: true, lastLoginAt: true, createdAt: true },
    })
  );
}

export async function findUserByEmail(email: string) {
  if (canUseMemoryAuth()) {
    return memoryUserStore.findByEmail(email);
  }
  return withDbRetry(() => prisma.user.findUnique({ where: { email } }));
}

export async function createUser(input: {
  email: string;
  passwordHash: string;
  name: string | null;
  lastLoginAt?: Date;
}) {
  if (canUseMemoryAuth()) {
    const now = new Date().toISOString();
    const created = memoryUserStore.create({
      id: `usr_${randomUUID().slice(0, 12)}`,
      email: input.email,
      passwordHash: input.passwordHash,
      name: input.name,
      lastLoginAt: input.lastLoginAt ? input.lastLoginAt.toISOString() : now,
      createdAt: now,
    });
    return {
      id: created.id,
      email: created.email,
      name: created.name,
      lastLoginAt: created.lastLoginAt ?? null,
      createdAt: created.createdAt,
    };
  }
  return withDbRetry(() =>
    prisma.user.create({
      data: {
        email: input.email,
        passwordHash: input.passwordHash,
        name: input.name,
        ...(input.lastLoginAt ? { lastLoginAt: input.lastLoginAt } : {}),
      },
      select: { id: true, email: true, name: true, lastLoginAt: true, createdAt: true },
    })
  );
}

export async function touchLastLogin(userId: string): Promise<Date> {
  const now = new Date();
  if (canUseMemoryAuth()) {
    memoryUserStore.touchLastLogin(userId, now.toISOString());
    return now;
  }
  await withDbRetry(() =>
    prisma.user.update({
      where: { id: userId },
      data: { lastLoginAt: now },
    })
  );
  return now;
}

export async function issueSession(
  user: { id: string; email: string },
  req?: Request
): Promise<{ token: string; sessionId: string; expiresAt: Date }> {
  const jti = randomBytes(24).toString("hex");
  const tokenHash = hashSessionJti(jti);
  const expiresAt = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
  const rawUa = req?.headers.get("user-agent") ?? "";
  const userAgent = rawUa.trim() ? rawUa.trim().slice(0, 255) : null;

  let sessionId: string;
  if (canUseMemoryAuth()) {
    const created = memorySessionStore.create({
      id: `ses_${randomUUID().slice(0, 12)}`,
      userId: user.id,
      tokenHash,
      userAgent,
      expiresAt: expiresAt.toISOString(),
      revokedAt: null,
      createdAt: new Date().toISOString(),
    });
    sessionId = created.id;
  } else {
    const created = await withDbRetry(() =>
      prisma.session.create({
        data: {
          userId: user.id,
          tokenHash,
          userAgent,
          expiresAt,
        },
        select: { id: true },
      })
    );
    sessionId = created.id;
  }

  return {
    token: signToken(user.id, user.email, jti),
    sessionId,
    expiresAt,
  };
}

export function attachSessionCookie(res: NextResponse, token: string): void {
  res.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export function clearSessionCookie(res: NextResponse): void {
  res.cookies.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

function parseCookieValue(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(";");
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim();
    if (k !== name) continue;
    const v = part.slice(eq + 1).trim();
    if (!v) return null;
    try {
      return decodeURIComponent(v);
    } catch {
      return v;
    }
  }
  return null;
}

export function extractToken(req: Request): string | null {
  const header = req.headers.get("authorization") ?? "";
  const [scheme, bearer] = header.split(/\s+/);
  if (scheme?.toLowerCase() === "bearer" && bearer) {
    return bearer.trim();
  }
  return parseCookieValue(req.headers.get("cookie"), SESSION_COOKIE_NAME);
}

function getVerifiedSessionCache() {
  return (globalForAuth.__ps_verifiedSessionCache ??= new Map());
}

function unauthorized(message = "Authentication required"): NextResponse {
  return NextResponse.json(
    { error: message },
    { status: 401, headers: { "Cache-Control": "no-store" } }
  );
}

// Returns userId or an error NextResponse. Accepts Bearer JWT or HttpOnly ps_session cookie
// and checks server-side Session revocation when jti is present.
export async function authUser(req: Request): Promise<{ userId: string } | NextResponse> {
  if (!process.env.DATABASE_URL && !canUseMemoryAuth()) {
    return NextResponse.json({ error: "auth requires DATABASE_URL" }, { status: 503 });
  }
  const token = extractToken(req);
  if (!token) {
    return unauthorized("Authentication required");
  }

  let payload: { sub?: string; jti?: string };
  try {
    payload = jwt.verify(token, secret()) as { sub?: string; jti?: string };
  } catch {
    return unauthorized("invalid or expired token");
  }
  if (!payload.sub) return unauthorized("invalid or expired token");

  try {
    if (payload.jti) {
      const tokenHash = hashSessionJti(payload.jti);
      if (canUseMemoryAuth()) {
        const ses = memorySessionStore.findByTokenHash(tokenHash);
        if (
          !ses ||
          ses.userId !== payload.sub ||
          ses.revokedAt !== null ||
          new Date(ses.expiresAt).getTime() <= Date.now()
        ) {
          return unauthorized("session revoked or expired");
        }
        const user = await findUserById(payload.sub);
        if (!user) return unauthorized("user not found");
        return { userId: user.id };
      }

      const now = Date.now();
      const cache = process.env.NODE_ENV !== "test" ? getVerifiedSessionCache() : null;
      const cached = cache?.get(tokenHash);
      if (
        cached &&
        cached.userId === payload.sub &&
        cached.cachedUntil > now &&
        cached.expiresAtMs > now
      ) {
        return { userId: cached.userId };
      }

      const ses = await withDbRetry(() =>
        prisma.session.findUnique({
          where: { tokenHash },
          select: {
            userId: true,
            revokedAt: true,
            expiresAt: true,
            user: { select: { id: true } },
          },
        })
      );
      if (
        !ses ||
        ses.userId !== payload.sub ||
        ses.revokedAt !== null ||
        ses.expiresAt.getTime() <= Date.now()
      ) {
        cache?.delete(tokenHash);
        return unauthorized("session revoked or expired");
      }
      if (ses.user === null) {
        cache?.delete(tokenHash);
        return unauthorized("user not found");
      }
      if (ses.user === undefined) {
        const user = await withDbRetry(() => findUserById(payload.sub!));
        if (!user) return unauthorized("user not found");
      }
      cache?.set(tokenHash, {
        userId: ses.userId,
        expiresAtMs: ses.expiresAt.getTime(),
        cachedUntil: now + SESSION_CACHE_TTL_MS,
      });
      return { userId: ses.userId };
    }

    const user = await withDbRetry(() => findUserById(payload.sub!));
    if (!user) return unauthorized("user not found");
    return { userId: user.id };
  } catch (err) {
    console.error(
      "[auth] database error during session check:",
      err instanceof Error ? err.message : String(err)
    );
    return NextResponse.json(
      { error: "Database connection busy. Please retry in a moment." },
      { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "2" } }
    );
  }
}

export async function revokeSessionFromRequest(req: Request): Promise<void> {
  if (!process.env.DATABASE_URL && !canUseMemoryAuth()) return;
  const token = extractToken(req);
  if (!token) return;
  try {
    const payload = jwt.verify(token, secret()) as { sub?: string; jti?: string };
    if (!payload.jti) return;
    const tokenHash = hashSessionJti(payload.jti);
    getVerifiedSessionCache().delete(tokenHash);
    if (canUseMemoryAuth()) {
      memorySessionStore.revokeByTokenHash(tokenHash, new Date().toISOString());
    } else {
      await withDbRetry(() =>
        prisma.session.updateMany({
          where: { tokenHash, revokedAt: null },
          data: { revokedAt: new Date() },
        })
      );
    }
  } catch {
    // Token already invalid or expired; still clear cookie on caller response
  }
}

export function checkAuthRateLimit(
  req: Request,
  bucket: "login" | "signup"
): { ok: true } | { ok: false; retryAfterSec: number } {
  if (process.env.NODE_ENV === "test") return { ok: true };
  const forwarded = req.headers.get("x-forwarded-for") ?? "";
  const ip = forwarded.split(",")[0]?.trim() || req.headers.get("x-real-ip")?.trim() || "local";
  const key = `${bucket}:${ip}`;
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  const map = (globalForAuth.__ps_authRateBuckets ??= new Map<string, number[]>());
  const hits = (map.get(key) ?? []).filter((ts) => ts > cutoff);
  if (hits.length >= RATE_LIMIT_MAX_ATTEMPTS) {
    const oldest = hits[0] ?? now;
    const retryAfterSec = Math.max(1, Math.ceil((oldest + RATE_LIMIT_WINDOW_MS - now) / 1000));
    map.set(key, hits);
    return { ok: false, retryAfterSec };
  }
  hits.push(now);
  map.set(key, hits);
  return { ok: true };
}

export function owns(inv: unknown, userId: string): boolean {
  if (!inv || typeof inv !== "object") return false;
  return (inv as { userId?: string | null }).userId === userId;
}

export async function hasActiveSessionToken(token: string | null | undefined): Promise<boolean> {
  if (!token) return false;
  const req = new Request("http://internal.local/session", {
    headers: {
      cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    },
  });
  const result = await authUser(req);
  return !(result instanceof NextResponse);
}

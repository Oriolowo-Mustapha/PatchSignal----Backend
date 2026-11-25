import { NextRequest, NextResponse } from "next/server";
import {
  attachSessionCookie,
  checkAuthRateLimit,
  createUser,
  findUserByEmail,
  hashPassword,
  issueSession,
  normalizeEmail,
  validCredentials,
} from "@/lib/auth";
import { canUseMemoryAuth } from "@/lib/store";

export async function POST(req: NextRequest) {
  if (!process.env.DATABASE_URL && !canUseMemoryAuth()) {
    return NextResponse.json({ error: "auth requires DATABASE_URL" }, { status: 503 });
  }
  const rl = checkAuthRateLimit(req, "signup");
  if (!rl.ok) {
    return NextResponse.json(
      { error: "too many signup attempts; try again later" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec), "Cache-Control": "no-store" } }
    );
  }

  const { email = "", password = "", name = "" } = await req.json().catch(() => ({}));
  const err = validCredentials(String(email), String(password));
  if (err) return NextResponse.json({ error: err }, { status: 400, headers: { "Cache-Control": "no-store" } });

  const normalized = normalizeEmail(String(email));
  const existing = await findUserByEmail(normalized);
  if (existing) {
    return NextResponse.json({ error: "email already registered" }, { status: 409, headers: { "Cache-Control": "no-store" } });
  }

  const trimmedName = typeof name === "string" ? name.trim().slice(0, 100) : "";
  const now = new Date();
  let user;
  try {
    user = await createUser({
      email: normalized,
      passwordHash: await hashPassword(String(password)),
      name: trimmedName || null,
      lastLoginAt: now,
    });
  } catch (e: unknown) {
    if ((e as { code?: string })?.code === "P2002") {
      return NextResponse.json({ error: "email already registered" }, { status: 409, headers: { "Cache-Control": "no-store" } });
    }
    throw e;
  }

  const session = await issueSession({ id: user.id, email: user.email }, req);
  const res = NextResponse.json(
    { ...user, token: session.token },
    { status: 201, headers: { "Cache-Control": "no-store" } }
  );
  attachSessionCookie(res, session.token);
  return res;
}

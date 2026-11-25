import { NextRequest, NextResponse } from "next/server";
import {
  attachSessionCookie,
  checkAuthRateLimit,
  checkPassword,
  findUserByEmail,
  issueSession,
  normalizeEmail,
  touchLastLogin,
} from "@/lib/auth";
import { canUseMemoryAuth } from "@/lib/store";

export async function POST(req: NextRequest) {
  if (!process.env.DATABASE_URL && !canUseMemoryAuth()) {
    return NextResponse.json({ error: "auth requires DATABASE_URL" }, { status: 503 });
  }
  const rl = checkAuthRateLimit(req, "login");
  if (!rl.ok) {
    return NextResponse.json(
      { error: "too many login attempts; try again later" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec), "Cache-Control": "no-store" } }
    );
  }

  const { email = "", password = "" } = await req.json().catch(() => ({}));
  const user = await findUserByEmail(normalizeEmail(String(email)));
  if (!user || !(await checkPassword(String(password), user.passwordHash))) {
    return NextResponse.json(
      { error: "invalid credentials" },
      { status: 401, headers: { "Cache-Control": "no-store" } }
    );
  }

  const lastLoginAt = await touchLastLogin(user.id);
  const session = await issueSession({ id: user.id, email: user.email }, req);
  const { passwordHash: _omit, ...safe } = user;
  void _omit;
  const res = NextResponse.json(
    { ...safe, lastLoginAt, token: session.token },
    { status: 200, headers: { "Cache-Control": "no-store" } }
  );
  attachSessionCookie(res, session.token);
  return res;
}

import { NextResponse } from "next/server";
import { clearSessionCookie, revokeSessionFromRequest } from "@/lib/auth";

export async function POST(req: Request) {
  await revokeSessionFromRequest(req);
  const res = NextResponse.json({ ok: true }, { status: 200, headers: { "Cache-Control": "no-store" } });
  clearSessionCookie(res);
  return res;
}

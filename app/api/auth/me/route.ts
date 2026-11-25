import { NextResponse } from "next/server";
import { authUser, findUserById } from "@/lib/auth";

export async function GET(req: Request) {
  const auth = await authUser(req);
  if (auth instanceof NextResponse) return auth;
  const user = await findUserById(auth.userId);
  if (!user) return NextResponse.json({ error: "user not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  return NextResponse.json(user, { headers: { "Cache-Control": "no-store" } });
}

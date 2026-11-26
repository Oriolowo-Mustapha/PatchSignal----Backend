import { NextResponse } from "next/server";
import { authUser, findUserById } from "@/lib/auth";
import { isTransientDbError } from "@/lib/db/retry";

export async function GET(req: Request) {
  const auth = await authUser(req);
  if (auth instanceof NextResponse) return auth;
  try {
    const user = await findUserById(auth.userId);
    if (!user) return NextResponse.json({ error: "user not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
    return NextResponse.json(user, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (isTransientDbError(err)) {
      return NextResponse.json(
        { error: "Database connection busy. Please retry in a moment." },
        { status: 503, headers: { "Cache-Control": "no-store" } }
      );
    }
    throw err;
  }
}

import { NextResponse } from "next/server";
import { authUser, owns } from "@/lib/auth";
import { isTransientDbError } from "@/lib/db/retry";
import { getInvestigation } from "@/lib/investigations";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authUser(req);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  try {
    const inv = await getInvestigation(id);
    if (!owns(inv as { userId?: string | null }, auth.userId)) {
      return NextResponse.json({ error: "not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json(inv, { headers: { "Cache-Control": "no-store" } });
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

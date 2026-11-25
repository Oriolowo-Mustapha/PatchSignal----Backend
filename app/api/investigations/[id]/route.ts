import { NextResponse } from "next/server";
import { getInvestigation } from "@/lib/investigations";
import { authUser, owns } from "@/lib/auth";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authUser(req);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const inv = await getInvestigation(id);
  if (!owns(inv as { userId?: string | null }, auth.userId)) {
    return NextResponse.json({ error: "not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json(inv, { headers: { "Cache-Control": "no-store" } });
}

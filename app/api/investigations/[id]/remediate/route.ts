import { NextRequest, NextResponse } from "next/server";
import { authUser, owns } from "@/lib/auth";
import { getInvestigation } from "@/lib/investigations";
import { runRemediationLoop } from "@/lib/remediation/loop";

export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authUser(req);
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;

  const inv = (await getInvestigation(id)) as unknown as {
    id: string;
    userId?: string | null;
  } | null;
  if (!inv || !owns(inv, auth.userId)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    maxAttempts?: number;
    customInstruction?: string;
  };

  const maxAttempts =
    typeof body.maxAttempts === "number" && Number.isFinite(body.maxAttempts)
      ? Math.min(Math.max(Math.round(body.maxAttempts), 1), 5)
      : 3;
  const customInstruction =
    typeof body.customInstruction === "string" ? body.customInstruction.trim() : undefined;

  try {
    const remediation = await runRemediationLoop(id, { maxAttempts, customInstruction });
    return NextResponse.json(
      { remediation },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Automated remediation failed" },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }
}

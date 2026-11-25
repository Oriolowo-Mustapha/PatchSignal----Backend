import { NextResponse } from "next/server";
import { dbHealthy } from "@/lib/db/client";

export async function GET() {
  const db = await dbHealthy();
  const safeDb = process.env.DATABASE_URL
    ? db.ok
      ? { ok: true }
      : { ok: false, error: process.env.NODE_ENV === "production" ? "database unreachable" : db.error }
    : { ok: false, error: "DATABASE_URL not set (memory store)" };
  return NextResponse.json({
    ok: true,
    db: safeDb,
    runner: process.env.RUNNER_URL ?? "http://localhost:5001",
    store: process.env.DATABASE_URL ? "postgres" : "memory",
  });
}

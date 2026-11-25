import { NextRequest, NextResponse } from "next/server";

// CORS for browser frontends on other origins (teammate UI, 됐다 demos).
// Env: CORS_ORIGINS="https://app.example.com,https://x.vercel.app" or "*" (dev default).
// Edge-safe: no Node APIs. Auth still enforced per-route by Bearer JWT.
function allowedOrigins(): string[] {
  return (process.env.CORS_ORIGINS ?? "*")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = allowedOrigins();
  const allow = allowed.includes("*")
    ? "*"
    : origin && allowed.includes(origin)
      ? origin
      : (allowed[0] ?? "*");
  const headers: Record<string, string> = {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
  };
  if (allow !== "*") {
    headers["Vary"] = "Origin";
    headers["Access-Control-Allow-Credentials"] = "true";
  }
  return headers;
}

export function middleware(req: NextRequest) {
  // Production next start logs nothing per request — this line is the API
  // activity feed in Render logs (method + path, no secrets/headers/bodies).
  console.log(`[api] ${req.method} ${req.nextUrl.pathname}`);
  const headers = corsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") {
    return new NextResponse(null, { status: 204, headers });
  }
  const res = NextResponse.next();
  for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
  return res;
}

export const config = { matcher: "/api/:path*" };

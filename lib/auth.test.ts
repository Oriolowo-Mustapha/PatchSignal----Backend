import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { memorySessionStore, memoryStore, memoryUserStore } from "@/lib/store";
import { authUser, SESSION_COOKIE_NAME } from "@/lib/auth";
import { POST as signup } from "@/app/api/auth/signup/route";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { GET as me } from "@/app/api/auth/me/route";
import { GET as listInvestigations, POST as createInvestigation } from "@/app/api/investigations/route";
import { GET as getInvestigationRoute } from "@/app/api/investigations/[id]/route";
import { POST as analyzeRoute } from "@/app/api/investigations/[id]/analyze/route";
import { GET as eventsRoute } from "@/app/api/investigations/[id]/events/route";
import { POST as inspectRoute } from "@/app/api/investigations/[id]/inspect/route";
import { POST as hypothesesRoute } from "@/app/api/investigations/[id]/hypotheses/route";
import { POST as runsRoute } from "@/app/api/investigations/[id]/runs/route";
import { GET as packageRoute } from "@/app/api/investigations/[id]/package/route";
import { GET as fileRoute } from "@/app/api/files/[attachmentId]/route";

function extractSessionCookie(res: Response): string {
  const raw = res.headers.get("set-cookie") ?? "";
  const match = raw.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`));
  return match ? `${SESSION_COOKIE_NAME}=${match[1]}` : "";
}

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  memoryUserStore.clear();
  memorySessionStore.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  memoryUserStore.clear();
  memorySessionStore.clear();
});

describe("in-memory auth, cookies, session revocation & authorization matrix", () => {
  it("supports signup -> HttpOnly cookie + Bearer -> logout session revocation", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const signupRes = await signup(
      new NextRequest("http://test/api/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "dev@example.com", password: "password123", name: "Dev" }),
      })
    );
    expect(signupRes.status).toBe(201);
    const setCookieHeader = signupRes.headers.get("set-cookie") ?? "";
    expect(setCookieHeader).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(setCookieHeader.toLowerCase()).toContain("httponly");
    const signupCookie = extractSessionCookie(signupRes);
    const signupJson = await signupRes.json();
    expect(signupJson.email).toBe("dev@example.com");
    expect(typeof signupJson.token).toBe("string");

    // Cookie-only authentication (no Authorization header)
    const meByCookie = await me(
      new Request("http://test/api/auth/me", {
        headers: { Cookie: signupCookie },
      })
    );
    expect(meByCookie.status).toBe(200);
    expect((await meByCookie.json()).email).toBe("dev@example.com");

    const dupRes = await signup(
      new NextRequest("http://test/api/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "dev@example.com", password: "password123" }),
      })
    );
    expect(dupRes.status).toBe(409);

    const tooLongRes = await signup(
      new NextRequest("http://test/api/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "long@example.com", password: "x".repeat(129) }),
      })
    );
    expect(tooLongRes.status).toBe(400);

    const badLogin = await login(
      new NextRequest("http://test/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "dev@example.com", password: "wrongpassword" }),
      })
    );
    expect(badLogin.status).toBe(401);

    const loginRes = await login(
      new NextRequest("http://test/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "dev@example.com", password: "password123" }),
      })
    );
    expect(loginRes.status).toBe(200);
    const loginCookie = extractSessionCookie(loginRes);
    const loginJson = await loginRes.json();
    expect(loginJson.passwordHash).toBeUndefined();
    expect(loginJson.lastLoginAt).toBeTruthy();

    const meRes = await me(
      new Request("http://test/api/auth/me", {
        headers: { Authorization: `Bearer ${loginJson.token}` },
      })
    );
    expect(meRes.status).toBe(200);
    expect((await meRes.json()).email).toBe("dev@example.com");

    const auth = await authUser(
      new Request("http://test/api/investigations", {
        headers: { Authorization: `Bearer ${loginJson.token}` },
      })
    );
    expect(auth).toEqual({ userId: signupJson.id });

    // Logout revokes the server-side session for both cookie and Bearer JWT
    const logoutRes = await logout(
      new Request("http://test/api/auth/logout", {
        method: "POST",
        headers: { Cookie: loginCookie },
      })
    );
    expect(logoutRes.status).toBe(200);
    expect(logoutRes.headers.get("set-cookie")).toContain("Max-Age=0");

    const afterLogoutCookie = await me(
      new Request("http://test/api/auth/me", {
        headers: { Cookie: loginCookie },
      })
    );
    expect(afterLogoutCookie.status).toBe(401);

    const afterLogoutBearer = await me(
      new Request("http://test/api/auth/me", {
        headers: { Authorization: `Bearer ${loginJson.token}` },
      })
    );
    expect(afterLogoutBearer.status).toBe(401);
  });

  it("enforces 401 across all protected routes and isolates investigations across users", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const invParams = { params: Promise.resolve({ id: "inv_owned_1" }) };
    const fileParams = { params: Promise.resolve({ attachmentId: "att_owned_1" }) };

    const unauthCalls = await Promise.all([
      me(new Request("http://test/api/auth/me")),
      listInvestigations(new NextRequest("http://test/api/investigations")),
      createInvestigation(new NextRequest("http://test/api/investigations", { method: "POST" })),
      getInvestigationRoute(new Request("http://test/api/investigations/inv_owned_1"), invParams),
      analyzeRoute(new Request("http://test/api/investigations/inv_owned_1/analyze", { method: "POST" }), invParams),
      eventsRoute(new Request("http://test/api/investigations/inv_owned_1/events"), invParams),
      inspectRoute(new Request("http://test/api/investigations/inv_owned_1/inspect", { method: "POST" }), invParams),
      hypothesesRoute(
        new NextRequest("http://test/api/investigations/inv_owned_1/hypotheses", { method: "POST" }),
        invParams
      ),
      runsRoute(new NextRequest("http://test/api/investigations/inv_owned_1/runs", { method: "POST" }), invParams),
      packageRoute(new Request("http://test/api/investigations/inv_owned_1/package"), invParams),
      fileRoute(new Request("http://test/api/files/att_owned_1"), fileParams),
    ]);

    for (const res of unauthCalls) {
      expect(res.status).toBe(401);
    }

    // Create two users and verify cross-user isolation
    const u1Res = await signup(
      new NextRequest("http://test/api/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "owner@example.com", password: "password123" }),
      })
    );
    const u1 = await u1Res.json();

    const u2Res = await signup(
      new NextRequest("http://test/api/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "other@example.com", password: "password123" }),
      })
    );
    const u2Cookie = extractSessionCookie(u2Res);

    memoryStore.create({
      id: "inv_owned_1",
      userId: u1.id,
      repoUrl: "https://github.com/patchsignal/demo-signup",
      owner: "patchsignal",
      repo: "demo-signup",
      description: "Owner only bug",
      stage: "intake",
      status: "pending",
      attachments: [
        {
          id: "att_owned_1",
          publicId: "att_owned_1",
          secureUrl: "https://cdn.example/a.png",
          mime: "image/png",
          sizeBytes: 123,
        },
      ],
      createdAt: new Date().toISOString(),
    });

    const otherList = await listInvestigations(
      new NextRequest("http://test/api/investigations", { headers: { Cookie: u2Cookie } })
    );
    expect(otherList.status).toBe(200);
    expect((await otherList.json()).investigations).toHaveLength(0);

    const crossUserCalls = await Promise.all([
      getInvestigationRoute(
        new Request("http://test/api/investigations/inv_owned_1", { headers: { Cookie: u2Cookie } }),
        invParams
      ),
      eventsRoute(
        new Request("http://test/api/investigations/inv_owned_1/events", { headers: { Cookie: u2Cookie } }),
        invParams
      ),
      inspectRoute(
        new Request("http://test/api/investigations/inv_owned_1/inspect", {
          method: "POST",
          headers: { Cookie: u2Cookie },
        }),
        invParams
      ),
      hypothesesRoute(
        new NextRequest("http://test/api/investigations/inv_owned_1/hypotheses", {
          method: "POST",
          headers: { Cookie: u2Cookie },
        }),
        invParams
      ),
      runsRoute(
        new NextRequest("http://test/api/investigations/inv_owned_1/runs", {
          method: "POST",
          headers: { Cookie: u2Cookie },
        }),
        invParams
      ),
      packageRoute(
        new Request("http://test/api/investigations/inv_owned_1/package", { headers: { Cookie: u2Cookie } }),
        invParams
      ),
      fileRoute(
        new Request("http://test/api/files/att_owned_1", { headers: { Cookie: u2Cookie } }),
        fileParams
      ),
    ]);

    for (const res of crossUserCalls) {
      expect(res.status).toBe(404);
    }
  });

  it("strictly returns 503 when NODE_ENV=production and DATABASE_URL is unset", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const signupRes = await signup(
      new NextRequest("http://test/api/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "prod@example.com", password: "password123" }),
      })
    );
    expect(signupRes.status).toBe(503);

    const loginRes = await login(
      new NextRequest("http://test/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "prod@example.com", password: "password123" }),
      })
    );
    expect(loginRes.status).toBe(503);

    const authRes = await authUser(
      new Request("http://test/api/investigations", {
        headers: { Authorization: "Bearer anything" },
      })
    );
    expect(authRes).toBeInstanceOf(Response);
    expect((authRes as Response).status).toBe(503);
  });
});

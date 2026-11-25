// In-memory fallback so API works before DATABASE_URL is filled.
// Once Prisma migrate runs, routes prefer Postgres. Memory store keeps
// local testing unblocked and is NOT used in prod.
export type StoredAttachment = {
  id?: string;
  publicId: string;
  secureUrl: string;
  mime: string;
  sizeBytes: number;
  width?: number | null;
  height?: number | null;
  geminiFileUri?: string | null;
};

export type StoredUser = {
  id: string;
  email: string;
  passwordHash: string;
  name: string | null;
  lastLoginAt?: string | null;
  createdAt: string;
};

export type StoredSession = {
  id: string;
  userId: string;
  tokenHash: string;
  userAgent: string | null;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
};

export type StoredInvestigation = {
  id: string;
  userId?: string | null;
  repoUrl: string;
  owner: string;
  repo: string;
  description: string;
  expected?: string;
  actual?: string;
  steps?: string;
  environment?: string;
  errorText?: string;
  analysisJob?: { id: string; status: string; error: string | null; updatedAt: Date | string };
  modelId?: string;
  commitSha?: string;
  controlSha?: string;
  stage: string;
  status: string;
  summary?: string;
  candidateAreas?: { path: string; provenance: string }[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  evidence?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inspection?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  hypothesis?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  runs?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  classification?: any;
  attachments: StoredAttachment[];
  createdAt: string;
};

const investigations: Map<string, StoredInvestigation> =
  ((globalThis as unknown as { __ps_store?: Map<string, StoredInvestigation> }).__ps_store ??=
    new Map<string, StoredInvestigation>());

const users: Map<string, StoredUser> =
  ((globalThis as unknown as { __ps_users?: Map<string, StoredUser> }).__ps_users ??=
    new Map<string, StoredUser>());

const sessions: Map<string, StoredSession> =
  ((globalThis as unknown as { __ps_sessions?: Map<string, StoredSession> }).__ps_sessions ??=
    new Map<string, StoredSession>());

export const memoryStore = {
  create(inv: StoredInvestigation) {
    investigations.set(inv.id, inv);
    return inv;
  },
  get(id: string) {
    return investigations.get(id) ?? null;
  },
  update(id: string, patch: Partial<StoredInvestigation>) {
    const cur = investigations.get(id);
    if (!cur) return null;
    const next = { ...cur, ...patch };
    investigations.set(id, next);
    return next;
  },
  list() {
    return Array.from(investigations.values());
  },
};

export const memoryUserStore = {
  create(user: StoredUser) {
    users.set(user.id, user);
    return user;
  },
  findByEmail(email: string) {
    for (const user of users.values()) {
      if (user.email === email) return user;
    }
    return null;
  },
  findById(id: string) {
    return users.get(id) ?? null;
  },
  touchLastLogin(id: string, at: string) {
    const u = users.get(id);
    if (u) users.set(id, { ...u, lastLoginAt: at });
  },
  clear() {
    users.clear();
  },
};

export const memorySessionStore = {
  create(session: StoredSession) {
    sessions.set(session.tokenHash, session);
    return session;
  },
  findByTokenHash(tokenHash: string) {
    return sessions.get(tokenHash) ?? null;
  },
  revokeByTokenHash(tokenHash: string, revokedAt: string) {
    const s = sessions.get(tokenHash);
    if (!s) return null;
    const next = { ...s, revokedAt };
    sessions.set(tokenHash, next);
    return next;
  },
  clear() {
    sessions.clear();
  },
};

export function useMemoryStore(): boolean {
  return !process.env.DATABASE_URL;
}

export function canUseMemoryAuth(): boolean {
  return useMemoryStore() && process.env.NODE_ENV !== "production";
}

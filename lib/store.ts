// In-memory fallback so API works before DATABASE_URL is filled.
// Once Prisma migrate runs, routes prefer Postgres. Memory store keeps
// local testing unblocked and is NOT used in prod.
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
  analysisJob?: {id:string;status:string;error:string|null;updatedAt:Date|string};
  modelId?: string;
  commitSha?: string;
  controlSha?: string;
  stage: string;
  status: string;
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
  attachments: { publicId: string; secureUrl: string; mime: string; sizeBytes: number }[];
  createdAt: string;
};

const investigations: Map<string, StoredInvestigation> =
  ((globalThis as unknown as { __ps_store?: Map<string, StoredInvestigation> }).__ps_store ??=
    new Map<string, StoredInvestigation>());

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

export function useMemoryStore(): boolean {
  return !process.env.DATABASE_URL;
}

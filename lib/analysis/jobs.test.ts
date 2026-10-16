import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import {memoryStore} from "@/lib/store";
import {enqueue,claim,complete,fail} from "./jobs";
import {recordEvidenceSchema} from "@/lib/evidence/schema";
import {cachedDemoEvidence} from "@/lib/gemma/client";
import {randomUUID} from "node:crypto";

beforeEach(()=>vi.stubEnv("DATABASE_URL",""));afterEach(()=>{vi.unstubAllEnvs();vi.useRealTimers();});
function create(){const id=randomUUID();memoryStore.create({id,userId:"user",repoUrl:"https://github.com/a/b",owner:"a",repo:"b",description:"Report",stage:"intake",status:"pending",attachments:[],createdAt:new Date().toISOString()});return id;}
const evidence=recordEvidenceSchema.parse(cachedDemoEvidence());
describe("analysis job lifecycle",()=>{
 it("deduplicates concurrent submissions and never leases the same job twice",async()=>{const id=create();const jobs=await Promise.all([enqueue(id),enqueue(id)]);expect(jobs[0].id).toBe(jobs[1].id);const job=await claim();expect(job?.investigationId).toBe(id);expect(await claim()).toBeNull();await complete(job!,evidence,"cached-demo",true);expect(memoryStore.get(id)?.stage).toBe("analyzed");expect(memoryStore.get(id)?.analysisJob?.status).toBe("completed");expect(memoryStore.get(id)?.modelId).toBe("cached-demo");});
 it("records failure without a verdict and retries only on explicit enqueue",async()=>{const id=create();await enqueue(id);const job=await claim();await fail(job!);expect(memoryStore.get(id)?.status).toBe("pending");expect(memoryStore.get(id)?.analysisJob?.status).toBe("failed");expect(await claim()).toBeNull();expect((await enqueue(id)).status).toBe("queued");const retry=await claim();await complete(retry!,evidence,"test-model",false);});
 it("reclaims an expired lease and rejects the stale worker completion",async()=>{vi.useFakeTimers();const id=create();await enqueue(id);const stale=await claim();await vi.advanceTimersByTimeAsync(121_000);const current=await claim();expect(current?.leaseToken).not.toBe(stale?.leaseToken);await complete(stale!,evidence,"stale-model",false);expect(memoryStore.get(id)?.stage).toBe("intake");await complete(current!,evidence,"current-model",false);expect(memoryStore.get(id)?.modelId).toBe("current-model");});
 it("marks repeatedly interrupted jobs failed instead of restarting forever",async()=>{vi.useFakeTimers();const id=create();await enqueue(id);for(let i=0;i<3;i++){expect(await claim()).not.toBeNull();await vi.advanceTimersByTimeAsync(121_000);}expect(await claim()).toBeNull();expect(memoryStore.get(id)?.analysisJob?.status).toBe("failed");});
 it("does not rewind an investigation which already advanced",async()=>{const id=create();await enqueue(id);const job=await claim();memoryStore.update(id,{stage:"inspected"});await complete(job!,evidence,"test-model",false);expect(memoryStore.get(id)?.stage).toBe("inspected");});
});

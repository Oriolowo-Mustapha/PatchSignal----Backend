import {beforeEach,expect,it,vi} from "vitest";
const db=vi.hoisted(()=>({analysisJob:{upsert:vi.fn(),updateMany:vi.fn(),findFirst:vi.fn(),findUniqueOrThrow:vi.fn()},$transaction:vi.fn()}));
vi.mock("@/lib/db/client",()=>({prisma:db}));
vi.mock("@/lib/store",()=>({useMemoryStore:()=>false,memoryStore:{}}));
import {claim,complete,enqueue} from "./jobs";
import {recordEvidenceSchema} from "@/lib/evidence/schema";
import {cachedDemoEvidence} from "@/lib/gemma/client";
beforeEach(()=>vi.clearAllMocks());
it("uses a compare-and-swap lease so racing database workers cannot both claim",async()=>{
 db.analysisJob.findFirst.mockResolvedValue({id:"j",investigationId:"i"});let winners=0;
 db.analysisJob.updateMany.mockImplementation(async args=>args.data.status==="failed"?{count:0}:{count:winners++===0?1:0});
 const claims=await Promise.all([claim(),claim()]);expect(claims.filter(Boolean)).toHaveLength(1);
 const changes=db.analysisJob.updateMany.mock.calls.filter(([args])=>args.data.status==="running");expect(changes[0][0].where.OR).toEqual(expect.arrayContaining([{status:"queued"}]));expect(changes[0][0].where.attempts.lt).toBe(3);expect(changes[0][0].data.leaseToken).toBeTruthy();
});
it("does not write evidence when a stale database lease lost ownership",async()=>{
 const tx={analysisJob:{updateMany:vi.fn().mockResolvedValue({count:0})},investigation:{findUnique:vi.fn()},evidenceItem:{createMany:vi.fn()}};
 db.$transaction.mockImplementation(async callback=>callback(tx));await complete({id:"j",investigationId:"i",leaseToken:"old"},recordEvidenceSchema.parse(cachedDemoEvidence()),"model",false);
 expect(tx.analysisJob.updateMany.mock.calls[0][0].where).toEqual({id:"j",status:"running",leaseToken:"old"});expect(tx.investigation.findUnique).not.toHaveBeenCalled();expect(tx.evidenceItem.createMany).not.toHaveBeenCalled();
});
it("requeues only a failed database job and does not reset an active lease",async()=>{
 db.analysisJob.upsert.mockResolvedValue({id:"j",status:"failed"});db.analysisJob.findUniqueOrThrow.mockResolvedValue({id:"j",status:"running"});await enqueue("i");expect(db.analysisJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({where:{id:"j",status:"failed"}}));
 db.analysisJob.updateMany.mockClear();db.analysisJob.upsert.mockResolvedValue({id:"j",status:"running"});await enqueue("i");expect(db.analysisJob.updateMany).not.toHaveBeenCalled();
});

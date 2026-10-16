import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/client";
import { memoryStore, useMemoryStore } from "@/lib/store";
import type { z } from "zod";
import type { recordEvidenceSchema } from "@/lib/evidence/schema";

export type Evidence = z.infer<typeof recordEvidenceSchema>;
export type JobView = { id:string; status:string; error:string|null; updatedAt:Date|string };
type Claim = {id:string;investigationId:string;leaseToken:string};
type MemoryJob = Claim & JobView & {attempts:number;leaseExpiresAt:number;createdAt:number};
const globalJobs=globalThis as typeof globalThis & {__ps_analysisJobs?:Map<string,MemoryJob>};
const jobs=globalJobs.__ps_analysisJobs ??= new Map();
export const jobSelection={id:true,status:true,error:true,updatedAt:true} as const;
export const jobView=(job:JobView):JobView=>({id:job.id,status:job.status,error:job.error,updatedAt:job.updatedAt});

export async function enqueue(investigationId:string):Promise<JobView> {
  if(useMemoryStore()) {
    let job=jobs.get(investigationId);
    if(!job) {job={id:randomUUID(),investigationId,status:"queued",error:null,attempts:0,leaseToken:"",leaseExpiresAt:0,createdAt:Date.now(),updatedAt:new Date()};jobs.set(investigationId,job);}
    else if(job.status==="failed") {Object.assign(job,{status:"queued",error:null,attempts:0,updatedAt:new Date()});}
    memoryStore.update(investigationId,{analysisJob:jobView(job)});
    return jobView(job);
  }
  const job=await prisma.analysisJob.upsert({where:{investigationId},create:{investigationId},update:{}});
  // An explicit retry can requeue a failed job. Concurrent retries collapse to
  // the same unique row and cannot reset an active lease.
  if(job.status==="failed") await prisma.analysisJob.updateMany({where:{id:job.id,status:"failed"},data:{status:"queued",error:null,attempts:0,leaseToken:null,leaseExpiresAt:null}});
  return (await prisma.analysisJob.findUniqueOrThrow({where:{id:job.id},select:jobSelection}));
}

export async function claim():Promise<Claim|null> {
  const now=new Date();const leaseToken=randomUUID();const leaseExpiresAt=new Date(now.getTime()+120_000);
  if(useMemoryStore()) {
    for(const job of jobs.values()) {
      if(job.status==="running" && job.leaseExpiresAt<=now.getTime() && job.attempts>=3) {Object.assign(job,{status:"failed",error:"Worker stopped repeatedly. Retry analysis explicitly.",updatedAt:now});memoryStore.update(job.investigationId,{analysisJob:jobView(job)});}
      if(job.attempts<3 && (job.status==="queued" || (job.status==="running" && job.leaseExpiresAt<=now.getTime()))) {
        Object.assign(job,{status:"running",attempts:job.attempts+1,leaseToken,leaseExpiresAt:leaseExpiresAt.getTime(),updatedAt:now});memoryStore.update(job.investigationId,{analysisJob:jobView(job)});return {id:job.id,investigationId:job.investigationId,leaseToken};
      }
    }
    return null;
  }
  await prisma.analysisJob.updateMany({where:{status:"running",leaseExpiresAt:{lte:now},attempts:{gte:3}},data:{status:"failed",error:"Worker stopped repeatedly. Retry analysis explicitly.",leaseToken:null,leaseExpiresAt:null}});
  const eligible={attempts:{lt:3},OR:[{status:"queued"},{status:"running",leaseExpiresAt:{lte:now}}]};
  const candidate=await prisma.analysisJob.findFirst({where:eligible,orderBy:{createdAt:"asc"}});
  if(!candidate)return null;
  const claimed=await prisma.analysisJob.updateMany({where:{id:candidate.id,...eligible},data:{status:"running",attempts:{increment:1},leaseToken,leaseExpiresAt}});
  return claimed.count===1 ? {id:candidate.id,investigationId:candidate.investigationId,leaseToken} : null;
}

export async function complete(job:Claim,evidence:Evidence,modelId:string,cached:boolean) {
  if(useMemoryStore()) {
    const current=jobs.get(job.investigationId);if(!current || current.leaseToken!==job.leaseToken || current.status!=="running")return;
    const inv=memoryStore.get(job.investigationId);
    Object.assign(current,{status:"completed",error:null,updatedAt:new Date()});
    memoryStore.update(job.investigationId,{...(inv?.stage==="intake" ? {evidence:{...evidence,_cached:cached},modelId,stage:"analyzed"}:{}),analysisJob:jobView(current)});return;
  }
  await prisma.$transaction(async tx=>{
    const ownership=await tx.analysisJob.updateMany({where:{id:job.id,status:"running",leaseToken:job.leaseToken},data:{status:"completed",error:null,leaseToken:null,leaseExpiresAt:null}});
    if(!ownership.count)return;
    const inv=await tx.investigation.findUnique({where:{id:job.investigationId}});
    if(!inv || inv.stage!=="intake")return;
    await tx.evidenceItem.deleteMany({where:{investigationId:job.investigationId}});
    await tx.question.deleteMany({where:{investigationId:job.investigationId}});
    await tx.evidenceItem.createMany({data:evidence.evidence.map(e=>({investigationId:job.investigationId,...e}))});
    if(evidence.unknowns.length)await tx.question.createMany({data:evidence.unknowns.map(q=>({investigationId:job.investigationId,text:q.question,blocking:q.blocking}))});
    await tx.investigation.update({where:{id:job.investigationId},data:{stage:"analyzed",modelId,status:"pending"}});
  });
}
export async function fail(job:Claim) {
  // Do not expose provider exception strings, URLs or credentials through GET.
  const error="Analysis failed while processing or saving evidence. Check the backend model service and database, then retry explicitly.";
  if(useMemoryStore()) {const current=jobs.get(job.investigationId);if(current?.leaseToken===job.leaseToken && current.status==="running") {Object.assign(current,{status:"failed",error,updatedAt:new Date()});memoryStore.update(job.investigationId,{analysisJob:jobView(current)});}return;}
  await prisma.analysisJob.updateMany({where:{id:job.id,status:"running",leaseToken:job.leaseToken},data:{status:"failed",error,leaseToken:null,leaseExpiresAt:null}});
}

import { config } from "@/lib/config";
import { getInvestigation } from "@/lib/investigations";
import { cachedDemoEvidence, extractEvidence } from "@/lib/gemma/client";
import { recordEvidenceSchema } from "@/lib/evidence/schema";
import { claim, complete, fail } from "./jobs";

export async function runOne() {
  const job=await claim();if(!job)return false;
  try {
    const inv=await getInvestigation(job.investigationId);
    if(!inv)throw new Error("Investigation removed");
    const hasKey=config.modelProvider === "groq" ? !!config.groqApiKey : !!config.geminiApiKey;
    const imageUrls=inv.attachments.map(file=>file.secureUrl).filter(url=>url.startsWith("https://")).slice(0,3);
    const result=hasKey ? await extractEvidence({description:inv.description,fields:{expected:inv.expected??"",actual:inv.actual??"",steps:inv.steps??"",environment:inv.environment??"",error:inv.errorText??""},imageParts:[],imageUrls}) : {evidence:cachedDemoEvidence(),modelId:"cached-demo"};
    await complete(job,recordEvidenceSchema.parse(result.evidence),result.modelId,!hasKey);
  } catch {await fail(job);}
  return true;
}
// This worker runs in the long-lived Render Node service. The queue and leases
// are persisted in Postgres; startup resumes queued/expired work after a crash.
// Do not host this timer worker in an ephemeral/serverless process.
const registry=globalThis as typeof globalThis & {__ps_workerStarted?:boolean};
export function startAnalysisWorker() {
  if(registry.__ps_workerStarted || process.env.NEXT_PHASE==="phase-production-build")return;
  registry.__ps_workerStarted=true;
  async function tick() {
    try {await runOne();} catch {console.error("Analysis queue unavailable; retrying on next poll.");}
    setTimeout(()=>void tick(),2000).unref();
  }
  setTimeout(()=>void tick(),0).unref();
}

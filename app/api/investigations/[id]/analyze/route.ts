import { NextResponse } from "next/server";
import { getInvestigation } from "@/lib/investigations";
import { authUser, owns } from "@/lib/auth";
import { enqueue } from "@/lib/analysis/jobs";
import { startAnalysisWorker } from "@/lib/analysis/worker";

export const runtime="nodejs";
export async function POST(req:Request,{params}:{params:Promise<{id:string}>}) {
  const auth=await authUser(req);if(auth instanceof NextResponse)return auth;
  const {id}=await params;const inv=await getInvestigation(id);
  if(!inv || !owns(inv,auth.userId))return NextResponse.json({error:"not found"},{status:404});
  if(inv.stage!=="intake")return NextResponse.json({id,status:"completed"});
  try {
    const analysisJob=await enqueue(id);
    startAnalysisWorker();
    return NextResponse.json({id,analysisJob},{status:analysisJob.status==="completed"?200:202,headers:{"Cache-Control":"no-store","Retry-After":"5"}});
  } catch {
    return NextResponse.json({error:"Analysis queue unavailable. Apply database migrations and check backend database connectivity."},{status:503});
  }
}

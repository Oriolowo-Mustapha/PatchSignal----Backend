import {beforeEach,expect,it,vi} from "vitest";
import {randomUUID} from "node:crypto";
const mocks=vi.hoisted(()=>({extract:vi.fn()}));
vi.mock("@/lib/config",()=>({config:{geminiApiKey:"",modelProvider:"groq",groqApiKey:"test-groq"}}));
vi.mock("@/lib/auth",()=>({authUser:async()=>({userId:"u"}),owns:(inv:{userId:string},user:string)=>inv?.userId===user}));
vi.mock("@/lib/gemma/client",async importOriginal=>({...await importOriginal<typeof import("@/lib/gemma/client")>(),extractEvidence:mocks.extract}));
vi.mock("./worker",async importOriginal=>({...await importOriginal<typeof import("./worker")>(),startAnalysisWorker:vi.fn()}));
import {memoryStore} from "@/lib/store";
import {POST} from "@/app/api/investigations/[id]/analyze/route";
import {GET} from "@/app/api/investigations/[id]/route";
import {runOne} from "./worker";
import {cachedDemoEvidence} from "@/lib/gemma/client";
beforeEach(()=>{vi.stubEnv("DATABASE_URL","");vi.clearAllMocks();});
function investigation(){const id=randomUUID();memoryStore.create({id,userId:"u",repoUrl:"https://github.com/a/b",owner:"a",repo:"b",description:"Report",stage:"intake",status:"pending",attachments:[{publicId:"test",secureUrl:"https://images.example.invalid/test.png",mime:"image/png",sizeBytes:1}],createdAt:new Date().toISOString()});return {id,params:{params:Promise.resolve({id})}};}
it("returns 202 before generation, then exposes saved completion through the real read handler",async()=>{
 const {id,params}=investigation();let finish!:(value:{evidence:ReturnType<typeof cachedDemoEvidence>;modelId:string})=>void;mocks.extract.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 const response=await POST(new Request("http://test/analyze",{method:"POST"}),params);expect(response.status).toBe(202);expect(mocks.extract).not.toHaveBeenCalled();const active=runOne();
 while(!finish)await Promise.resolve();const running=await(await GET(new Request("http://test"),params)).json();expect(running.analysisJob.status).toBe("running");
 finish({evidence:cachedDemoEvidence(),modelId:"test-model"});await active;
 const completed=await(await GET(new Request("http://test"),params)).json();expect(completed.stage).toBe("analyzed");expect(completed.analysisJob.status).toBe("completed");expect(mocks.extract).toHaveBeenCalledWith(expect.objectContaining({imageUrls:["https://images.example.invalid/test.png"]}));expect(completed.evidence.evidence.length).toBeGreaterThan(0);expect(completed.status).toBe("pending");expect(completed.analysisJob.leaseToken).toBeUndefined();expect(completed.id).toBe(id);
});
it("persists a safe failure without fabricating evidence or a verdict",async()=>{
 const {params}=investigation();mocks.extract.mockRejectedValue(new Error("private-provider-details"));expect((await POST(new Request("http://test"),params)).status).toBe(202);await runOne();const data=await(await GET(new Request("http://test"),params)).json();expect(data.analysisJob.status).toBe("failed");expect(data.analysisJob.error).not.toContain("private-provider-details");expect(data.status).toBe("pending");expect(data.stage).toBe("intake");expect(data.evidence).toBeUndefined();
});

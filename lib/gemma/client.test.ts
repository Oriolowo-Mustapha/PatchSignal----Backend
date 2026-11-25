import {afterEach,it,expect,vi} from "vitest";
import {recordEvidenceSchema} from "@/lib/evidence/schema";
const mocks=vi.hoisted(()=>({generate:vi.fn()}));
vi.mock("@google/genai",()=>({GoogleGenAI:class{models={generateContent:mocks.generate};}}));
import {extractEvidence} from "./client";
afterEach(()=>{vi.useRealTimers();vi.clearAllMocks();});
it("limits extraction to two timed attempts and aborts both hung calls",async()=>{vi.useFakeTimers();const signals:AbortSignal[]=[];mocks.generate.mockImplementation((args)=>{signals.push(args.config.abortSignal);return new Promise(()=>{});});const request=extractEvidence({description:"Report",fields:{},imageParts:[]});const failure=expect(request).rejects.toThrow("failed after 2 attempts");await vi.advanceTimersByTimeAsync(51_000);await failure;expect(mocks.generate).toHaveBeenCalledTimes(2);expect(signals.every(s=>s.aborted)).toBe(true);});
it("normalizes omitted candidateAreas provenance to hypothesis",()=>{const parsed=recordEvidenceSchema.parse({summary:"Startup validation failed",expected:{text:"App boots cleanly",provenance:"reported",source:"field:expected"},actual:{text:"Crash on startup",provenance:"reported",source:"field:actual"},evidence:[{text:"ConfigurationValidator throws InvalidOperationException",provenance:"reported",source:"description"}],unknowns:[],candidateAreas:[{path:"src/Config.cs"}]});expect(parsed.candidateAreas).toEqual([{path:"src/Config.cs",provenance:"hypothesis"}]);});

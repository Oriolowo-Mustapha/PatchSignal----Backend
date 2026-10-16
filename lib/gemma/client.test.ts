import {afterEach,it,expect,vi} from "vitest";
const mocks=vi.hoisted(()=>({generate:vi.fn()}));
vi.mock("@google/genai",()=>({GoogleGenAI:class{models={generateContent:mocks.generate};}}));
import {extractEvidence} from "./client";
afterEach(()=>{vi.useRealTimers();vi.clearAllMocks();});
it("limits extraction to two timed attempts and aborts both hung calls",async()=>{vi.useFakeTimers();const signals:AbortSignal[]=[];mocks.generate.mockImplementation((args)=>{signals.push(args.config.abortSignal);return new Promise(()=>{});});const request=extractEvidence({description:"Report",fields:{},imageParts:[]});const failure=expect(request).rejects.toThrow("failed after 2 attempts");await vi.advanceTimersByTimeAsync(51_000);await failure;expect(mocks.generate).toHaveBeenCalledTimes(2);expect(signals.every(s=>s.aborted)).toBe(true);});

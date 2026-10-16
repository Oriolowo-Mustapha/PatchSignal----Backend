import {afterEach,it,expect,vi} from "vitest";
import {withDeadline} from "./deadline";
afterEach(()=>vi.useRealTimers());
it("aborts and rejects a hung provider even when it ignores cancellation",async()=>{vi.useFakeTimers();let signal:AbortSignal|undefined;const request=withDeadline(s=>{signal=s;return new Promise(()=>{});},25_000);const error=expect(request).rejects.toThrow("deadline exceeded");await vi.advanceTimersByTimeAsync(25_000);await error;expect(signal?.aborted).toBe(true);expect(vi.getTimerCount()).toBe(0);});
it("cleans up its timer after a successful response",async()=>{vi.useFakeTimers();expect(await withDeadline(async()=>"result",25_000)).toBe("result");expect(vi.getTimerCount()).toBe(0);});

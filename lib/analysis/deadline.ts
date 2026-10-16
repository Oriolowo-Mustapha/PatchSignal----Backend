/** Bound even a provider that ignores cancellation; still abort its transport. */
export async function withDeadline<T>(operation:(signal:AbortSignal)=>Promise<T>,ms:number):Promise<T> {
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(()=>operation(controller.signal)),
      new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error("Model request deadline exceeded"));},ms);}),
    ]);
  } finally {clearTimeout(timer);}
}

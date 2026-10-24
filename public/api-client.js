// Runtime discovery is bounded and only runs at startup, explicit reconnect, or failure.
export function createApiClient({fetcher=globalThis.fetch.bind(globalThis),getToken=()=>'',fallbackConfigUrl='',timeoutMs=15000,configTimeoutMs=4000}={}){
 let base='',configured=false,sourcePriority=0,refreshing=null;
 async function fetchJson(url,options={},timeout=timeoutMs){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
  try{
   const response=await fetcher(url,{...options,signal:controller.signal});
   let data;try{data=await response.json()}catch{const error=Error('服务响应格式异常，请稍后重试。');error.connectionFailure=true;throw error;}
   if(!response.ok){const error=Error(data.error||`服务请求失败（${response.status}）`);error.connectionFailure=response.status>=500;throw error;}
   return data;
  }catch(error){if(error.name==='AbortError'||error instanceof TypeError)error.connectionFailure=true;throw error;}finally{clearTimeout(timer);}
 }
 function readBase(data){if(typeof data?.apiBase!=='string')throw Error('连接配置格式无效');const value=data.apiBase.replace(/\/$/,'');if(value&&!/^https?:\/\//.test(value))throw Error('连接地址格式无效');return value;}
 async function refresh(){
  if(refreshing)return refreshing;
  refreshing=(async()=>{
   const page=fetchJson('data/runtime.json?t='+Date.now(),{cache:'no-store'},configTimeoutMs).then(data=>({base:readBase(data),priority:1}));
   const jobs=[page];
   if(fallbackConfigUrl)jobs.push(fetchJson(fallbackConfigUrl,{cache:'no-store',headers:{Accept:'application/json'}},configTimeoutMs).then(data=>{if(data.content)data=JSON.parse(atob(data.content.replace(/\n/g,'')));return {base:readBase(data),priority:2};}));
   const results=await Promise.allSettled(jobs),valid=results.filter(r=>r.status==='fulfilled').map(r=>r.value).sort((a,b)=>b.priority-a.priority);
   if(!valid.length)throw Error('无法刷新连接配置，请检查网络后重试。');
   // An explicitly configured fallback remains preferred over a stale primary file.
   if(valid[0].priority>=sourcePriority){base=valid[0].base;sourcePriority=valid[0].priority;configured=true;}
   return base;
  })();
  try{return await refreshing}finally{refreshing=null;}
 }
 async function request(path,options={}){
  if(!configured)await refresh();
  const method=(options.method||'GET').toUpperCase();
  const idempotent=['GET','HEAD','PUT','DELETE','OPTIONS'].includes(method)||(method==='POST'&&path==='/api/complete');
  const attempt=()=>fetchJson(base+path,{...options,headers:{'Content-Type':'application/json',...(getToken()?{Authorization:'Bearer '+getToken()}:{}),...options.headers}});
  try{return await attempt()}catch(error){
   if(!error.connectionFailure)throw error;
   let configError;try{await refresh()}catch(e){configError=e;}
   if(!configError&&idempotent){try{return await attempt()}catch(retryError){throw friendly(retryError);}}
   const message=friendly(error).message+(configError?' '+configError.message:'');
   // Creating a participant is deliberately not retried after an uncertain response.
   throw Error(message);
  }
 }
 function friendly(error){if(error.name==='AbortError')return Error('连接超时，请检查网络后重试。');if(error instanceof TypeError)return Error('暂时无法连接保存服务，请稍后重试。');return error;}
 return {refresh,request,getBase:()=>base};
}

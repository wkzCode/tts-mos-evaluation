import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createApiClient} from '../public/api-client.js';
const response=(data,status=200)=>({ok:status>=200&&status<300,status,json:async()=>data});
const github=url=>url.startsWith('https://api.github.com/');
const page=url=>url.startsWith('data/runtime.json');
test('latest GitHub runtime wins at startup and cannot regress to stale Pages on reconnect',async()=>{
 let remote=true,calls=0;
 const client=createApiClient({remoteConfig:true,fetcher:async url=>{calls++;if(page(url))return response({apiBase:'https://stale.example'});if(github(url)){if(!remote)throw new TypeError('offline');return response({apiBase:'https://new.example'});}assert.equal(url,'https://new.example/api/session');return response({ok:true});}});
 await client.refresh();assert.equal(client.getBase(),'https://new.example');remote=false;await client.refresh();assert.equal(client.getBase(),'https://new.example');const before=calls;assert.equal((await client.request('/api/session')).ok,true);assert.equal(calls,before+1);
});
test('GET and PUT await changed runtime and retry once after network failure',async()=>{
 for(const method of ['GET','PUT']){
  let address='https://old.example',attempts=[];
  const client=createApiClient({fetcher:async(url,options)=>{if(page(url))return response({apiBase:address});attempts.push([url,options.method||'GET']);if(url.startsWith('https://old.example')){address='https://new.example';throw new TypeError('Failed to fetch');}return response({saved:true});}});
  await client.refresh();assert.equal((await client.request('/api/ratings',{method})).saved,true);assert.deepEqual(attempts.map(x=>x[0]),['https://old.example/api/ratings','https://new.example/api/ratings']);
 }
});
test('session creation is not automatically duplicated and retains refreshed address for explicit retry',async()=>{
 let address='https://old.example',attempts=0;
 const client=createApiClient({fetcher:async url=>{if(page(url))return response({apiBase:address});attempts++;if(url.startsWith('https://old.example')){address='https://new.example';throw new TypeError('Failed to fetch');}return response({id:'new-session'});}});
 await client.refresh();await assert.rejects(client.request('/api/sessions',{method:'POST'}),/无法连接/);assert.equal(attempts,1);assert.equal(client.getBase(),'https://new.example');assert.equal((await client.request('/api/sessions',{method:'POST'})).id,'new-session');assert.equal(attempts,2);
});
test('validation errors are preserved and do not trigger discovery',async()=>{
 let configCalls=0;
 const client=createApiClient({fetcher:async url=>{if(page(url)){configCalls++;return response({apiBase:''});}return response({error:'请完整听完音频后评分'},400);}});
 await client.refresh();await assert.rejects(client.request('/api/ratings',{method:'PUT'}),/请完整听完/);assert.equal(configCalls,1);
});
test('bounded GitHub timeout falls back to Pages and startup failure remains visible',async()=>{
 const client=createApiClient({remoteConfig:true,configTimeoutMs:15,fetcher:async(url,options)=>{if(page(url))return response({apiBase:'https://page.example'});return await new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(Object.assign(Error('timeout'),{name:'AbortError'}))));}});
 await client.refresh();assert.equal(client.getBase(),'https://page.example');
 const failed=createApiClient({fetcher:async()=>{throw new TypeError('offline')}});await assert.rejects(failed.refresh(),/无法刷新连接配置/);
});
test('second network failure is surfaced after exactly one retry',async()=>{
 let requests=0;
 const client=createApiClient({fetcher:async url=>{if(page(url))return response({apiBase:''});requests++;throw new TypeError('offline');}});
 await client.refresh();await assert.rejects(client.request('/api/session'),/无法连接/);assert.equal(requests,2);
});
test('proxy HTML error triggers config refresh and explicit completion is safely retried',async()=>{
 let address='https://old.example',requests=0;
 const client=createApiClient({fetcher:async url=>{if(page(url))return response({apiBase:address});requests++;if(requests===1){address='https://new.example';return {ok:false,status:502,json:async()=>{throw Error('HTML')}};}return response({completed:true});}});
 await client.refresh();assert.equal((await client.request('/api/complete',{method:'POST'})).completed,true);assert.equal(requests,2);
});

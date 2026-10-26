import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
function harness(){
 const nodes=new Map(),blobs=[],writes=[],calls=[];let respond=async()=>({id:'new-id',token:'new-token',order:Array.from({length:80},(_,i)=>'s'+i),study_id:'gender-study'});
 function element(){return {innerHTML:'',textContent:'',value:'',disabled:false,dataset:{},classList:{add(){},remove(){},toggle(){}},setAttribute(){},append(){},after(){},remove(){},click(){},scrollIntoView(){}};}
 const scores=Array.from({length:5},(_,i)=>({...element(),dataset:{score:String(i+1)}}));
 const document={baseURI:'http://localhost/study/',querySelector(selector){if(!nodes.has(selector))nodes.set(selector,element());return nodes.get(selector);},querySelectorAll(){return scores;},createElement:element};
 class TestURL extends URL{static createObjectURL(blob){blobs.push(blob);return 'blob:test'}static revokeObjectURL(){}}
 class Audio{constructor(){this.duration=2;this.currentTime=0;this.paused=true;}addEventListener(){}pause(){}removeAttribute(){}load(){}}
 const context=vm.createContext({document,Audio,URL:TestURL,Blob,console,setTimeout:fn=>fn(),window:{addEventListener(){}},localStorage:{getItem(){return null},setItem(k,v){writes.push(JSON.parse(v))}},createApiClient:()=>({request:async(path,options)=>{calls.push({path,options});return await respond(path,options)},refresh:async()=>{}})});
 const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8').replace(/^import .*\n/,'').replace(/;init\(\);\s*$/,';');vm.runInContext(source,context);
 vm.runInContext(`study={study_id:'gender-study',materials_status:'ready',samples:Array.from({length:80},(_,i)=>({id:'s'+i,text:'测试',audio:'audio/s'+i+'.wav'})),practice:[{id:'p1',text:'练习一',audio:'audio/p1.wav'},{id:'p2',text:'练习二',audio:'audio/p2.wav'}]};materialState={ready:true};KEY='isolated-test';welcome();`,context);
 return {context,document,blobs,writes,calls,respond(fn){respond=fn},run:code=>vm.runInContext(code,context)};
}
test('registration requires explicit gender and sends/persists it; personal CSV/JSON include gender',async()=>{
 const h=harness();for(const [id,value] of Object.entries({name:'测试姓名',role:'学生',organization:'测试单位',gender:''}))h.document.querySelector('#'+id).value=value;
 await h.document.querySelector('#start-form').onsubmit({preventDefault(){}});assert.equal(h.calls.length,0);assert.match(h.document.querySelector('#error').textContent,/请选择性别/);
 h.document.querySelector('#gender').value='女';await h.document.querySelector('#start-form').onsubmit({preventDefault(){}});
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].path,'/api/sessions');assert.equal(JSON.parse(h.calls[0].options.body).gender,'女');assert.equal(h.writes.at(-1).identity.gender,'女');
 h.run(`state.ratings={s0:{sample_id:'s0',score:4,synced:true}};backup('json');backup('csv');`);
 const json=JSON.parse(await h.blobs[0].text());assert.equal(json.identity.gender,'女');const csv=(await h.blobs[1].text()).replace(/^\uFEFF/,'').split('\r\n');const header=csv[0].split(',').map(s=>s.slice(1,-1)),row=csv[1].split(',').map(s=>s.slice(1,-1));assert.equal(row[header.indexOf('gender')],'女');assert.equal(row[header.indexOf('name')],'测试姓名');assert.equal(row[header.indexOf('score')],'4');
 h.run(`delete state.identity.gender;backup('json');backup('csv');`);assert.equal(JSON.parse(await h.blobs[2].text()).identity.gender,'');const oldRow=(await h.blobs[3].text()).split('\r\n')[1].split(',').map(s=>s.slice(1,-1));assert.equal(oldRow[header.indexOf('gender')],'');
});
test('existing local sessions recover authoritative gender without losing token or ratings',async()=>{
 const h=harness();h.run(`state={id:'old-id',token:'old-token',study_id:'gender-study',identity:{name:'旧缓存姓名',role:'学生'},ratings:{s0:{sample_id:'s0',score:3,synced:true}},practiceDone:true,index:0};`);
 h.respond(async()=>({id:'old-id',study_id:'gender-study',identity:{name:'旧服务器姓名',gender:'男',role:'学生',organization:''},order:Array.from({length:80},(_,i)=>'s'+i),completed_at:null,ratings:[{sample_id:'s0',score:3,listened_seconds:2,duration_seconds:2,ended:1}]}));
 await h.run('restore()');assert.equal(h.run('state.identity.gender'),'男');assert.equal(h.run('state.identity.name'),'旧服务器姓名');assert.equal(h.run('state.token'),'old-token');assert.equal(h.run('state.ratings.s0.score'),3);assert.equal(h.writes.at(-1).identity.gender,'男');
 h.run('delete state.identity.gender;');h.respond(async()=>({id:'old-id',study_id:'gender-study',order:Array.from({length:80},(_,i)=>'s'+i),completed_at:null,ratings:[]}));await h.run('restore()');assert.equal(h.run('state.identity.gender'),'');assert.equal(h.run('state.token'),'old-token');assert.equal(h.run('state.ratings.s0.score'),3);
});

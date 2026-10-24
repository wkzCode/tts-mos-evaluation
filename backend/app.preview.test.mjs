import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
test('pending preview plays and scores both practices without session creation, persistence, or formal progression',async()=>{
 const nodes=new Map();let apiCalls=0,storageWrites=0;
 function element(){return {innerHTML:'',textContent:'',disabled:false,dataset:{},classList:{add(){},remove(){},toggle(){}},setAttribute(){},append(){},after(){},remove(){},scrollIntoView(){}};}
 const root=element();nodes.set('#app',root);
 const scores=Array.from({length:5},(_,i)=>({...element(),dataset:{score:String(i+1)}}));
 const document={baseURI:'https://wkzcode.github.io/tts-mos-evaluation/',querySelector(selector){if(!nodes.has(selector))nodes.set(selector,element());return nodes.get(selector);},querySelectorAll(){return scores;},createElement:element};
 const audios=[];
 class Audio{constructor(){this.events={};this.duration=2;this.currentTime=0;this.paused=true;audios.push(this);}addEventListener(n,cb){this.events[n]=cb;}pause(){}removeAttribute(){}load(){}async play(){this.paused=false;this.events.play?.();}}
 const context=vm.createContext({document,Audio,URL,console,location:{hostname:'wkzcode.github.io'},window:{addEventListener(){}},localStorage:{getItem(){return null;},setItem(){storageWrites++;}},createApiClient:()=>({request:async()=>{apiCalls++;},refresh:async()=>{}})});
 let source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8').replace(/^import .*\n/,'').replace(/;init\(\);\s*$/,';');
 vm.runInContext(source,context);
 vm.runInContext(`study={study_id:'pending-test',materials_status:'pending',samples:[],practice:[{id:'p1',text:'练习一',audio:'audio/p1.wav'},{id:'p2',text:'练习二',audio:'audio/p2.wav'}]};materialState={ready:false,expected:80,available:20};welcome();`,context);
 assert.match(root.innerHTML,/正式音频准备中，暂未开放评分/);assert.match(root.innerHTML,/id="start" type="submit" disabled/);
 document.querySelector('#preview').onclick();assert.match(root.innerHTML,/流程预览，不计入正式数据/);assert.match(root.innerHTML,/data-score="1"[^>]*disabled/);
 for(let i=0;i<2;i++){const audio=audios.at(-1);audio.events.ended();scores[3].onclick();await document.querySelector('#next').onclick();}
 assert.match(root.innerHTML,/试听与评分练习/);assert.equal(apiCalls,0);assert.equal(storageWrites,0);assert.equal(vm.runInContext('state',context),null);assert.equal(vm.runInContext('mode',context),'welcome');
 vm.runInContext("study.materials_status='ready';materialState=null;connectionError='offline';welcome();",context);assert.match(root.innerHTML,/暂时无法确认评分服务连接/);assert.match(root.innerHTML,/id="start" type="submit" disabled/);assert.doesNotMatch(root.innerHTML,/正式测评已开放/);
});

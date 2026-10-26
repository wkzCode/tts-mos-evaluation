import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {DatabaseSync} from 'node:sqlite';

test('legacy session/ratings survive idempotent gender migration and new/old clients export correctly',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'tts-gender-')),pub=path.join(root,'public'),data=path.join(root,'private'),port=18889,base=`http://127.0.0.1:${port}`;
 fs.mkdirSync(path.join(pub,'data'),{recursive:true});fs.mkdirSync(path.join(pub,'audio'));fs.mkdirSync(data);
 const samples=Array.from({length:80},(_,i)=>({id:`s${i}`,text_id:`t${Math.floor(i/4)}`,text:'测试',audio:`audio/s${i}.fixture`,duration_seconds:2}));
 const practice=[{id:'p1',audio:'audio/p1.fixture'},{id:'p2',audio:'audio/p2.fixture'}];
 // Existence markers only; no study audio is produced by this regression test.
 for(const sample of [...samples,...practice])fs.writeFileSync(path.join(pub,sample.audio),'test marker');
 fs.writeFileSync(path.join(pub,'data/study.json'),JSON.stringify({study_id:'legacy-study',materials_status:'ready',samples,practice}));
 const filename=path.join(data,'responses.sqlite'),legacyToken='legacy-session-token',created='2026-01-01T00:00:00.000Z';
 const seed=new DatabaseSync(filename);
 seed.exec(`CREATE TABLE sessions(id TEXT PRIMARY KEY,token TEXT UNIQUE NOT NULL,study_id TEXT NOT NULL,role TEXT NOT NULL,name TEXT NOT NULL,organization TEXT NOT NULL,created_at TEXT NOT NULL,completed_at TEXT,order_json TEXT NOT NULL);
 CREATE TABLE ratings(session_id TEXT NOT NULL REFERENCES sessions(id),sample_id TEXT NOT NULL,score INTEGER NOT NULL CHECK(score BETWEEN 1 AND 5),listened_seconds REAL NOT NULL,duration_seconds REAL NOT NULL,ended INTEGER NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(session_id,sample_id));`);
 seed.prepare('INSERT INTO sessions VALUES(?,?,?,?,?,?,?,?,?)').run('legacy-id',legacyToken,'legacy-study','学生','旧姓名','旧单位',created,null,JSON.stringify(samples.map(s=>s.id)));
 seed.prepare('INSERT INTO ratings VALUES(?,?,?,?,?,?,?)').run('legacy-id','s0',2,2,2,1,created);seed.close();
 let server;
 async function start(){server=spawn(process.execPath,[new URL('./server.mjs',import.meta.url).pathname],{env:{...process.env,PORT:String(port),HOST:'127.0.0.1',TTS_MOS_DATA_DIR:data,TTS_MOS_PUBLIC_DIR:pub},stdio:['ignore','pipe','pipe']});await once(server.stdout,'data');}
 async function stop(){if(server){const exited=once(server,'exit');server.kill();await exited;server=null;}}
 async function call(p,method='GET',body,token=legacyToken){const r=await fetch(base+p,{method,headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},...(body===undefined?{}:{body:JSON.stringify(body)})});const text=await r.text();let result;try{result=JSON.parse(text)}catch{result=text}return {status:r.status,data:result,text};}
 try{
  await start();
  const legacy=await call('/api/session');assert.equal(legacy.status,200);assert.deepEqual(legacy.data.identity,{name:'旧姓名',gender:'',role:'学生',organization:'旧单位'});assert.equal(legacy.data.id,'legacy-id');assert.deepEqual(legacy.data.order,samples.map(s=>s.id));assert.deepEqual(legacy.data.ratings,[{sample_id:'s0',score:2,listened_seconds:2,duration_seconds:2,ended:1,updated_at:created}]);
  let inspect=new DatabaseSync(filename,{readOnly:true});let row=inspect.prepare('SELECT * FROM sessions WHERE id=?').get('legacy-id');assert.equal(row.token,legacyToken);assert.equal(row.created_at,created);assert.equal(row.completed_at,null);assert.equal(row.gender,'');assert.equal(inspect.prepare('PRAGMA table_info(sessions)').all().filter(c=>c.name==='gender').length,1);inspect.close();
  assert.equal((await call('/api/ratings','PUT',{sample_id:'s0',score:4,listened_seconds:2,duration_seconds:2,ended:true})).status,200);
  await stop();await start();
  const restored=await call('/api/session');assert.equal(restored.status,200);assert.equal(restored.data.ratings.length,1);assert.equal(restored.data.ratings[0].score,4);assert.equal(restored.data.identity.gender,'');
  inspect=new DatabaseSync(filename,{readOnly:true});assert.equal(inspect.prepare('PRAGMA table_info(sessions)').all().filter(c=>c.name==='gender').length,1);assert.equal(inspect.prepare('SELECT token FROM sessions WHERE id=?').get('legacy-id').token,legacyToken);inspect.close();
  const baseIdentity={name:'新测试姓名',role:'教师',organization:'测试单位',device_confirmed:true},accepted=[];
  for(const gender of ['男','女']){const response=await call('/api/sessions','POST',{...baseIdentity,gender},'');assert.equal(response.status,201);const roundtrip=await call('/api/session','GET',undefined,response.data.token);assert.equal(roundtrip.data.identity.gender,gender);accepted.push({id:response.data.id,gender,token:response.data.token});}
  for(const payload of [{...baseIdentity},{...baseIdentity,gender:''},{...baseIdentity,gender:'   '}]){const response=await call('/api/sessions','POST',payload,'');assert.equal(response.status,201);assert.equal((await call('/api/session','GET',undefined,response.data.token)).data.identity.gender,'');accepted.push({id:response.data.id,gender:'',token:response.data.token});}
  for(const gender of ['其他','不愿透露','未知','男性',null,0,false,{},[]])assert.equal((await call('/api/sessions','POST',{...baseIdentity,gender},'')).status,400);
  const admin=fs.readFileSync(path.join(data,'admin-token.txt'),'utf8').trim();const exported=await call('/api/admin/export','GET',undefined,admin);assert.equal(exported.status,200);
  const csvRows=exported.text.replace(/^\uFEFF/,'').split('\r\n').map(line=>line.split(',').map(cell=>cell.slice(1,-1).replaceAll('""','"')));const header=csvRows.shift();assert(header.includes('gender'));const idColumn=header.indexOf('id'),genderColumn=header.indexOf('gender');assert.equal(csvRows.find(r=>r[idColumn]==='legacy-id')[genderColumn],'');for(const expected of accepted)assert.equal(csvRows.find(r=>r[idColumn]===expected.id)[genderColumn],expected.gender);
  for(const token of [legacyToken,admin,...accepted.map(s=>s.token)])assert.equal(exported.text.includes(token),false);
  inspect=new DatabaseSync(filename,{readOnly:true});assert.equal(inspect.prepare('SELECT COUNT(*) n FROM sessions').get().n,6);assert.equal(inspect.prepare('SELECT COUNT(*) n FROM ratings').get().n,1);inspect.close();
 }finally{await stop();fs.rmSync(root,{recursive:true,force:true});}
});

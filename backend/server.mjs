import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
const ROOT=fs.realpathSync(path.resolve(process.env.TTS_MOS_PUBLIC_DIR||path.join(path.dirname(fileURLToPath(import.meta.url)),'../public')));
const DEFAULT_DATA=os.platform()==='darwin'?path.join(os.homedir(),'Library/Application Support/TTS-MOS'):path.join(process.env.XDG_DATA_HOME||path.join(os.homedir(),'.local/share'),'tts-mos');
const DATA=path.resolve(process.env.TTS_MOS_DATA_DIR||DEFAULT_DATA);
const PROJECT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
if(DATA===ROOT||DATA.startsWith(ROOT+path.sep)||DATA===PROJECT||DATA.startsWith(PROJECT+path.sep))throw Error('Data directory must be outside the source repository and public');
fs.mkdirSync(DATA,{recursive:true,mode:0o700});
const db=new DatabaseSync(path.join(DATA,'responses.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,token TEXT UNIQUE NOT NULL,study_id TEXT NOT NULL,role TEXT NOT NULL,name TEXT NOT NULL,gender TEXT NOT NULL DEFAULT '',organization TEXT NOT NULL,created_at TEXT NOT NULL,completed_at TEXT,order_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ratings(session_id TEXT NOT NULL REFERENCES sessions(id),sample_id TEXT NOT NULL,score INTEGER NOT NULL CHECK(score BETWEEN 1 AND 5),listened_seconds REAL NOT NULL,duration_seconds REAL NOT NULL,ended INTEGER NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(session_id,sample_id));`);
// Inspect the existing schema inside a write transaction; preserve old rows and credentials.
db.exec('BEGIN IMMEDIATE');
try{if(!db.prepare('PRAGMA table_info(sessions)').all().some(column=>column.name==='gender'))db.exec("ALTER TABLE sessions ADD COLUMN gender TEXT NOT NULL DEFAULT ''");db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
const adminFile=path.join(DATA,'admin-token.txt');
if(!fs.existsSync(adminFile))fs.writeFileSync(adminFile,randomBytes(32).toString('hex'),{mode:0o600});
const ADMIN=fs.readFileSync(adminFile,'utf8').trim();
const PORT=Number(process.env.PORT||8787), HOST=process.env.HOST||'127.0.0.1';
const allowed=new Set([`http://localhost:${PORT}`,`http://127.0.0.1:${PORT}`,...(process.env.ALLOWED_ORIGINS||'').split(',').filter(Boolean)].map(s=>new URL(s).origin));
const study=()=>JSON.parse(fs.readFileSync(path.join(ROOT,'data/study.json'),'utf8'));
const now=()=>new Date().toISOString();
const fail=(status,message)=>Object.assign(new Error(message),{status});
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
const body=async req=>{let chunks=[],size=0;for await(const chunk of req){size+=chunk.length;if(size>16384)throw fail(413,'请求过大');chunks.push(chunk)}try{return JSON.parse(Buffer.concat(chunks).toString())}catch{throw fail(400,'无效JSON')}};
const clean=(v,max=80)=>typeof v==='string'?v.trim().slice(0,max):'';
const session=req=>{const token=(req.headers.authorization||'').replace(/^Bearer /,'');const s=db.prepare('SELECT * FROM sessions WHERE token=?').get(token);if(!s)throw fail(401,'测评凭证无效，请使用原浏览器恢复');return s;};
const isLoopback=req=>['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
const requestProtocol=req=>{const forwarded=req.headers['x-forwarded-proto'];return process.env.TRUST_PROXY_LOOPBACK==='1'&&isLoopback(req)&&['http','https'].includes(forwarded)?forwarded:req.socket.encrypted?'https':'http';};
const local=req=>isLoopback(req)&&!Object.keys(req.headers).some(h=>h==='forwarded'||h.startsWith('x-forwarded-')||h.startsWith('cf-'))&&['localhost','127.0.0.1','[::1]'].includes((req.headers.host||'').replace(/:\d+$/,''));
const admin=req=>{if(!local(req))throw fail(403,'管理功能仅限本机访问');const t=(req.headers.authorization||'').replace(/^Bearer /,'');if(Buffer.byteLength(t)!==Buffer.byteLength(ADMIN)||!timingSafeEqual(Buffer.from(t),Buffer.from(ADMIN)))throw fail(401,'管理凭证无效');};
function shuffled(ids){const a=[...ids];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a;}
function audioAvailable(sample,requireDuration=true){
 if(!sample||typeof sample.audio!=='string'||(requireDuration&&(!Number.isFinite(sample.duration_seconds)||sample.duration_seconds<=0)))return false;
 try{const f=path.resolve(ROOT,sample.audio);return f.startsWith(ROOT+path.sep)&&fs.realpathSync(f).startsWith(ROOT+path.sep)&&fs.statSync(f).isFile()&&fs.statSync(f).size>0;}catch{return false;}
}
function studyStatus(st){
 const samples=Array.isArray(st.samples)?st.samples:[],practice=Array.isArray(st.practice)?st.practice:[],counts={};
 const available=samples.filter(x=>audioAvailable(x)).length;
 for(const x of samples)counts[x.text_id]=(counts[x.text_id]||0)+1;
 const structure=samples.length===80&&new Set(samples.map(x=>x.id)).size===80&&samples.every(x=>typeof x.id==='string'&&x.id&&typeof x.text_id==='string'&&x.text_id&&typeof x.text==='string'&&x.text.trim())&&Object.keys(counts).length===20&&Object.values(counts).every(n=>n===4);
 const practices=practice.length>=2&&practice.every(x=>audioAvailable(x,false))&&new Set(practice.map(x=>x.audio)).size===practice.length&&practice.every(x=>!samples.some(y=>x.audio===y.audio));
 return {ready:st.materials_status!=='pending'&&structure&&available===80&&practices,expected:80,available};
}
function ready(st){if(!studyStatus(st).ready)throw fail(503,'正式音频准备中，暂未开放评分');}
function publicHttpsUrl(){
 const filename=process.env.PUBLIC_HTTPS_URL_FILE;if(!filename)return null;
 try{if(fs.statSync(filename).size>4096)return null;const raw=fs.readFileSync(filename,'utf8').trim();if(/[\s?#@]/.test(raw))return null;const url=new URL(raw);if(url.protocol!=='https:'||!url.hostname||url.username||url.password||url.pathname!=='/'||url.search||url.hash)return null;return url.origin+'/';}catch{return null;}
}
function csv(rows){return '\uFEFF'+rows.map(row=>row.map(v=>{let s=String(v??'');if(/^[\s]*[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"'}).join(',')).join('\r\n');}
function rawRows(){return db.prepare(`SELECT s.id,s.role,s.name,s.gender,s.organization,s.created_at,s.completed_at,r.sample_id,r.score,r.listened_seconds,r.duration_seconds,r.updated_at FROM sessions s LEFT JOIN ratings r ON r.session_id=s.id ORDER BY s.created_at,r.sample_id`).all();}
function summary(){const st=study();let key={};try{key=JSON.parse(fs.readFileSync(path.join(DATA,'study-key.json'),'utf8')).systems||{}}catch{}const rows=db.prepare('SELECT r.* FROM ratings r JOIN sessions s ON s.id=r.session_id WHERE s.completed_at IS NOT NULL AND s.study_id=?').all(st.study_id);const sampleMap=new Map(st.samples.map(s=>[s.id,s]));const groups={};for(const r of rows){const sample=sampleMap.get(r.sample_id);if(!sample)continue;const system=key[r.sample_id]||'unmapped',k=system+'|'+sample.text_id;const g=groups[k]||={system,text_id:sample.text_id,n:0,sum:0};g.n++;g.sum+=r.score;}const by_text=Object.values(groups).map(g=>({system:g.system,text_id:g.text_id,n:g.n,mean:g.sum/g.n}));const by_system=[];for(const system of new Set(by_text.map(x=>x.system))){const cells=by_text.filter(x=>x.system===system);by_system.push({system,texts:cells.length,ratings:cells.reduce((a,x)=>a+x.n,0),mean:cells.reduce((a,x)=>a+x.mean,0)/cells.length})}return {completed_sessions:db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE completed_at IS NOT NULL AND study_id=?').get(st.study_id).n,by_text,by_system,note:'仅统计完整提交；系统均值对有评分文本等权。重复听者的统计推断应按参与者聚类。'};}
const server=http.createServer(async(req,res)=>{try{
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
 const origin=req.headers.origin;if(origin){let normalized;try{normalized=new URL(origin).origin}catch{throw fail(403,'来源无效')}const sameOrigin=new URL(`${requestProtocol(req)}://${req.headers.host}`).origin;if(normalized!==sameOrigin&&!allowed.has(normalized))throw fail(403,'不允许的来源');res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Methods','GET,POST,PUT,OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type,Authorization');}
 if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
 const url=new URL(req.url,'http://localhost'),p=url.pathname;
 if(p==='/'&&['GET','HEAD'].includes(req.method)&&!isLoopback(req)&&requestProtocol(req)!=='https'){const target=publicHttpsUrl();if(target){res.writeHead(302,{'Location':target,'Cache-Control':'no-store'});res.end();return;}}
 if(p==='/api/health'){json(res,200,{ok:true,app:"tts-mos-evaluation",version:1});return;}
 if(p==='/api/study-status'&&req.method==='GET'){json(res,200,studyStatus(study()));return;}
 if(p==='/api/sessions'&&req.method==='POST'){const st=study();ready(st);const b=await body(req);const name=clean(b.name),role=clean(b.role);const gender=b.gender===undefined?'':typeof b.gender==='string'?b.gender.trim():null;if(gender===null||(gender&&!['男','女'].includes(gender)))throw fail(400,'性别选项无效');if(!name||!role||b.device_confirmed!==true)throw fail(400,'请填写姓名、身份并完成设备确认');const id=randomUUID(),token=randomBytes(32).toString('hex'),order=shuffled(st.samples.map(s=>s.id));db.prepare('INSERT INTO sessions(id,token,study_id,role,name,gender,organization,created_at,order_json) VALUES(?,?,?,?,?,?,?,?,?)').run(id,token,st.study_id,role,name,gender,clean(b.organization),now(),JSON.stringify(order));json(res,201,{id,token,order,study_id:st.study_id});return;}
 if(p==='/api/session'&&req.method==='GET'){const s=session(req);json(res,200,{id:s.id,study_id:s.study_id,identity:{name:s.name,gender:s.gender,role:s.role,organization:s.organization},order:JSON.parse(s.order_json),completed_at:s.completed_at,ratings:db.prepare('SELECT sample_id,score,listened_seconds,duration_seconds,ended,updated_at FROM ratings WHERE session_id=?').all(s.id)});return;}
 if(p==='/api/ratings'&&req.method==='PUT'){const s=session(req),b=await body(req),st=study();ready(st);if(s.completed_at)throw fail(409,'测评已经提交');if(s.study_id!==st.study_id)throw fail(409,'测评材料已更新，请联系管理员');const sample=st.samples.find(x=>x.id===b.sample_id);if(!sample||!JSON.parse(s.order_json).includes(b.sample_id))throw fail(400,'未知音频');if(!Number.isInteger(b.score)||b.score<1||b.score>5)throw fail(400,'评分须为1–5整数');const d=b.duration_seconds,l=b.listened_seconds;if(b.ended!==true||!Number.isFinite(d)||d<=0||!Number.isFinite(l)||l<d*0.9||l>86400)throw fail(400,'请完整听完音频后评分');if(sample.duration_seconds&&Math.abs(d-sample.duration_seconds)>Math.max(.75,sample.duration_seconds*.08))throw fail(400,'音频时长不符');db.prepare('INSERT INTO ratings VALUES(?,?,?,?,?,?,?) ON CONFLICT(session_id,sample_id) DO UPDATE SET score=excluded.score,listened_seconds=excluded.listened_seconds,duration_seconds=excluded.duration_seconds,ended=excluded.ended,updated_at=excluded.updated_at').run(s.id,b.sample_id,b.score,l,d,1,now());json(res,200,{saved:true,sample_id:b.sample_id});return;}
 if(p==='/api/complete'&&req.method==='POST'){const s=session(req),st=study();ready(st);if(s.study_id!==st.study_id)throw fail(409,'测评材料已更新');const rows=db.prepare('SELECT sample_id FROM ratings WHERE session_id=?').all(s.id);if(rows.length!==80||st.samples.some(x=>!rows.some(r=>r.sample_id===x.id)))throw fail(409,'尚未完成全部80条评分');if(!s.completed_at)db.prepare('UPDATE sessions SET completed_at=? WHERE id=?').run(now(),s.id);json(res,200,{completed:true,completed_at:db.prepare('SELECT completed_at FROM sessions WHERE id=?').get(s.id).completed_at});return;}
 if(p.startsWith('/api/admin/')){admin(req);if(p==='/api/admin/summary'){json(res,200,summary());return}if(p==='/api/admin/export'){const rows=rawRows(),cols=['id','role','name','gender','organization','created_at','completed_at','sample_id','score','listened_seconds','duration_seconds','updated_at'];res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="tts-mos-ratings.csv"','Cache-Control':'no-store'});res.end(csv([cols,...rows.map(r=>cols.map(c=>r[c]))]));return;}throw fail(404,'未找到接口');}
 if(p==='/admin'){if(!local(req))throw fail(403,'管理页仅限本机访问');res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'"});res.end(adminHtml);return;}
 if(p.startsWith('/api/'))throw fail(404,'未找到接口');if(!['GET','HEAD'].includes(req.method))throw fail(405,'请求方式不支持');
 let relative;try{relative=decodeURIComponent(p)}catch{throw fail(400,'路径无效')}const f=path.resolve(ROOT,'.'+(relative==='/'?'/index.html':relative));if(!f.startsWith(ROOT+path.sep)||!fs.existsSync(f)||!fs.statSync(f).isFile()||!fs.realpathSync(f).startsWith(ROOT+path.sep))throw fail(404,'文件不存在');const ext=path.extname(f);const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.wav':'audio/wav','.mp3':'audio/mpeg'};res.writeHead(200,{'Content-Type':types[ext]||'application/octet-stream','Content-Length':fs.statSync(f).size,'Cache-Control':ext==='.json'?'no-store':'no-cache'});if(req.method==='HEAD')res.end();else fs.createReadStream(f).pipe(res);
 }catch(e){if(!res.headersSent)json(res,e.status||500,{error:e.status?e.message:'服务器暂时无法保存，请稍后重试'});else res.end();}});
const adminHtml=`<!doctype html><meta charset="utf-8"><title>测评数据管理</title><style>body{font:16px system-ui;max-width:1000px;margin:50px auto;padding:20px;background:#f6f5ef;color:#163b35}button,input{padding:12px;margin:8px}pre{white-space:pre-wrap}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ccc;padding:10px}</style><h1>测评数据管理</h1><p>管理凭证保存在本机数据目录的 admin-token.txt。仅本机可访问此页。</p><input type="password" id="token" placeholder="粘贴管理凭证" autocomplete="off"><button id="load">查看汇总</button><button id="export">导出原始评分 CSV</button><div id="result"></div><script>const headers=()=>({Authorization:'Bearer '+document.querySelector('#token').value.trim()});document.querySelector('#load').onclick=async()=>{try{const r=await fetch('/api/admin/summary',{headers:headers()}),d=await r.json();if(!r.ok)throw Error(d.error);const el=document.querySelector('#result');el.replaceChildren();const p=document.createElement('p');p.textContent='完整提交：'+d.completed_sessions+' 人。'+d.note;el.append(p);const pre=document.createElement('pre');pre.textContent=JSON.stringify(d,null,2);el.append(pre)}catch(e){alert(e.message)}};document.querySelector('#export').onclick=async()=>{const r=await fetch('/api/admin/export',{headers:headers()});if(!r.ok){alert((await r.json()).error);return}const a=document.createElement('a');a.href=URL.createObjectURL(await r.blob());a.download='tts-mos-ratings.csv';a.click();URL.revokeObjectURL(a.href)};</script>`;
server.listen(PORT,HOST,()=>console.log(`TTS MOS server listening at http://${HOST}:${PORT}; private data directory: ${DATA}`));

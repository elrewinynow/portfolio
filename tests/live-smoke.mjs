// Run manually only: creates one clearly labelled synthetic submission on the
// deployed brief API. Never uses real customer data or runs under npm test.
import assert from 'node:assert/strict';
import {writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
const base='https://elrewiny-brief-api.mrelrewiny.workers.dev',origin='https://elrewiny.com';
const result={timestamp:new Date().toISOString(),api:base,checks:[]};
const check=(name,value)=>{assert.ok(value,name);result.checks.push({name,status:'PASS'});};
check('database health',(await fetch(base+'/healthz')).status===200);
const options=await fetch(base+'/api/brief',{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type,idempotency-key'}});
check('restricted CORS preflight',options.status===204&&options.headers.get('access-control-allow-origin')===origin);
check('foreign origin denied',(await fetch(base+'/api/brief/challenge',{headers:{Origin:'https://example.test'}})).status===403);
check('no public submissions list',(await fetch(base+'/api/briefs')).status===404);
const challenge=await fetch(base+'/api/brief/challenge',{headers:{Origin:origin}});check('challenge issued',challenge.status===200);const {token,readyAt}=await challenge.json();
const key=crypto.randomUUID();
const answers={brand:'اختبار تشغيل البريف — ليس عميلًا',contactName:'اختبار آلي اصطناعي',email:'brief-smoke@example.test',offering:'خدمة اختبار اصطناعية',challenge:'التحقق من الحفظ ومنع التكرار',goals:['ترتيب الأولويات'],notes:'سجل اختبار نشر فقط. لا يمثل طلب عميل أو حجز جلسة.'};
const post=(a=answers,extra={})=>fetch(base+'/api/brief',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify({answers:a,token,website_confirm:'',...extra})});
await new Promise(r=>setTimeout(r,Math.max(0,Math.min(4000,readyAt-Date.now()+150))));
check('malformed contact rejected',(await post({...answers,email:'invalid'})).status===422);
check('honeypot rejected',(await post(answers,{website_confirm:'robot'})).status===403);
const responses=await Promise.all([post(),post(),post()]);check('one create and two replays',responses.filter(r=>r.status===201).length===1&&responses.filter(r=>r.status===200).length===2);
const receipts=await Promise.all(responses.map(r=>r.json()));check('stable result identity',new Set(receipts.map(r=>r.id)).size===1&&!!receipts[0].id);
check('changed intent rejected',(await post({...answers,challenge:'different intent'})).status===409);
result.id=receipts[0].id;result.requestKey=key;
const out=resolve('../validation/brief-cloudflare-20261126');mkdirSync(out,{recursive:true});writeFileSync(resolve(out,'live-smoke.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {adminDatabase,adminHandle} from '../dashboard/admin-worker.js';
import {handle} from '../dashboard/worker.js';
import {binding,baseSchema,adminSchema,identity,seed} from './dashboard-support.mjs';
const migration=readFileSync(new URL('../dashboard/admin-auth.sql',import.meta.url),'utf8');
test('Domain transition preserves legacy key/session, isolates new enrollment, shares durable reviews and denies cross-domain cookies',async()=>{
 const db=binding();db.db.exec(baseSchema+adminSchema);const brief=seed(db.db),legacy=await identity(db),oldCookie=await legacy.sign();const oldKey=db.db.prepare('SELECT * FROM dashboard_credentials').get();
 const before=db.db.prepare('SELECT * FROM brief_submissions').all();db.db.exec(migration);db.db.exec(migration);assert.deepEqual(db.db.prepare('SELECT * FROM brief_submissions').all(),before);assert.deepEqual(db.db.prepare('SELECT * FROM dashboard_credentials').get(),oldKey);
 const scoped={...adminDatabase(db),db:db.db},admin=await identity(scoped,'https://admin.elrewiny.com');
 const request=(path,cookie,extra={})=>new Request(admin.env.DASHBOARD_ORIGIN+path,{...extra,headers:{Cookie:cookie,...extra.headers}});
 const env={...admin.env,DB:db};
 try{
  assert.equal((await adminHandle(request('/api/briefs',oldCookie),env)).status,401);
  const status=await adminHandle(new Request(admin.env.DASHBOARD_ORIGIN+'/auth/status'),env);assert.deepEqual(await status.json(),{registered:false});
  await admin.enroll();const newCookie=await admin.login();assert.equal(db.db.prepare('SELECT count(*) n FROM admin_dashboard_credentials').get().n,1);assert.equal(db.db.prepare('SELECT count(*) n FROM dashboard_credentials').get().n,1);
  assert.equal((await handle(new Request(legacy.env.DASHBOARD_ORIGIN+'/api/briefs',{headers:{Cookie:oldCookie}}),legacy.env)).status,200);
  assert.equal((await handle(new Request(legacy.env.DASHBOARD_ORIGIN+'/api/briefs',{headers:{Cookie:newCookie}}),legacy.env)).status,401);
  assert.equal((await adminHandle(new Request('https://wrong.example/api/briefs',{headers:{Cookie:newCookie}}),env)).status,404);
  assert.equal((await adminHandle(request('/api/briefs',newCookie),env)).status,200);
  const update=await adminHandle(request('/api/briefs/'+brief,newCookie,{method:'POST',headers:{Origin:admin.env.DASHBOARD_ORIGIN,'Content-Type':'application/json','X-Requested-With':'brief-dashboard','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify({status:'reviewing',notes:'مراجعة عبر النطاق الجديد',version:0})}),env);assert.equal(update.status,200);
  const shared=await (await handle(new Request(legacy.env.DASHBOARD_ORIGIN+'/api/briefs/'+brief,{headers:{Cookie:oldCookie}}),legacy.env)).json();assert.equal(shared.notes,'مراجعة عبر النطاق الجديد');assert.equal(shared.version,1);
  db.db.exec('UPDATE admin_dashboard_credentials SET active=0');assert.equal((await adminHandle(request('/api/briefs',newCookie),env)).status,401);assert.equal((await handle(new Request(legacy.env.DASHBOARD_ORIGIN+'/api/briefs',{headers:{Cookie:oldCookie}}),legacy.env)).status,200);
 }finally{db.db.close();}
});

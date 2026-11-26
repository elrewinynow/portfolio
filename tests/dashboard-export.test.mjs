import {test} from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {makeWorkbook} from '../dashboard/excel-export.js';
import {handle} from '../dashboard/worker.js';
import {binding,baseSchema,adminSchema,identity,seed} from './dashboard-support.mjs';

test('Export XLSX preserves Arabic, phone zeros, all answers and literal formula-looking input',async()=>{
 const rows=[{id:crypto.randomUUID(),brand:'نشاط خدمات عربي',contact_name:'مسؤول',phone:'01001234567',email:'test@example.test',submitted_at:'2026-11-26T14:00:00.000Z',status:'reviewed',notes:'=HYPERLINK("https://evil.test")',answers:{offering:'استشارة تسويقية',goals:['ترتيب الأولويات','تحسين التحويل'],references:'https://example.test',market:'+2'}}];
 const output=await makeWorkbook(rows),book=new ExcelJS.Workbook();await book.xlsx.load(output);const s=book.worksheets[0];
 assert.equal(s.rowCount,2);assert.equal(s.views[0].rightToLeft,true);assert.equal(s.views[0].state,'frozen');assert.ok(s.autoFilter);
 assert.equal(s.getCell('D2').value,'01001234567');assert.equal(s.getCell('H2').type,ExcelJS.ValueType.String);assert.equal(s.getCell('H2').value,rows[0].notes);
 const headers=s.getRow(1).values;assert.ok(headers.some(x=>x?.includes('المنتج أو الخدمة الأساسية')));assert.ok(s.getRow(2).values.includes('ترتيب الأولويات، تحسين التحويل'));
 assert.ok(s.getRow(2).values.includes('+2'));assert.ok(s.getRow(2).values.includes('تمت المراجعة'));
 const empty=new ExcelJS.Workbook();await empty.xlsx.load(await makeWorkbook([]));assert.equal(empty.worksheets[0].rowCount,1);
});

test('Export JSON/print respect authentication, filters, 500-row cap, saved notes and HTML escaping',async()=>{
 const db=binding();db.db.exec(baseSchema+adminSchema);const id=await identity(db),cookie=await id.sign(),first=seed(db.db),second=seed(db.db,undefined,1);
 const req=(path,auth=true)=>handle(new Request(id.env.DASHBOARD_ORIGIN+path,{headers:auth?{Cookie:cookie}:{}}),id.env);
 try{
  for(const path of ['/api/export.json','/api/briefs/'+first+'/print','/excel-export.js','/print.css','/print-client.js'])assert.equal((await req(path,false)).status,401,path);
  assert.equal((await req('/api/export.json?status=bad')).status,400);
  assert.equal((await (await req('/api/export.json?q=nonexistent')).json()).rows.length,0);
  const body=await (await req('/api/export.json?q=synthetic')).json();assert.equal(body.rows.length,2);assert.equal(body.rows[0].answers.offering,'خدمة تدريب');assert.ok(!('answers_json' in body.rows[0]));
  const marker='<script>alert("x")</script>';const answers={brand:marker,offering:marker,challenge:'اختبار',goals:['ترتيب الأولويات']};db.db.prepare('UPDATE brief_submissions SET brand=?,answers_json=? WHERE id=?').run(marker,JSON.stringify(answers),first);
  db.db.prepare('INSERT INTO brief_reviews VALUES(?,?,?,?,?)').run(first,marker,1,new Date().toISOString(),id.env.OWNER_EMAIL);
  const print=await req('/api/briefs/'+first+'/print'),html=await print.text();assert.equal(print.headers.get('Cache-Control'),'no-store');assert.match(print.headers.get('Content-Security-Policy'),/script-src 'self'/);assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes(marker));assert.ok(html.includes('حفظ PDF / طباعة'));assert.ok(html.includes('مراجعتي الخاصة'));
  assert.equal((await req('/api/briefs/'+crypto.randomUUID()+'/print')).status,404);
  for(let i=0;i<499;i++)seed(db.db,undefined,i+2);
  for(const path of ['/api/export.json','/api/export.csv'])assert.equal((await req(path)).status,422,path);
  db.db.exec('UPDATE dashboard_credentials SET active=0');assert.equal((await req('/api/export.json')).status,401);assert.equal((await req('/api/briefs/'+second+'/print')).status,401);
 }finally{db.db.close();}
});

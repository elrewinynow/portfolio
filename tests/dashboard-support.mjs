import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import {isoCBOR} from '@simplewebauthn/server/helpers';
import {authRoute,digest,randomToken} from '../dashboard/auth.js';
export const baseSchema = readFileSync(
  new URL("../cloudflare/schema.sql", import.meta.url),
  "utf8",
);
export const adminSchema = readFileSync(
  new URL("../dashboard/migration.sql", import.meta.url),
  "utf8",
);
export function binding(path = ":memory:") {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys=ON;PRAGMA busy_timeout=5000;");
  return {
    db,
    prepare(sql) {
      let args = [];
      return {
        bind(...values) {
          args = values.map(v=>v instanceof ArrayBuffer?new Uint8Array(v):v);
          return this;
        },
        async first() {
          return db.prepare(sql).get(...args) || null;
        },
        async all() {
          return { success: true, results: db.prepare(sql).all(...args) };
        },
        async run() {
          const result = db.prepare(sql).run(...args);
          return { success: true, meta: { changes: Number(result.changes) } };
        },
      };
    },
    async batch(statements) {
      db.exec("BEGIN IMMEDIATE");
      try {
        const rows = [];
        for (const s of statements) rows.push(await s.run());
        db.exec("COMMIT");
        return rows;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
  };
}
export function seed(db, id = crypto.randomUUID(), index = 0) {
  const row = {
    brand: index ? "نشاط خدمات تجريبي" : "اختبار مراجعة اصطناعي",
    contactName: "مسؤول تجريبي",
    email: "synthetic@example.test",
    offering: "خدمة تدريب",
    challenge: "ترتيب الأولويات",
    goals: ["ترتيب الأولويات"],
  };
  db.prepare(
    "INSERT INTO brief_submissions(id,request_key,intent_hash,submitted_at,brand,contact_name,phone,email,answers_json,token_hash,ip_bucket,day_bucket,bucket_expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
  ).run(
    id,
    crypto.randomUUID(),
    "test-intent",
    new Date(Date.now() + index).toISOString(),
    row.brand,
    row.contactName,
    null,
    row.email,
    JSON.stringify(row),
    crypto.randomUUID(),
    "test-ip-" + id,
    "test-day-" + id,
    Date.now() + 86400000,
  );
  return id;
}
const b64=bytes=>Buffer.from(bytes).toString('base64url');
const sha=async bytes=>new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
const bytes=text=>new TextEncoder().encode(text);
const join=(...parts)=>Buffer.concat(parts.map(p=>Buffer.from(p)));
const counter=n=>{const b=Buffer.alloc(4);b.writeUInt32BE(n);return b;};
function der(raw){const integer=b=>{while(b.length>1&&b[0]===0)b=b.slice(1);if(b[0]&128)b=join([0],b);return join([2,b.length],b);};const r=integer(raw.slice(0,32)),s=integer(raw.slice(32));return join([48,r.length+s.length],r,s);}
export async function identity(DB,origin="https://dashboard.example"){
 const setupToken=randomToken(),env={DB,OWNER_EMAIL:'owner@example.test',DASHBOARD_ORIGIN:origin,SETUP_HASH:await digest(setupToken),SETUP_EXPIRES:Date.now()+3600000};
 DB.db.prepare("INSERT OR IGNORE INTO brief_settings VALUES('ip_salt','synthetic-auth-salt')").run();
 const keys=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']),jwk=await crypto.subtle.exportKey('jwk',keys.publicKey),rawId=crypto.getRandomValues(new Uint8Array(32)),id=b64(rawId);
 let flowCookie='',token='',userHandle='',count=0;
 const call=async(path,body={},headers={},target=env)=>authRoute(new Request(env.DASHBOARD_ORIGIN+path,{method:'POST',headers:{Origin:env.DASHBOARD_ORIGIN,'X-Requested-With':'brief-dashboard','Content-Type':'application/json','CF-Connecting-IP':'192.0.2.1',Cookie:flowCookie,...headers},body:JSON.stringify(body)}),target);
 const options=async(kind)=>{const r=await call('/auth/'+kind+'/options',kind==='register'?{setupToken}:{});if(r.status!==200)throw Error('options: '+await r.text());flowCookie=r.headers.get('Set-Cookie').split(';')[0];return r.json();};
 const registration=async(o,origin=env.DASHBOARD_ORIGIN)=>{
  userHandle=o.user.id;
  const cose=isoCBOR.encode(new Map([[1,2],[3,-7],[-1,1],[-2,new Uint8Array(Buffer.from(jwk.x,'base64url'))],[-3,new Uint8Array(Buffer.from(jwk.y,'base64url'))]]));
  const len=Buffer.alloc(2);len.writeUInt16BE(rawId.length);
  const authData=join(await sha(bytes(new URL(env.DASHBOARD_ORIGIN).hostname)),[0x45],counter(0),new Uint8Array(16),len,rawId,cose);
  return {id,rawId:id,type:'public-key',response:{clientDataJSON:b64(bytes(JSON.stringify({type:'webauthn.create',challenge:o.challenge,origin,crossOrigin:false}))),attestationObject:b64(isoCBOR.encode(new Map([['fmt','none'],['attStmt',new Map()],['authData',new Uint8Array(authData)]]))),transports:['internal']},clientExtensionResults:{},authenticatorAttachment:'platform'};
 };
 const assertion=async(o,{origin=env.DASHBOARD_ORIGIN,challenge=o.challenge,flags=5,signature=true}={})=>{
  const client=bytes(JSON.stringify({type:'webauthn.get',challenge,origin,crossOrigin:false})),auth=join(await sha(bytes(new URL(env.DASHBOARD_ORIGIN).hostname)),[flags],counter(++count));
  let sig=der(new Uint8Array(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},keys.privateKey,join(auth,await sha(client)))));if(!signature)sig[sig.length-1]^=1;
  return {id,rawId:id,type:'public-key',response:{clientDataJSON:b64(client),authenticatorData:b64(auth),signature:b64(sig),userHandle},clientExtensionResults:{},authenticatorAttachment:'platform'};
 };
 const enroll=async()=>{const o=await options('register'),r=await call('/auth/register/verify',{setupToken,response:await registration(o)});if(r.status!==200)throw Error('registration '+await r.text());};
 const login=async()=>{const o=await options('login'),r=await call('/auth/login/verify',{response:await assertion(o)});if(r.status!==200)throw Error('login '+await r.text());token=r.headers.get('Set-Cookie').split(';')[0];return token;};
 return {env,id,setupToken,call,options,registration,assertion,enroll,login,sign:async()=>{if(!DB.db.prepare('SELECT id FROM dashboard_credentials').get())await enroll();return login();}};
}

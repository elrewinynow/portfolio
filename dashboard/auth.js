import {generateRegistrationOptions,verifyRegistrationResponse,generateAuthenticationOptions,verifyAuthenticationResponse} from '@simplewebauthn/server';
export const digest=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),v=>v.toString(16).padStart(2,'0')).join('');
export const randomToken=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),v=>v.toString(16).padStart(2,'0')).join('');
const cookieValue=(request,name)=>{const matches=(request.headers.get('Cookie')||'').split(';').map(p=>p.trim()).filter(p=>p.startsWith(name+'='));return matches.length===1?matches[0].slice(name.length+1):null;};
const cookie=(name,value,maxAge)=>`${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`;
export async function authenticate(request,env,{now=()=>Date.now()}={}){
 if(!env.DB||!env.OWNER_EMAIL||!env.DASHBOARD_ORIGIN)return {status:503};
 const token=cookieValue(request,'__Host-brief-session');if(!token||!/^[a-f0-9]{64}$/.test(token))return {status:401};
 const sessionHash=await digest(token);
 const row=await env.DB.prepare('SELECT c.owner_email,c.id,s.expires_at FROM dashboard_sessions s JOIN dashboard_credentials c ON c.id=s.credential_id WHERE s.token_hash=? AND s.expires_at>? AND c.active=1 AND c.owner_email=?').bind(sessionHash,now(),env.OWNER_EMAIL).first();
 return row?{status:200,user:{email:row.owner_email,sub:row.id,expires:Math.floor(row.expires_at/1000),sessionHash}}:{status:401};
}
async function readBody(request){const reader=request.body?.getReader();let parts=[],size=0;if(reader)while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>24000){await reader.cancel();throw Error('BODY');}parts.push(value);}const bytes=new Uint8Array(size);let off=0;for(const p of parts){bytes.set(p,off);off+=p.length;}return JSON.parse(new TextDecoder().decode(bytes));}
export async function authRoute(request,env,{now=()=>Date.now()}={}){
 const url=new URL(request.url),path=url.pathname;
 const json=(status,body,extra={})=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...extra}});
 if(!env.DB||!env.OWNER_EMAIL||!env.DASHBOARD_ORIGIN||url.origin!==env.DASHBOARD_ORIGIN)return json(503,{message:'الدخول الخاص غير متاح حاليًا.'});
 const rpID=new URL(env.DASHBOARD_ORIGIN).hostname;
 if(path==='/auth/status'&&request.method==='GET'){const existing=await env.DB.prepare('SELECT id FROM dashboard_credentials LIMIT 1').first();return json(200,{registered:!!existing});}
 if(request.method!=='POST')return json(405,{message:'الطلب غير متاح.'});
 if(request.headers.get('Origin')!==env.DASHBOARD_ORIGIN||request.headers.get('X-Requested-With')!=='brief-dashboard')return json(403,{message:'مصدر طلب الدخول غير مسموح.'});
 if(path==='/auth/logout'){const auth=await authenticate(request,env,{now});if(auth.status===200)await env.DB.prepare('DELETE FROM dashboard_sessions WHERE token_hash=?').bind(auth.user.sessionHash).run();return json(200,{ok:true},{'Set-Cookie':cookie('__Host-brief-session','',0)});}
 if(!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type')||''))return json(415,{message:'صيغة الطلب غير صالحة.'});
 try{
  await env.DB.prepare('DELETE FROM dashboard_auth_limits WHERE expires_at<?').bind(now()).run();
  await env.DB.prepare('DELETE FROM dashboard_sessions WHERE expires_at<?').bind(now()).run();
  await env.DB.prepare('DELETE FROM dashboard_auth_challenges WHERE expires_at<? AND id NOT IN(SELECT registration_flow FROM dashboard_credentials) AND id NOT IN(SELECT flow_id FROM dashboard_sessions)').bind(now()).run();
  const ip=request.headers.get('CF-Connecting-IP');if(!ip)return json(503,{message:'تعذر التحقق من الاتصال.'});
  const salt=await env.DB.prepare("SELECT value FROM brief_settings WHERE name='ip_salt'").first();if(!salt)return json(503,{message:'إعداد الدخول لم يكتمل.'});
  const ipHash=await digest(salt.value+':'+ip),hour=Math.floor(now()/3600000),day=Math.floor(now()/86400000);
  for(const [bucket,max,expires] of [[`ip:${ipHash}:${hour}`,40,(hour+1)*3600000],[`day:${day}`,500,(day+1)*86400000]]){const count=await env.DB.prepare('INSERT INTO dashboard_auth_limits VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=count+1 RETURNING count').bind(bucket,expires).first();if(count.count>max)return json(429,{message:'محاولات دخول كتير؛ جرّب بعد شوية.'},{'Retry-After':'3600'});}
  const body=await readBody(request);if(!body||typeof body!=='object')throw Error();
  if(path==='/auth/register/options'){
   if(typeof body.setupToken!=='string'||!/^[a-f0-9]{64}$/.test(body.setupToken)||!env.SETUP_HASH||await digest(body.setupToken)!==env.SETUP_HASH||!(Number(env.SETUP_EXPIRES)>now()))return json(403,{message:'رمز إعداد المالك غير صالح أو انتهت صلاحيته.'});
   if(await env.DB.prepare('SELECT id FROM dashboard_credentials LIMIT 1').first())return json(409,{message:'تم تسجيل مفتاح المالك بالفعل؛ استخدم تسجيل الدخول.'});
   const userHandle=Uint8Array.from((await digest('owner:'+env.OWNER_EMAIL)).match(/../g),h=>parseInt(h,16));
   const options=await generateRegistrationOptions({rpName:'أحمد الرويني — بريفات التشخيص',rpID,userName:env.OWNER_EMAIL,userID:userHandle,attestationType:'none',supportedAlgorithmIDs:[-7],authenticatorSelection:{residentKey:'required',userVerification:'required'}});
   const flow=randomToken();await env.DB.prepare('INSERT INTO dashboard_auth_challenges(id,challenge,purpose,expires_at,setup_hash) VALUES(?,?,?,?,?)').bind(await digest(flow),options.challenge,'registration',now()+300000,env.SETUP_HASH).run();return json(200,options,{'Set-Cookie':cookie('__Host-brief-flow',flow,300)});
  }
  if(path==='/auth/login/options'){
   const credential=await env.DB.prepare('SELECT id FROM dashboard_credentials WHERE active=1 AND owner_email=?').bind(env.OWNER_EMAIL).first();if(!credential)return json(403,{message:'مفتاح دخول المالك لم يُسجل بعد.'});
   const options=await generateAuthenticationOptions({rpID,userVerification:'required',allowCredentials:[]});const flow=randomToken();await env.DB.prepare('INSERT INTO dashboard_auth_challenges(id,challenge,purpose,expires_at) VALUES(?,?,?,?)').bind(await digest(flow),options.challenge,'authentication',now()+300000).run();return json(200,options,{'Set-Cookie':cookie('__Host-brief-flow',flow,300)});
  }
  const rawFlow=cookieValue(request,'__Host-brief-flow');if(!rawFlow||!/^[a-f0-9]{64}$/.test(rawFlow))return json(403,{message:'محاولة الدخول منتهية؛ ابدأ من جديد.'});
  const flow=await digest(rawFlow),challenge=await env.DB.prepare('SELECT * FROM dashboard_auth_challenges WHERE id=? AND used=0 AND expires_at>?').bind(flow,now()).first();if(!challenge)return json(403,{message:'رمز الدخول انتهى أو استُخدم؛ ابدأ من جديد.'});
  if(path==='/auth/register/verify'&&challenge.purpose==='registration'){
   if(!env.SETUP_HASH||challenge.setup_hash!==env.SETUP_HASH||!(Number(env.SETUP_EXPIRES)>now())||typeof body.setupToken!=='string'||await digest(body.setupToken)!==env.SETUP_HASH)return json(403,{message:'رمز إعداد المالك غير صالح.'});
   const result=await verifyRegistrationResponse({response:body.response,expectedChallenge:challenge.challenge,expectedOrigin:env.DASHBOARD_ORIGIN,expectedRPID:rpID,requireUserVerification:true,supportedAlgorithmIDs:[-7]});if(!result.verified)throw Error();
   const credential=result.registrationInfo.credential,handle=Uint8Array.from((await digest('owner:'+env.OWNER_EMAIL)).match(/../g),h=>parseInt(h,16)),userHandle=btoa(String.fromCharCode(...handle)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
   await env.DB.prepare('INSERT INTO dashboard_credentials(id,owner_email,user_handle,public_key,counter,registration_flow,created_at) SELECT ?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM dashboard_credentials) AND EXISTS(SELECT 1 FROM dashboard_auth_challenges WHERE id=? AND used=0 AND expires_at>?)').bind(credential.id,env.OWNER_EMAIL,userHandle,credential.publicKey.slice().buffer,credential.counter,flow,new Date(now()).toISOString(),flow,now()).run();
   const stored=await env.DB.prepare('SELECT id FROM dashboard_credentials WHERE id=? AND registration_flow=?').bind(credential.id,flow).first();if(!stored)return json(409,{message:'تغيرت محاولة التسجيل؛ استخدم تسجيل الدخول أو ابدأ من جديد.'});return json(200,{registered:true},{'Set-Cookie':cookie('__Host-brief-flow','',0)});
  }
  if(path==='/auth/login/verify'&&challenge.purpose==='authentication'){
   const response=body.response;if(typeof response?.id!=='string')throw Error();
   const credential=await env.DB.prepare('SELECT * FROM dashboard_credentials WHERE id=? AND active=1 AND owner_email=?').bind(response.id,env.OWNER_EMAIL).first();if(!credential)throw Error();if(response.response?.userHandle&&response.response.userHandle!==credential.user_handle)throw Error();
   const result=await verifyAuthenticationResponse({response,expectedChallenge:challenge.challenge,expectedOrigin:env.DASHBOARD_ORIGIN,expectedRPID:rpID,requireUserVerification:true,credential:{id:credential.id,publicKey:new Uint8Array(credential.public_key),counter:credential.counter}});if(!result.verified)throw Error();
   const session=randomToken(),sessionHash=await digest(session),time=now();await env.DB.prepare('INSERT INTO dashboard_sessions(token_hash,credential_id,flow_id,expires_at,new_counter,created_at) SELECT ?,c.id,?,?,?,? FROM dashboard_credentials c WHERE c.id=? AND c.counter=? AND c.active=1 AND c.owner_email=? AND EXISTS(SELECT 1 FROM dashboard_auth_challenges WHERE id=? AND used=0 AND expires_at>?)').bind(sessionHash,flow,time+3600000,result.authenticationInfo.newCounter,new Date(time).toISOString(),credential.id,credential.counter,env.OWNER_EMAIL,flow,time).run();
   const stored=await env.DB.prepare('SELECT token_hash FROM dashboard_sessions WHERE token_hash=?').bind(sessionHash).first();if(!stored)return json(409,{message:'محاولة الدخول تغيرت؛ ابدأ تسجيل الدخول مجددًا.'});return json(200,{ok:true},{'Set-Cookie':cookie('__Host-brief-session',session,3600)});
  }
  return json(404,{message:'الطلب غير متاح.'});
 }catch{return json(403,{message:'تعذر التحقق من مفتاح المرور. ابدأ المحاولة من جديد.'});}
}

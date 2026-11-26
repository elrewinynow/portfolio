import {startRegistration,startAuthentication,browserSupportsWebAuthn} from '@simplewebauthn/browser';
const message=document.getElementById('message'),button=document.getElementById('enter');
let setupToken=new URLSearchParams(location.hash.slice(1)).get('setup');
history.replaceState(null,'','/login');
async function post(path,body){const r=await fetch(path,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-Requested-With':'brief-dashboard'},body:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw Error(data.message||'تعذر تسجيل الدخول.');return data;}
async function init(){
 if(!browserSupportsWebAuthn()){message.textContent='المتصفح لا يدعم مفاتيح المرور. افتح الصفحة في متصفح حديث مثل Chrome أو Edge.';return;}
 try{const r=await fetch('/auth/status',{cache:'no-store'});if(!r.ok)throw Error('تعذر التحقق من إعداد الدخول.');const {registered}=await r.json();if(registered)setupToken=null;
 button.textContent=setupToken?'تسجيل مفتاح المالك':'الدخول بمفتاح المرور';button.hidden=false;
 message.textContent=setupToken?'هتسجّل مفتاحك مرة واحدة بالبصمة أو قفل الجهاز. بعد التسجيل هتستخدمه للدخول.':'مساحة خاصة بمالك الموقع. استخدم مفتاح المرور المسجّل لعرض الردود.';
 }catch(e){message.textContent=e.message;}
}
button.addEventListener('click',async()=>{button.disabled=true;try{
 if(setupToken){const optionsJSON=await post('/auth/register/options',{setupToken});const response=await startRegistration({optionsJSON});await post('/auth/register/verify',{setupToken,response});setupToken=null;button.textContent='الدخول بمفتاح المرور';message.textContent='تم تسجيل مفتاحك. اضغط الدخول بمفتاح المرور لفتح الداشبورد.';}
 else{const optionsJSON=await post('/auth/login/options',{});const response=await startAuthentication({optionsJSON});await post('/auth/login/verify',{response});location.replace('/');}
 }catch(e){message.textContent=e.name==='NotAllowedError'?'لم يكتمل تأكيد مفتاح المرور. يمكنك المحاولة مجددًا.':e.message;}finally{button.disabled=false;}});
init();

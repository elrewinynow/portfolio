// Online-only installation. No service worker, response cache or private storage.
const panel=document.getElementById('install-panel'),button=document.getElementById('install-app'),help=document.getElementById('install-help');
let deferred;
const installed=()=>window.matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
const hide=()=>{panel.hidden=true;deferred=null;};
if(installed())hide();
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferred=event;if(!installed()){panel.hidden=false;button.textContent='تثبيت التطبيق';}});
window.addEventListener('appinstalled',hide);
window.matchMedia('(display-mode: standalone)').addEventListener('change',()=>{if(installed())hide();});
button.addEventListener('click',async()=>{
 if(!deferred){help.hidden=!help.hidden;button.setAttribute('aria-expanded',String(!help.hidden));return;}
 const event=deferred;deferred=null;button.disabled=true;
 try{await event.prompt();const {outcome}=await event.userChoice;if(outcome==='accepted')hide();else{button.textContent='طريقة إضافة التطبيق';help.hidden=false;button.setAttribute('aria-expanded','true');}}
 catch{help.hidden=false;button.setAttribute('aria-expanded','true');}
 finally{button.disabled=false;}
});

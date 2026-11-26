import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {handle} from '../dashboard/worker.js';
import {runInNewContext} from 'node:vm';
const root=new URL('../dashboard/public/',import.meta.url);
test('Install assets are public without DB reads; private dashboard routes still require a session',async()=>{
 let reads=0;const env={DB:{prepare(){reads++;throw Error('Unexpected private read');}},OWNER_EMAIL:'owner@example.test',DASHBOARD_ORIGIN:'https://admin.elrewiny.com',ASSETS:{fetch:async request=>new Response(readFileSync(new URL(new URL(request.url).pathname.slice(1),root)))}};
 const manifest=JSON.parse(readFileSync(new URL('manifest.webmanifest',root),'utf8'));assert.equal(manifest.id,'/');assert.equal(manifest.start_url,'/');assert.equal(manifest.scope,'/');assert.equal(manifest.display,'standalone');assert.equal(manifest.dir,'rtl');
 for(const path of ['/manifest.webmanifest','/install.js',...manifest.icons.map(x=>x.src),'/icon-32.png','/icon-180.png']){const r=await handle(new Request(env.DASHBOARD_ORIGIN+path),env);assert.equal(r.status,200,path);assert.equal(r.headers.get('Cache-Control'),'no-store');if(path.endsWith('webmanifest'))assert.match(r.headers.get('Content-Type'),/application\/manifest\+json/);}
 assert.equal(reads,0);
 for(const path of ['/','/app.js','/api/briefs','/api/export.json','/api/export.csv'])assert.equal((await handle(new Request(env.DASHBOARD_ORIGIN+path),env)).status,path==='/'?303:401,path);
 for(const size of [32,180,192,512]){const png=readFileSync(new URL(`icon-${size}.png`,root));assert.equal(png.readUInt32BE(16),size);assert.equal(png.readUInt32BE(20),size);}
});
test('Install UI only prompts on a user click, supports cancellation/fallback and hides in standalone mode',async()=>{
 const script=readFileSync(new URL('install.js',root),'utf8');
 function fixture(standalone=false){const events={},elements=Object.fromEntries(['install-panel','install-app','install-help'].map(id=>[id,{hidden:id==='install-help',attrs:{},setAttribute(k,v){this.attrs[k]=v;},addEventListener(k,v){this[k]=v;}}]));const media={matches:standalone,addEventListener(){}};runInNewContext(script,{window:{matchMedia:()=>media,addEventListener:(k,v)=>events[k]=v},navigator:{},document:{getElementById:id=>elements[id]}});return {events,elements};}
 const {events,elements}=fixture();await elements['install-app'].click();assert.equal(elements['install-help'].hidden,false);
 let prompts=0;events.beforeinstallprompt({preventDefault(){},prompt:async()=>prompts++,userChoice:Promise.resolve({outcome:'dismissed'})});assert.equal(prompts,0);await elements['install-app'].click();assert.equal(prompts,1);assert.equal(elements['install-panel'].hidden,false);assert.equal(elements['install-app'].disabled,false);
 events.appinstalled();assert.equal(elements['install-panel'].hidden,true);assert.equal(fixture(true).elements['install-panel'].hidden,true);
});

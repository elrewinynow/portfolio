// Run only on the owner's computer with an authenticated Wrangler CLI.
// The raw bootstrap token stays in memory and goes to the browser as a fragment.
import http from 'node:http';
import {spawn} from 'node:child_process';
import {randomToken,digest} from './auth.js';
const origin='https://elrewiny-brief-dashboard.mrelrewiny.workers.dev';
const token=randomToken(),expires=Date.now()+3600000;
const child=spawn('powershell.exe',['-NoProfile','-Command','npm.cmd exec --yes --package=wrangler@4.168.0 -- wrangler secret bulk --config dashboard/wrangler.jsonc'],{windowsHide:true,stdio:['pipe','pipe','pipe']});
child.stdin.end(JSON.stringify({SETUP_HASH:await digest(token),SETUP_EXPIRES:String(expires)}));
let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
const exit=await new Promise(resolve=>child.on('exit',resolve));if(exit!==0){console.error('Could not configure setup:',output);process.exit(1);}
const server=http.createServer((req,res)=>{
 if(req.method!=='GET'||req.url!=='/start'||req.headers.host!=='127.0.0.1:3657'){res.writeHead(404);res.end();return;}
 if(Date.now()>=expires){res.writeHead(410);res.end('Setup expired');return;}
 res.writeHead(303,{'Location':origin+'/login#setup='+token,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});res.end();
});
server.listen(3657,'127.0.0.1',()=>console.log('Owner setup ready for one hour: http://127.0.0.1:3657/start'));
const timeout=setTimeout(()=>server.close(),3600000);
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{clearTimeout(timeout);server.close(()=>process.exit(0));});

import {handle} from './worker.js';
// A separate authentication namespace lets the old RP and its existing passkey
// remain usable while the owner enrolls on admin.elrewiny.com. Briefs/reviews
// stay in the same tables. Only these literal SQL identifiers are translated;
// user values remain bound parameters, never part of SQL text.
const authNames=/\bdashboard_(auth_challenges|credentials|sessions|auth_limits|auth_events)\b/g;
export function adminDatabase(db){return {prepare(sql){return db.prepare(sql.replace(authNames,'admin_dashboard_$1'));},batch(statements){return db.batch(statements);}};}
export function adminHandle(request,env,options={}){
 if(new URL(request.url).origin!==env.DASHBOARD_ORIGIN)return new Response('Not Found',{status:404,headers:{'Cache-Control':'no-store'}});
 return handle(request,{...env,DB:adminDatabase(env.DB)},options);
}
export default {fetch:adminHandle};

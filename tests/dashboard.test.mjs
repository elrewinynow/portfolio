import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handle, csvCell } from "../dashboard/worker.js";
import { authenticate } from "../dashboard/auth.js";
import {
  identity,
  binding,
  seed,
  baseSchema,
  adminSchema,
} from "./dashboard-support.mjs";

test('Passkey cryptography, one-time enrollment, origin/UV/signature denial, session expiry and logout',async()=>{
 const db=binding();db.db.exec(baseSchema+adminSchema);const id=await identity(db);
 const request=cookie=>new Request(id.env.DASHBOARD_ORIGIN+'/',{headers:{Cookie:cookie||''}});
 try{
  assert.equal((await id.call('/auth/register/options',{})).status,403);
  assert.equal((await id.call('/auth/register/options',{setupToken:id.setupToken},{Origin:'https://evil.test'})).status,403);
  const registration=await id.options('register');
  assert.equal((await id.call('/auth/register/verify',{setupToken:id.setupToken,response:await id.registration(registration,'https://evil.test')})).status,403);
  assert.equal(db.db.prepare('SELECT count(*) n FROM dashboard_credentials').get().n,0);
  await id.enroll();assert.equal((await id.call('/auth/register/options',{setupToken:id.setupToken})).status,409);
  for(const invalid of [{origin:'https://evil.test'},{challenge:'wrong'},{flags:1},{signature:false}]){
   const o=await id.options('login');assert.equal((await id.call('/auth/login/verify',{response:await id.assertion(o,invalid)})).status,403);
  }
  assert.equal(db.db.prepare('SELECT count(*) n FROM dashboard_sessions').get().n,0);
  const o=await id.options('login'),response=await id.assertion(o),ok=await id.call('/auth/login/verify',{response});assert.equal(ok.status,200);
  const cookie=ok.headers.get('Set-Cookie').split(';')[0];assert.match(ok.headers.get('Set-Cookie'),/Secure; HttpOnly; SameSite=Strict/);
  assert.equal((await id.call('/auth/login/verify',{response})).status,403);
  assert.equal((await authenticate(request(cookie),id.env)).status,200);
  assert.equal((await authenticate(request(cookie+'; '+cookie),id.env)).status,401);
  assert.equal((await authenticate(request('__Host-brief-session='+'0'.repeat(64)),id.env)).status,401);
  assert.equal((await authenticate(request(cookie),{...id.env,OWNER_EMAIL:'other@example.test'})).status,401);
  assert.equal((await authenticate(request(cookie),id.env,{now:()=>Date.now()+3600001})).status,401);
  db.db.exec('UPDATE dashboard_credentials SET active=0');assert.equal((await authenticate(request(cookie),id.env)).status,401);db.db.exec('UPDATE dashboard_credentials SET active=1');
  assert.equal((await id.call('/auth/logout',{}, {Cookie:cookie})).status,200);assert.equal((await authenticate(request(cookie),id.env)).status,401);
  assert.deepEqual(db.db.prepare('SELECT event FROM dashboard_auth_events ORDER BY id').all().map(x=>x.event),['registered','signed_in','session_closed']);
 }finally{db.db.close();}
});

test('Independent DB connections consume an authentication challenge once and deny revocation at write boundary',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'brief-auth-race-')),file=join(dir,'test.sqlite'),a=binding(file),b=binding(file);a.db.exec(baseSchema+adminSchema);
 const id=await identity(a),brief=seed(a.db);await id.enroll();
 try{
  const o=await id.options('login'),response=await id.assertion(o);
  const results=await Promise.all([id.call('/auth/login/verify',{response}),id.call('/auth/login/verify',{response},{},{...id.env,DB:b})]);
  assert.equal(results.filter(r=>r.status===200).length,1);assert.equal(a.db.prepare('SELECT count(*) n FROM dashboard_sessions').get().n,1);
  const cookie=results.find(r=>r.status===200).headers.get('Set-Cookie').split(';')[0];
  const wrapped={prepare(sql){const statement=a.prepare(sql);if(sql.startsWith('INSERT INTO brief_review_commands'))return {bind(...args){statement.bind(...args);return this;},async run(){b.db.exec('UPDATE dashboard_credentials SET active=0');return statement.run();}};return statement;}};
  const r=await handle(new Request(id.env.DASHBOARD_ORIGIN+'/api/briefs/'+brief,{method:'POST',headers:{Cookie:cookie,Origin:id.env.DASHBOARD_ORIGIN,'Content-Type':'application/json','X-Requested-With':'brief-dashboard','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify({status:'reviewing',notes:'race',version:0})}),{...id.env,DB:wrapped});
  assert.equal(r.status,401);assert.equal(a.db.prepare('SELECT count(*) n FROM brief_review_commands').get().n,0);assert.equal(a.db.prepare('SELECT status FROM brief_submissions').get().status,'new');
 }finally{a.db.close();b.db.close();rmSync(dir,{recursive:true,force:true});}
});

test("Dashboard authentication, filters, details, CSV, immutable history, rollback and replay", async () => {
  const db = binding();
  db.db.exec(baseSchema + adminSchema);
  const first = seed(db.db),
    second = seed(db.db, undefined, 1),
    id = await identity(db),
    token = await id.sign();
  let assets = 0;
  const env = {
    ...id.env,
    DB: db,
    ASSETS: {
      fetch: async () => {
        assets++;
        return new Response("private asset");
      },
    },
  };
  const req = (path, options = {}, jwt = token) =>
    handle(
      new Request("https://dashboard.example" + path, {
        ...options,
        headers: {
          ...(jwt ? { "Cookie": jwt } : {}),
          ...options.headers,
        },
      }),
      env,
      { fetchKeys: id.fetchKeys },
    );
  const post = (
    key = crypto.randomUUID(),
    body = { status: "reviewing", notes: "ملاحظات خاصة", version: 0 },
    extra = {},
  ) =>
    req("/api/briefs/" + first, {
      method: "POST",
      headers: {
        Origin: "https://dashboard.example",
        "Content-Type": "application/json",
        "X-Requested-With": "brief-dashboard",
        "Idempotency-Key": key,
        ...extra,
      },
      body: JSON.stringify(body),
    });
  try {
    for (const path of [
      "/",
      "/app.js",
      "/api/session",
      "/api/briefs",
      "/api/briefs/" + first,
      "/api/export.csv",
    ])
      assert.equal((await req(path, {}, null)).status, path === "/" ? 303 : 401, path);
    assert.equal(assets, 0);
    assert.equal((await req("/")).status, 200);
    assert.equal(assets, 1);
    assert.equal(
      (
        await req("/api/briefs", { headers: { Origin: "https://evil.test" } })
      ).headers.get("Access-Control-Allow-Origin"),
      null,
    );
    let body = await (await req("/api/briefs")).json();
    assert.equal(body.rows.length, 2);
    assert.equal(body.counts[0].count, 2);
    assert.ok(!("answers_json" in body.rows[0]));
    assert.equal((await req("/api/briefs?status=invalid")).status, 400);
    assert.equal((await req("/api/briefs?cursor=invalid")).status, 400);
    assert.equal(
      (await (await req("/api/briefs?q=synthetic")).json()).rows.length,
      2,
    );
    assert.equal(
      (await (await req("/api/briefs?q=%27%20OR%201%3D1")).json()).rows.length,
      0,
    );
    const detail = await (await req("/api/briefs/" + first)).json();
    assert.equal(detail.version, 0);
    assert.equal(detail.answers.offering, "خدمة تدريب");
    assert.equal(detail.notes, "");
    assert.equal(
      (await post(undefined, undefined, { Origin: "https://evil.test" }))
        .status,
      403,
    );
    assert.equal(
      (
        await post(undefined, {
          status: "reviewing",
          notes: "x",
          version: 0,
          actor_email: "intruder",
        })
      ).status,
      422,
    );
    assert.equal(
      (await post(undefined, { status: "bad", notes: "x", version: 0 })).status,
      422,
    );
    assert.equal(
      (
        await post(undefined, {
          status: "new",
          notes: "x".repeat(8001),
          version: 0,
        })
      ).status,
      422,
    );
    db.db.exec(
      "CREATE TRIGGER synthetic_abort AFTER UPDATE ON brief_submissions BEGIN SELECT RAISE(ABORT,'test failure'); END;",
    );
    const key = crypto.randomUUID();
    assert.equal((await post(key)).status, 503);
    assert.equal(
      db.db.prepare("SELECT count(*) n FROM brief_reviews").get().n,
      0,
    );
    assert.equal(
      db.db.prepare("SELECT count(*) n FROM brief_review_commands").get().n,
      0,
    );
    assert.equal(
      db.db
        .prepare("SELECT status FROM brief_submissions WHERE id=?")
        .get(first).status,
      "new",
    );
    db.db.exec("DROP TRIGGER synthetic_abort");
    assert.equal((await post(key)).status, 200);
    assert.equal((await post(key)).status, 200);
    assert.equal(
      db.db.prepare("SELECT count(*) n FROM brief_review_commands").get().n,
      1,
    );
    assert.equal(
      (await post(key, { status: "reviewed", notes: "different", version: 0 }))
        .status,
      409,
    );
    assert.equal((await post()).status, 409);
    const row = db.db.prepare("SELECT * FROM brief_review_commands").get();
    assert.equal(row.actor_email, id.env.OWNER_EMAIL);
    assert.equal(row.actor_sub, id.id);
    assert.equal(row.before_status, "new");
    assert.equal(row.after_status, "reviewing");
    assert.equal(row.result_version, 1);
    assert.throws(
      () => db.db.exec("UPDATE brief_review_commands SET notes='changed'"),
      /APPEND_ONLY/,
    );
    assert.throws(
      () => db.db.exec("DELETE FROM brief_review_commands"),
      /APPEND_ONLY/,
    );
    assert.equal(
      (await (await req("/api/briefs?status=reviewing")).json()).rows.length,
      1,
    );
    const csv = await req("/api/export.csv");
    assert.equal(csv.headers.get("Content-Type"), "text/csv; charset=utf-8");
    assert.ok((await csv.text()).includes("ملاحظات خاصة"));
    for (const value of [
      '=HYPERLINK("evil")',
      "+1",
      "-1",
      "@SUM(A1)",
      "\tcmd",
      "  =SUM(1)",
    ])
      assert.ok(csvCell(value).startsWith("\"'"));
    assert.equal(csvCell('normal "quoted"'), '"normal ""quoted"""');
    const original = JSON.parse(
      db.db
        .prepare("SELECT answers_json FROM brief_submissions WHERE id=?")
        .get(first).answers_json,
    );
    assert.equal(original.offering, "خدمة تدريب");
  } finally {
    db.db.close();
  }
});

test("Independent dashboard DB sessions reject stale writes and preserve a single replay result", async () => {
  const dir = mkdtempSync(join(tmpdir(), "brief-review-race-")),
    file = join(dir, "test.sqlite"),
    a = binding(file),
    b = binding(file);
  a.db.exec(baseSchema + adminSchema);
  const brief = seed(a.db),
    id = await identity(a),
    token = await id.sign();
  const post = (db, key, notes) =>
    handle(
      new Request("https://dashboard.example/api/briefs/" + brief, {
        method: "POST",
        headers: {
          "Cookie": token,
          Origin: "https://dashboard.example",
          "Content-Type": "application/json",
          "X-Requested-With": "brief-dashboard",
          "Idempotency-Key": key,
        },
        body: JSON.stringify({ status: "reviewing", notes, version: 0 }),
      }),
      { ...id.env, DB: db },
      { fetchKeys: id.fetchKeys },
    );
  try {
    const keys = [crypto.randomUUID(), crypto.randomUUID()];
    const results = await Promise.all([
      post(a, keys[0], "first"),
      post(b, keys[1], "second"),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    assert.equal(
      a.db.prepare("SELECT count(*) n FROM brief_review_commands").get().n,
      1,
    );
    assert.equal(
      a.db.prepare("SELECT version FROM brief_reviews").get().version,
      1,
    );
    const winning = results.findIndex((r) => r.status === 200);
    const replay = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        post(i % 2 ? a : b, keys[winning], winning ? "second" : "first"),
      ),
    );
    assert.ok(replay.every((r) => r.status === 200));
    assert.equal(
      a.db.prepare("SELECT count(*) n FROM brief_review_commands").get().n,
      1,
    );
  } finally {
    a.db.close();
    b.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

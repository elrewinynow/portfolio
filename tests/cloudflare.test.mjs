import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handle } from "../cloudflare/worker.js";
const schema = readFileSync(
  new URL("../cloudflare/schema.sql", import.meta.url),
  "utf8",
);
const answers = {
  brand: "اختبار D1",
  contactName: "بيانات اصطناعية",
  email: "cloudflare-test@example.test",
  offering: "خدمة",
  challenge: "ترتيب",
  goals: ["ترتيب الأولويات"],
};
// D1 contract adapter over real SQLite: production SQL/triggers, no fake rows.
function binding(path) {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA busy_timeout=5000");
  return {
    db,
    prepare(sql) {
      let values = [];
      return {
        bind(...v) {
          values = v;
          return this;
        },
        async first() {
          return db.prepare(sql).get(...values) || null;
        },
        async run() {
          const r = db.prepare(sql).run(...values);
          return { success: true, meta: { changes: Number(r.changes) } };
        },
      };
    },
    async batch(statements) {
      db.exec("BEGIN IMMEDIATE");
      try {
        const out = [];
        for (const stmt of statements) out.push(await stmt.run());
        db.exec("COMMIT");
        return out;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
  };
}
test("Worker + real SQLite: durable writes, idempotency, challenge binding, rollback, quotas and CORS", async () => {
  const dir = mkdtempSync(join(tmpdir(), "brief-d1-")),
    path = join(dir, "test.sqlite"),
    a = binding(path),
    b = binding(path);
  a.db.exec(schema);
  let now = Date.now(),
    token,
    key = crypto.randomUUID();
  const call = (pathname, init = {}, env = { DB: a }, ip = "192.0.2.1") =>
    handle(
      new Request("https://api.example" + pathname, {
        ...init,
        headers: {
          Origin: "https://elrewiny.com",
          "CF-Connecting-IP": ip,
          ...init.headers,
        },
      }),
      env,
      { now },
    );
  const challenge = async (ip = "192.0.2.1") => {
    const r = await call("/api/brief/challenge", {}, undefined, ip);
    assert.equal(r.status, 200);
    const t = (await r.json()).token;
    now += 3100;
    return t;
  };
  const post = (
    data = answers,
    k = key,
    t = token,
    env = { DB: a },
    ip = "192.0.2.1",
    extra = {},
  ) =>
    call(
      "/api/brief",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": k },
        body: JSON.stringify({
          answers: data,
          token: t,
          website_confirm: "",
          ...extra,
        }),
      },
      env,
      ip,
    );
  try {
    token = await challenge();
    assert.equal(
      (
        await call("/api/brief/challenge", {
          headers: { Origin: "https://evil.example" },
        })
      ).status,
      403,
    );
    assert.equal((await call("/healthz")).status, 200);
    assert.equal((await call("/api/briefs")).status, 404);
    assert.equal((await call("/")).status, 404);
    assert.equal((await post({ ...answers, email: "bad" })).status, 422);
    assert.equal(
      (await post(answers, key, token, undefined, "192.0.2.2")).status,
      403,
    );
    assert.equal(
      (
        await post(answers, key, token, undefined, undefined, {
          website_confirm: "bot",
        })
      ).status,
      403,
    );
    assert.equal((await post(answers, key, "0".repeat(64))).status, 403);
    assert.equal(
      (await post({ ...answers, notes: "a".repeat(33000) })).status,
      413,
    );
    const pre = await call("/api/brief", {
      method: "OPTIONS",
      headers: {
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "Content-Type,Idempotency-Key",
      },
    });
    assert.equal(pre.status, 204);
    assert.equal(
      pre.headers.get("Access-Control-Allow-Origin"),
      "https://elrewiny.com",
    );
    const quota = await call(
      "/api/brief/challenge",
      {},
      {
        DB: {
          prepare() {
            throw Error("quota exhausted");
          },
        },
      },
    );
    assert.equal(quota.status, 503);
    assert.equal((await quota.json()).id, undefined);
    a.db.exec(
      "CREATE TRIGGER test_abort AFTER INSERT ON brief_submissions BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;",
    );
    assert.equal((await post()).status, 503);
    assert.equal(
      a.db.prepare("SELECT count(*) n FROM brief_submissions").get().n,
      0,
    );
    assert.equal(
      a.db
        .prepare(
          "SELECT count(*) n FROM brief_limits WHERE bucket LIKE 'accepted:%'",
        )
        .get().n,
      0,
    );
    a.db.exec("DROP TRIGGER test_abort");
    const race = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        post(answers, key, token, { DB: i % 2 ? a : b }),
      ),
    );
    assert.equal(race.filter((r) => r.status === 201).length, 1);
    assert.equal(race.filter((r) => r.status === 200).length, 9);
    const ids = await Promise.all(race.map((r) => r.json()));
    assert.equal(new Set(ids.map((r) => r.id)).size, 1);
    assert.equal(
      a.db.prepare("SELECT count(*) n FROM brief_submissions").get().n,
      1,
    );
    assert.equal(
      (await post({ ...answers, challenge: "different" })).status,
      409,
    );
    assert.equal((await post(answers, crypto.randomUUID())).status, 403);
    for (let i = 0; i < 4; i++) {
      const t = await challenge();
      assert.equal((await post(answers, crypto.randomUUID(), t)).status, 201);
    }
    const t = await challenge();
    assert.equal((await post(answers, crypto.randomUUID(), t)).status, 429);
    assert.equal((await post()).status, 200);
    assert.equal(
      a.db.prepare("SELECT count(*) n FROM brief_submissions").get().n,
      5,
    );
    const row = a.db.prepare("SELECT * FROM brief_submissions LIMIT 1").get();
    assert.equal(row.status, "new");
    assert.equal(JSON.parse(row.answers_json).brand, answers.brand);
    assert.ok(row.submitted_at);
    assert.notEqual(row.token_hash, token);
    now += 3 * 3600000;
    assert.equal((await post()).status, 403);
    const fresh = await challenge();
    assert.equal((await post(answers, key, fresh)).status, 200);
  } finally {
    a.db.close();
    b.db.close();
    const reopened = binding(path);
    assert.equal(
      reopened.db.prepare("SELECT count(*) n FROM brief_submissions").get().n,
      5,
    );
    reopened.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

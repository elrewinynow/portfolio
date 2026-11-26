import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { fork } from "node:child_process";
import { once } from "node:events";
import { createApp } from "../server/server.mjs";
import { validate } from "../Brief/schema.js";
const answers = {
  brand: "نشاط تجريبي",
  contactName: "اختبار فقط",
  email: "synthetic@example.test",
  offering: "خدمة استشارات",
  challenge: "استفسارات قليلة",
  goals: ["ترتيب الأولويات"],
};
test("validation: required, contact, options, goals, links and service businesses", () => {
  assert.deepEqual(validate(answers).errors, {});
  for (const change of [
    { email: "", phone: "" },
    { email: "bad" },
    { phone: "abc" },
    { goals: ["ترتيب الأولويات", "تحسين التحويل", "تحسين المحتوى"] },
    { stage: "invalid" },
    { links: "javascript:alert(1)" },
    { references: "https://user:pass@example.com" },
    { brand: "" },
    { goals: ["هدف آخر"] },
    { sector: "مجال آخر" },
    { goals: "text" },
    { notes: 45 },
  ])
    assert.ok(
      Object.keys(validate({ ...answers, ...change }).errors).length,
      JSON.stringify(change),
    );
  assert.equal(
    validate({ ...answers, email: "", phone: "٠١٠١٢٣٤٥٦٧٨" }).data.phone,
    "01012345678",
  );
  assert.deepEqual(
    validate({ ...answers, email: "", phone: "٠١٠١٢٣٤٥٦٧٨" }).errors,
    {},
  );
});
test("HTTP persistence, replay, concurrent duplicate, privacy, errors and rate limits", async () => {
  const dir = mkdtempSync(join(tmpdir(), "brief-test-"));
  let now = Date.now();
  const opts = {
    dbPath: join(dir, "test.sqlite"),
    secret: "test-only-secret-at-least-32-chars",
    origin: "http://127.0.0.1:3000",
    clock: () => now,
  };
  let app = createApp(opts);
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  let base = `http://127.0.0.1:${app.server.address().port}`;
  const getToken = async () =>
    (await (await fetch(base + "/api/brief/challenge")).json()).token;
  let token = await getToken();
  const key = randomUUID();
  const send = (a = answers, k = key, extra = {}, headers = {}) =>
    fetch(base + "/api/brief", {
      method: "POST",
      headers: {
        Origin: opts.origin,
        "Content-Type": "application/json",
        "Idempotency-Key": k,
        ...headers,
      },
      body: JSON.stringify({
        answers: a,
        token,
        website_confirm: "",
        ...extra,
      }),
    });
  try {
    assert.equal((await send()).status, 403);
    now += 4000;
    assert.equal(
      (await send(answers, key, {}, { Origin: "https://evil.example" })).status,
      403,
    );
    assert.equal(
      (await send(answers, key, { website_confirm: "bot" })).status,
      403,
    );
    assert.equal(
      (await send(answers, key, { token: token + "x" })).status,
      403,
    );
    assert.equal((await send({ ...answers, email: "invalid" })).status, 422);
    assert.equal(
      (await send(answers, key, {}, { "Content-Type": "text/plain" })).status,
      415,
    );
    const malformed = await fetch(base + "/api/brief", {
      method: "POST",
      headers: { Origin: opts.origin, "Content-Type": "application/json" },
      body: "{",
    });
    assert.equal(malformed.status, 400);
    assert.equal(
      (await send({ ...answers, notes: "x".repeat(33000) })).status,
      413,
    );
    app.db.exec(
      "CREATE TRIGGER test_failure BEFORE INSERT ON brief_submissions BEGIN SELECT RAISE(ABORT,'test rollback'); END;",
    );
    assert.equal((await send()).status, 500);
    assert.equal(
      app.db.prepare("SELECT count(*) n FROM brief_submissions").get().n,
      0,
    );
    app.db.exec("DROP TRIGGER test_failure");
    const concurrent = await Promise.all([send(), send(), send()]);
    assert.deepEqual(concurrent.map((r) => r.status).sort(), [200, 200, 201]);
    const receipts = await Promise.all(concurrent.map((r) => r.json()));
    assert.equal(new Set(receipts.map((r) => r.id)).size, 1);
    assert.equal(
      (await send({ ...answers, challenge: "different" })).status,
      409,
    );
    assert.equal(
      app.db.prepare("SELECT count(*) n FROM brief_submissions").get().n,
      1,
    );
    const stored = app.db.prepare("SELECT * FROM brief_submissions").get();
    assert.equal(stored.status, "new");
    assert.equal(JSON.parse(stored.answers_json).brand, answers.brand);
    assert.ok(stored.submitted_at);
    for (const path of [
      "/server/server.mjs",
      "/data/briefs.sqlite",
      "/.env",
      "/tests/brief.test.mjs",
      "/api/briefs",
    ])
      assert.ok((await fetch(base + path)).status >= 400, path);
    for (const path of [
      "/",
      "/Brief",
      "/Brief/",
      "/Brief/brief.js",
      "/Brief/schema.js",
      "/terms.html",
      "/refund-policy.html",
      "/business-info.html",
    ])
      assert.equal((await fetch(base + path)).status, 200, path);
    assert.equal(
      (await fetch(base + "/")).headers.get("content-security-policy"),
      null,
    );
    for (let i = 0; i < 4; i++)
      assert.equal((await send(answers, randomUUID())).status, 201);
    assert.equal((await send(answers, randomUUID())).status, 429);
    assert.equal((await send()).status, 200);
    assert.equal(
      app.db.prepare("SELECT count(*) n FROM brief_submissions").get().n,
      5,
    );
    await app.close();
    app = createApp(opts);
    await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${app.server.address().port}`;
    assert.equal(
      app.db.prepare("SELECT count(*) n FROM brief_submissions").get().n,
      5,
    );
    assert.equal((await send()).status, 200);
    now += 3 * 3600000;
    assert.equal((await send()).status, 403);
    token = await getToken();
    now += 4000;
    assert.equal((await send()).status, 200);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("independent database sessions serialize the same request key", async () => {
  const dir = mkdtempSync(join(tmpdir(), "brief-race-")),
    dbPath = join(dir, "race.sqlite"),
    children = [];
  try {
    const bases = [];
    for (let i = 0; i < 2; i++) {
      const child = fork(
        new URL("./server-process.mjs", import.meta.url),
        [dbPath],
        { stdio: ["ignore", "ignore", "inherit", "ipc"] },
      );
      children.push(child);
      const [{ port }] = await once(child, "message");
      bases.push(`http://127.0.0.1:${port}`);
    }
    const token = (
        await (await fetch(bases[0] + "/api/brief/challenge")).json()
      ).token,
      key = randomUUID();
    const responses = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        fetch(bases[i % 2] + "/api/brief", {
          method: "POST",
          headers: {
            Origin: "http://127.0.0.1:3000",
            "Content-Type": "application/json",
            "Idempotency-Key": key,
          },
          body: JSON.stringify({ answers, token, website_confirm: "" }),
        }),
      ),
    );
    assert.equal(responses.filter((r) => r.status === 201).length, 1);
    assert.equal(responses.filter((r) => r.status === 200).length, 9);
    const results = await Promise.all(responses.map((r) => r.json()));
    assert.equal(new Set(results.map((r) => r.id)).size, 1);
  } finally {
    await Promise.all(
      children.map(async (c) => {
        const exit = once(c, "exit");
        c.send("close");
        await exit;
      }),
    );
    rmSync(dir, { recursive: true, force: true });
  }
});

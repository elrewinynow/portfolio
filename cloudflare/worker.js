import { validate } from "../Brief/schema.js";
const ORIGIN = "https://elrewiny.com";
const message =
  "خدمة الإرسال مش متاحة مؤقتًا. إجاباتك لسه موجودة؛ جرّب تاني بعد شوية.";
const encoder = new TextEncoder();
const digest = async (value) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", encoder.encode(value)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
const randomToken = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
async function limited(db, bucket, max, expires) {
  const row = await db
    .prepare(
      "INSERT INTO brief_limits(bucket,count,expires_at) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=count+1 RETURNING count",
    )
    .bind(bucket, expires)
    .first();
  return row.count > max;
}
export async function handle(
  request,
  env,
  { now = Date.now(), minAge = 3000 } = {},
) {
  const path = new URL(request.url).pathname;
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    Vary: "Origin",
  };
  if (request.headers.get("Origin") === ORIGIN) {
    headers["Access-Control-Allow-Origin"] = ORIGIN;
    headers["Access-Control-Expose-Headers"] = "Retry-After";
  }
  const json = (status, body, extra = {}) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...headers, ...extra },
    });
  const denied = () =>
    json(403, { message: "افتح النموذج من رابط الموقع الأصلي." });
  try {
    if (path === "/api/brief" && request.method === "OPTIONS") {
      const wanted = (
        request.headers.get("Access-Control-Request-Headers") || ""
      )
        .toLowerCase()
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
      if (
        request.headers.get("Origin") !== ORIGIN ||
        request.headers.get("Access-Control-Request-Method") !== "POST" ||
        wanted.some((x) => !["content-type", "idempotency-key"].includes(x))
      )
        return denied();
      return new Response(null, {
        status: 204,
        headers: {
          ...headers,
          "Access-Control-Allow-Methods": "POST",
          "Access-Control-Allow-Headers": "Content-Type, Idempotency-Key",
          "Access-Control-Max-Age": "600",
        },
      });
    }
    if (path === "/healthz" && request.method === "GET") {
      if (!env.DB) return json(503, { status: "unavailable" });
      await env.DB.prepare(
        "SELECT schema_version FROM brief_submissions LIMIT 1",
      ).first();
      return json(200, { status: "ok" });
    }
    const challenge =
      path === "/api/brief/challenge" && request.method === "GET";
    const submit = path === "/api/brief" && request.method === "POST";
    if (!challenge && !submit) return json(404, { message: "الطلب غير متاح." });
    if (request.headers.get("Origin") !== ORIGIN) return denied();
    // This entrypoint is deployed directly on workers.dev. Cloudflare supplies this
    // header; X-Forwarded-For and identity fields supplied in JSON are never used.
    const ip = request.headers.get("CF-Connecting-IP");
    if (!ip || !env.DB) return json(503, { message });
    let salt = await env.DB.prepare(
      "SELECT value FROM brief_settings WHERE name='ip_salt'",
    ).first();
    if (!salt) {
      await env.DB.prepare(
        "INSERT OR IGNORE INTO brief_settings(name,value) VALUES('ip_salt',?)",
      )
        .bind(randomToken())
        .run();
      salt = await env.DB.prepare(
        "SELECT value FROM brief_settings WHERE name='ip_salt'",
      ).first();
    }
    const ipHash = await digest(`${salt.value}:${ip}`),
      hour = Math.floor(now / 3600000),
      day = Math.floor(now / 86400000),
      period = Math.floor(now / 600000);
    const tooMany = () =>
      json(
        429,
        { message: "وصلت للحد المتاح للإرسال. استنى شوية وحاول تاني." },
        { "Retry-After": "3600" },
      );
    if (challenge) {
      if (
        (await limited(
          env.DB,
          `challenge:${ipHash}:${hour}`,
          30,
          (hour + 1) * 3600000,
        )) ||
        (await limited(
          env.DB,
          `challenge-day:${day}`,
          1000,
          (day + 1) * 86400000,
        ))
      )
        return tooMany();
      const token = randomToken(),
        hash = await digest(token);
      await env.DB.batch([
        env.DB.prepare("DELETE FROM brief_limits WHERE expires_at<?").bind(now),
        env.DB.prepare("DELETE FROM brief_challenges WHERE expires_at<?").bind(
          now,
        ),
        env.DB.prepare("INSERT INTO brief_challenges VALUES(?,?,?,?)").bind(
          hash,
          ipHash,
          now,
          now + 7200000,
        ),
      ]);
      return json(200, {
        token,
        readyAt: now + minAge,
        expiresAt: now + 7200000,
      });
    }
    if (
      (await limited(
        env.DB,
        `attempt:${ipHash}:${period}`,
        30,
        (period + 1) * 600000,
      )) ||
      (await limited(env.DB, `attempt-day:${day}`, 3000, (day + 1) * 86400000))
    )
      return tooMany();
    if (
      !/^application\/json(?:;|$)/i.test(
        request.headers.get("Content-Type") || "",
      )
    )
      return json(415, { message: "صيغة الإرسال غير مدعومة." });
    const reader = request.body?.getReader();
    let size = 0,
      chunks = [];
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 32768) {
          await reader.cancel();
          return json(413, {
            message: "حجم الإجابات كبير؛ اختصرها وحاول تاني.",
          });
        }
        chunks.push(value);
      }
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    let body;
    try {
      body = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return json(400, { message: "بيانات الإرسال غير صحيحة." });
    }
    const key = request.headers.get("Idempotency-Key");
    if (
      !key ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        key,
      )
    )
      return json(400, { message: "معرف الإرسال غير صالح." });
    if (
      !body ||
      body.website_confirm !== "" ||
      typeof body.token !== "string" ||
      !/^[0-9a-f]{64}$/.test(body.token)
    )
      return json(403, {
        message: "تعذر التحقق من الإرسال. حاول تاني بعد لحظات.",
      });
    const { data, errors } = validate(body.answers);
    if (Object.keys(errors).length)
      return json(422, { message: Object.values(errors).join(" "), errors });
    const hash = await digest(body.token);
    const valid = await env.DB.prepare(
      "SELECT token_hash FROM brief_challenges WHERE token_hash=? AND ip_hash=? AND issued_at<=? AND expires_at>?",
    )
      .bind(hash, ipHash, now - minAge, now)
      .first();
    if (!valid)
      return json(403, {
        message: "انتهت صلاحية التحقق أو لسه مش جاهز. حاول تاني بعد لحظات.",
      });
    const intent = await digest(JSON.stringify(data)),
      prior = await env.DB.prepare(
        "SELECT id,intent_hash FROM brief_submissions WHERE request_key=?",
      )
        .bind(key)
        .first();
    const replay = (p) =>
      p.intent_hash === intent
        ? json(200, { id: p.id })
        : json(409, {
            message:
              "الإرسال ده محفوظ بإجابات مختلفة. افتح نموذج جديد لبريف تاني.",
          });
    if (prior) return replay(prior);
    const id = crypto.randomUUID();
    try {
      // One SQLite statement and its triggers atomically commit the submission and
      // accepted counters. The uniqueness guards serialize different Worker isolates.
      await env.DB.prepare(
        `INSERT INTO brief_submissions(id,request_key,intent_hash,submitted_at,brand,contact_name,phone,email,answers_json,token_hash,ip_bucket,day_bucket,bucket_expires_at)
    SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM brief_submissions WHERE request_key=?)`,
      )
        .bind(
          id,
          key,
          intent,
          new Date(now).toISOString(),
          data.brand,
          data.contactName,
          data.phone || null,
          data.email || null,
          JSON.stringify(data),
          hash,
          `accepted:${ipHash}:${hour}`,
          `accepted-day:${day}`,
          (day + 1) * 86400000,
          key,
        )
        .run();
    } catch (error) {
      const durable = await env.DB.prepare(
        "SELECT id,intent_hash FROM brief_submissions WHERE request_key=?",
      )
        .bind(key)
        .first();
      if (durable) return replay(durable);
      if (String(error).includes("BRIEF_RATE_LIMIT")) return tooMany();
      if (
        String(error).includes(
          "UNIQUE constraint failed: brief_submissions.token_hash",
        )
      )
        return json(403, {
          message: "تم استخدام رمز الإرسال. حاول تاني للحصول على رمز جديد.",
        });
      throw error;
    }
    const result = await env.DB.prepare(
      "SELECT id,intent_hash FROM brief_submissions WHERE request_key=?",
    )
      .bind(key)
      .first();
    if (!result) throw Error("No durable result");
    if (result.intent_hash !== intent) return replay(result);
    return json(result.id === id ? 201 : 200, { id: result.id });
  } catch {
    return json(503, { message });
  }
}
export default { fetch: handle };

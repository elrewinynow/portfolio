import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import {
  randomBytes,
  randomUUID,
  createHmac,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { mkdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { validate } from "../Brief/schema.js";
const root = fileURLToPath(new URL("../", import.meta.url));
export function createApp({
  dbPath = resolve(root, "data/briefs.sqlite"),
  secret = randomBytes(32).toString("hex"),
  origin = "http://127.0.0.1:3000",
  minAge = 3000,
  clock = () => Date.now(),
} = {}) {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS brief_submissions(id TEXT PRIMARY KEY,request_key TEXT NOT NULL UNIQUE,intent_hash TEXT NOT NULL,submitted_at TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','reviewing','reviewed','archived')),schema_version INTEGER NOT NULL DEFAULT 1,brand TEXT NOT NULL,contact_name TEXT NOT NULL,phone TEXT,email TEXT,answers_json TEXT NOT NULL CHECK(json_valid(answers_json)));
 CREATE INDEX IF NOT EXISTS briefs_status_date ON brief_submissions(status,submitted_at);
 CREATE TABLE IF NOT EXISTS request_limits(bucket TEXT PRIMARY KEY,count INTEGER NOT NULL,expires_at INTEGER NOT NULL);`);
  const mac = (v) => createHmac("sha256", secret).update(v).digest("base64url");
  function limit(kind, identity, max, window) {
    const now = clock(),
      period = Math.floor(now / window),
      bucket = mac(`${kind}:${identity}:${period}`);
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("DELETE FROM request_limits WHERE expires_at < ?").run(now);
      db.prepare(
        "INSERT INTO request_limits VALUES (?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=count+1",
      ).run(bucket, (period + 1) * window);
      const { count } = db
        .prepare("SELECT count FROM request_limits WHERE bucket=?")
        .get(bucket);
      db.exec("COMMIT");
      return count <= max;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  function validToken(t) {
    if (typeof t !== "string" || t.length > 250) return false;
    const [stamp, nonce, sig, ...extra] = t.split(".");
    if (extra.length || !stamp || !nonce || !sig) return false;
    const expected = mac(`${stamp}.${nonce}`),
      a = Buffer.from(sig),
      b = Buffer.from(expected);
    const age = clock() - Number(stamp);
    return (
      a.length === b.length &&
      timingSafeEqual(a, b) &&
      age >= minAge &&
      age < 2 * 60 * 60 * 1000
    );
  }
  const json = (res, status, body) => {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(body));
  };
  const server = http.createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    try {
      const path = new URL(req.url, origin).pathname,
        ip = req.socket.remoteAddress || "unknown";
      if (path.startsWith("/Brief") || path.startsWith("/api/"))
        res.setHeader(
          "Content-Security-Policy",
          "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
        );
      if (path === "/api/brief/challenge" && req.method === "GET") {
        if (!limit("challenge", ip, 60, 3600000)) {
          res.setHeader("Retry-After", "3600");
          return json(res, 429, {
            message: "طلبات كتير في وقت قصير؛ جرّب بعد شوية.",
          });
        }
        const value = `${clock()}.${randomBytes(16).toString("hex")}`;
        return json(res, 200, { token: `${value}.${mac(value)}` });
      }
      if (path === "/api/brief" && req.method === "POST") {
        if (req.headers.origin !== origin)
          return json(res, 403, {
            message: "افتح النموذج من رابط الموقع الأصلي.",
          });
        if (!limit("attempt", ip, 30, 600000)) {
          res.setHeader("Retry-After", "600");
          return json(res, 429, {
            message: "محاولات كتير؛ استنى ١٠ دقائق وحاول تاني.",
          });
        }
        if (
          !/^application\/json(?:;|$)/i.test(req.headers["content-type"] || "")
        )
          return json(res, 415, { message: "صيغة الإرسال غير مدعومة." });
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 32768)
            return json(res, 413, {
              message: "حجم الإجابات كبير؛ اختصرها وحاول تاني.",
            });
          chunks.push(chunk);
        }
        const raw = Buffer.concat(chunks).toString("utf8");
        let body;
        try {
          body = JSON.parse(raw);
        } catch {
          return json(res, 400, { message: "بيانات الإرسال غير صحيحة." });
        }
        if (
          !body ||
          typeof body !== "object" ||
          body.website_confirm !== "" ||
          !validToken(body.token)
        )
          return json(res, 403, {
            message: "تعذر التحقق من الإرسال. جرّب تاني بعد لحظات.",
          });
        const key = req.headers["idempotency-key"];
        if (
          typeof key !== "string" ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            key,
          )
        )
          return json(res, 400, { message: "معرف الإرسال غير صالح." });
        const { data, errors } = validate(body.answers);
        if (Object.keys(errors).length)
          return json(res, 422, {
            message: Object.values(errors).join(" "),
            errors,
          });
        const intent = createHash("sha256")
          .update(JSON.stringify(data))
          .digest("hex");
        // All durable business effects and the replay result commit together.
        db.exec("BEGIN IMMEDIATE");
        let result;
        try {
          const prior = db
            .prepare(
              "SELECT id,intent_hash FROM brief_submissions WHERE request_key=?",
            )
            .get(key);
          if (prior) {
            db.exec("COMMIT");
            return json(
              res,
              prior.intent_hash === intent ? 200 : 409,
              prior.intent_hash === intent
                ? { id: prior.id }
                : {
                    message:
                      "الإرسال ده محفوظ بإجابات مختلفة. افتح نموذج جديد لو محتاج تبعت بريف تاني.",
                  },
            );
          }
          const now = clock(),
            bucket = mac(`accepted:${ip}:${Math.floor(now / 3600000)}`);
          db.prepare(
            "INSERT INTO request_limits VALUES (?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=count+1",
          ).run(bucket, (Math.floor(now / 3600000) + 1) * 3600000);
          if (
            db
              .prepare("SELECT count FROM request_limits WHERE bucket=?")
              .get(bucket).count > 5
          ) {
            db.exec("ROLLBACK");
            res.setHeader("Retry-After", "3600");
            return json(res, 429, {
              message: "وصلت للحد المتاح للإرسال. حاول بعد ساعة.",
            });
          }
          result = randomUUID();
          db.prepare(
            "INSERT INTO brief_submissions(id,request_key,intent_hash,submitted_at,brand,contact_name,phone,email,answers_json) VALUES (?,?,?,?,?,?,?,?,?)",
          ).run(
            result,
            key,
            intent,
            new Date(now).toISOString(),
            data.brand,
            data.contactName,
            data.phone || null,
            data.email || null,
            JSON.stringify(data),
          );
          db.exec("COMMIT");
        } catch (e) {
          db.exec("ROLLBACK");
          throw e;
        }
        return json(res, 201, { id: result });
      }
      if (path.startsWith("/api/"))
        return json(res, 405, { message: "الطلب غير متاح." });
      if (!["GET", "HEAD"].includes(req.method))
        return json(res, 405, { message: "الطلب غير متاح." });
      const files = {
        "/": "index.html",
        "/Brief": "Brief/index.html",
        "/Brief/": "Brief/index.html",
        "/Brief/index.html": "Brief/index.html",
        "/Brief/brief.js": "Brief/brief.js",
        "/Brief/schema.js": "Brief/schema.js",
        "/Brief/brief.css": "Brief/brief.css",
        "/style.css": "style.css",
        "/script.js": "script.js",
        "/terms.html": "terms.html",
        "/business-info.html": "business-info.html",
        "/refund-policy.html": "refund-policy.html",
        "/images/elrewiny-logo.png": "images/elrewiny-logo.png",
        "/images/ahmed-elrewiny.png": "images/ahmed-elrewiny.png",
        "/images/ideas-verve-logo.png": "images/ideas-verve-logo.png",
      };
      const file = files[path];
      if (!file || !existsSync(resolve(root, file))) {
        res.writeHead(404);
        return res.end("Not Found");
      }
      const mime = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".png": "image/png",
      };
      res.setHeader("Content-Type", mime[extname(file)]);
      res.end(
        req.method === "HEAD" ? undefined : readFileSync(resolve(root, file)),
      );
    } catch {
      json(res, 500, {
        message: "حصلت مشكلة في الحفظ؛ إجاباتك لسه عندك. حاول تاني.",
      });
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  return {
    server,
    db,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((e) => {
          db.close();
          e ? reject(e) : resolve();
        }),
      ),
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const production = process.env.NODE_ENV === "production";
  if (
    production &&
    (!process.env.BRIEF_SECRET ||
      process.env.BRIEF_SECRET.length < 32 ||
      !process.env.BRIEF_DB_PATH ||
      !process.env.PUBLIC_ORIGIN?.startsWith("https://"))
  )
    throw Error(
      "Production requires BRIEF_SECRET (32+ characters), persistent BRIEF_DB_PATH and HTTPS PUBLIC_ORIGIN.",
    );
  const app = createApp({
    dbPath: process.env.BRIEF_DB_PATH,
    secret: process.env.BRIEF_SECRET,
    origin: process.env.PUBLIC_ORIGIN,
  });
  const port = Number(process.env.PORT || 3000);
  app.server.listen(port, production ? "0.0.0.0" : "127.0.0.1", () =>
    console.log(`Brief server listening on port ${port}`),
  );
  for (const sig of ["SIGTERM", "SIGINT"])
    process.once(sig, () => app.close().then(() => process.exit(0)));
}

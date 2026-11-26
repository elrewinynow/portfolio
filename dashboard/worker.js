import { authenticate, authRoute } from "./auth.js";
import {printBrief} from "./print.js";
const states = ["new", "reviewing", "reviewed", "archived"];
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const security = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};
const hash = async (text) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
    ),
    (x) => x.toString(16).padStart(2, "0"),
  ).join("");
function filters(url) {
  const q = (url.searchParams.get("q") || "").trim();
  const status = url.searchParams.get("status") || "";
  if (q.length > 120 || (status && !states.includes(status)))
    throw Error("FILTER");
  return { q: q.toLowerCase(), status };
}
const where =
  "(?='' OR b.status=?) AND (?='' OR instr(lower(b.brand),?)>0 OR instr(lower(b.contact_name),?)>0 OR instr(lower(coalesce(b.phone,'')),?)>0 OR instr(lower(coalesce(b.email,'')),?)>0)";
const values = (f) => [f.status, f.status, f.q, f.q, f.q, f.q, f.q];
const csvCell = (value) =>
  '"' +
  (/^[\s]*[=+\-@]/.test(String(value ?? "")) ||
  /^[\t\r\n]/.test(String(value ?? ""))
    ? "'"
    : "") +
  String(value ?? "").replace(/"/g, '""') +
  '"';
export { csvCell };
export async function handle(request, env, options = {}) {
  const json = (status, body, extra = {}) =>
    new Response(JSON.stringify(body), {
      status,
      headers: {
        ...security,
        "Content-Type": "application/json; charset=utf-8",
        ...extra,
      },
    });
  try {
    const url = new URL(request.url),
      path = url.pathname;
    if (path === "/healthz") return json(200, { status: "ok" }); // No database access or private counts.
    if(path.startsWith('/auth/')){const response=await authRoute(request,env,options);for(const [k,v] of Object.entries(security))response.headers.set(k,v);return response;}
    if(['/login','/login.html','/login.js','/style.css','/logo.png','/manifest.webmanifest','/install.js','/icon-32.png','/icon-180.png','/icon-192.png','/icon-512.png','/icon-maskable-512.png'].includes(path)&&request.method==='GET'){
      const target=new URL(request.url);if(path==='/login')target.pathname='/login.html';
      const response=await env.ASSETS.fetch(new Request(target,request));const out=new Response(response.body,response);for(const [k,v] of Object.entries(security))out.headers.set(k,v);if(path==="/manifest.webmanifest")out.headers.set("Content-Type","application/manifest+json; charset=utf-8");return out;
    }
    const auth = await authenticate(request, env, options);
    if(auth.status===401&&path==='/'&&request.method==='GET')return new Response(null,{status:303,headers:{...security,Location:'/login'}});
    if (auth.status !== 200)
      return json(auth.status, {
        message:
          auth.status === 503
            ? "الدخول الخاص لم يُفعّل بعد."
            : "سجّل الدخول بحساب المالك للوصول إلى الداشبورد.",
      });
    const { user } = auth;
    if (!env.DB)
      return json(503, { message: "قاعدة البيانات غير متاحة مؤقتًا." });
    const notExpired = async () => (await authenticate(request,env,options)).status===200;
    if (path === "/api/session" && request.method === "GET")
      return json(200, { email: user.email });
    if (path === "/api/briefs" && request.method === "GET") {
      const f = filters(url);
      let cursor = null;
      if (url.searchParams.has("cursor")) {
        try {
          cursor = JSON.parse(atob(url.searchParams.get("cursor")));
          if (
            !Array.isArray(cursor) ||
            cursor.length !== 2 ||
            !/^\d{4}-\d\d-\d\dT/.test(cursor[0]) ||
            !uuid.test(cursor[1])
          )
            throw Error();
        } catch {
          return json(400, { message: "رابط الصفحة غير صالح." });
        }
      }
      const page = await env.DB.prepare(
        `SELECT b.id,b.brand,b.contact_name,b.phone,b.email,b.submitted_at,b.status,coalesce(r.version,0) AS version FROM brief_submissions b LEFT JOIN brief_reviews r ON r.brief_id=b.id WHERE ${where} AND (?='' OR b.submitted_at<? OR (b.submitted_at=? AND b.id<?)) ORDER BY b.submitted_at DESC,b.id DESC LIMIT 26`,
      )
        .bind(
          ...values(f),
          cursor?.[0] || "",
          cursor?.[0] || "",
          cursor?.[0] || "",
          cursor?.[1] || "",
        )
        .all();
      const counts = await env.DB.prepare(
        "SELECT status,count(*) AS count FROM brief_submissions GROUP BY status",
      ).all();
      const rows = page.results.slice(0, 25),
        last = rows.at(-1);
      if (!await notExpired())
        return json(401, { message: "انتهت الجلسة؛ سجّل الدخول مجددًا." });
      return json(200, {
        rows,
        counts: counts.results,
        nextCursor:
          page.results.length > 25
            ? btoa(JSON.stringify([last.submitted_at, last.id]))
            : null,
      });
    }
    if (["/api/export.csv","/api/export.json"].includes(path) && request.method === "GET") {
      const f = filters(url),
        result = await env.DB.prepare(
          `SELECT b.id,b.brand,b.contact_name,b.phone,b.email,b.submitted_at,b.status,b.answers_json,coalesce(r.notes,'') AS notes FROM brief_submissions b LEFT JOIN brief_reviews r ON r.brief_id=b.id WHERE ${where} ORDER BY b.submitted_at DESC,b.id DESC LIMIT 501`,
        )
          .bind(...values(f))
          .all();
      if (result.results.length > 500)
        return json(422, {
          message:
            "التصدير متاح حتى ٥٠٠ رد في المرة؛ ضيّق البحث أو فلتر الحالة ثم أعد المحاولة.",
        });
      if (!await notExpired())
        return json(401, { message: "انتهت الجلسة؛ سجّل الدخول مجددًا." });
      if(path === "/api/export.json")return json(200,{rows:result.results.map(row=>({...row,answers:JSON.parse(row.answers_json),answers_json:undefined}))});
      const columns = [
        "id",
        "brand",
        "contact_name",
        "phone",
        "email",
        "submitted_at",
        "status",
        "notes",
        "answers_json",
      ];
      const heading = [
        "رقم البريف",
        "النشاط",
        "المسؤول",
        "واتساب",
        "البريد",
        "تاريخ الإرسال UTC",
        "الحالة",
        "ملاحظاتي",
        "جميع الإجابات",
      ];
      const csv =
        "\uFEFF" +
        [heading, ...result.results.map((r) => columns.map((k) => r[k]))]
          .map((row) => row.map(csvCell).join(","))
          .join("\r\n");
      return new Response(csv, {
        headers: {
          ...security,
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="briefs.csv"',
        },
      });
    }
    const printMatch=path.match(/^\/api\/briefs\/([0-9a-f-]+)\/print$/i);
    if(printMatch && request.method === "GET"){
      if(!uuid.test(printMatch[1]))return json(400,{message:"رقم البريف غير صالح."});
      const row=await env.DB.prepare("SELECT b.id,b.brand,b.submitted_at,b.status,b.answers_json,coalesce(r.notes,'') AS notes FROM brief_submissions b LEFT JOIN brief_reviews r ON r.brief_id=b.id WHERE b.id=?").bind(printMatch[1]).first();
      if(!row)return json(404,{message:"البريف غير موجود."});
      if(!await notExpired())return json(401,{message:"انتهت الجلسة؛ سجّل الدخول مجددًا."});
      return new Response(printBrief({...row,answers:JSON.parse(row.answers_json)}),{headers:{...security,"Content-Type":"text/html; charset=utf-8"}});
    }
    const match = path.match(/^\/api\/briefs\/([0-9a-f-]+)$/i);
    if (match) {
      const id = match[1];
      if (!uuid.test(id)) return json(400, { message: "رقم البريف غير صالح." });
      if (request.method === "GET") {
        const row = await env.DB.prepare(
          "SELECT b.id,b.brand,b.contact_name,b.phone,b.email,b.submitted_at,b.status,b.answers_json,coalesce(r.notes,'') AS notes,coalesce(r.version,0) AS version,r.updated_at,r.updated_by FROM brief_submissions b LEFT JOIN brief_reviews r ON r.brief_id=b.id WHERE b.id=?",
        )
          .bind(id)
          .first();
        if (!row) return json(404, { message: "البريف غير موجود." });
        if (!await notExpired())
          return json(401, { message: "انتهت الجلسة؛ سجّل الدخول مجددًا." });
        return json(200, {
          ...row,
          answers: JSON.parse(row.answers_json),
          answers_json: undefined,
        });
      }
      if (request.method === "POST") {
        if (
          request.headers.get("Origin") !== url.origin ||
          request.headers.get("X-Requested-With") !== "brief-dashboard"
        )
          return json(403, { message: "مصدر طلب الحفظ غير مسموح." });
        if (
          !/^application\/json(?:;|$)/i.test(
            request.headers.get("Content-Type") || "",
          )
        )
          return json(415, { message: "صيغة الحفظ غير صحيحة." });
        const requestKey = request.headers.get("Idempotency-Key");
        if (!uuid.test(requestKey || ""))
          return json(400, { message: "معرف الحفظ غير صالح." });
        const reader = request.body?.getReader();
        let chunks = [],
          size = 0;
        if (reader)
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > 36000) {
              await reader.cancel();
              return json(413, { message: "الملاحظات طويلة جدًا." });
            }
            chunks.push(value);
          }
        let body;
        try {
          const bytes = new Uint8Array(size);
          let offset = 0;
          for (const c of chunks) {
            bytes.set(c, offset);
            offset += c.length;
          }
          body = JSON.parse(new TextDecoder().decode(bytes));
        } catch {
          return json(400, { message: "بيانات الحفظ غير صحيحة." });
        }
        if (
          !body ||
          Object.keys(body).some(
            (k) => !["status", "notes", "version"].includes(k),
          ) ||
          !states.includes(body.status) ||
          typeof body.notes !== "string" ||
          body.notes.length > 8000 ||
          !Number.isSafeInteger(body.version) ||
          body.version < 0
        )
          return json(422, {
            message: "راجع الحالة والملاحظات وإصدار البريف قبل الحفظ.",
          });
        const intent = await hash(
          JSON.stringify({
            id,
            status: body.status,
            notes: body.notes,
            version: body.version,
          }),
        );
        const durable = await env.DB.prepare(
          "SELECT intent_hash,result_version,after_status FROM brief_review_commands WHERE request_key=?",
        )
          .bind(requestKey)
          .first();
        const replay = (r) =>
          r.intent_hash === intent
            ? json(200, { version: r.result_version, status: r.after_status })
            : json(409, {
                message:
                  "معرف الحفظ مستخدم لتعديل مختلف. أعد تحميل البريف قبل محاولة جديدة.",
              });
        if (!await notExpired())
          return json(401, {
            message: "انتهت الجلسة قبل الحفظ؛ سجّل الدخول مجددًا.",
          });
        if (durable) return replay(durable);
        await env.DB.prepare(
          `INSERT INTO brief_review_commands(request_key,intent_hash,brief_id,actor_email,actor_sub,expected_version,result_version,before_status,after_status,notes,created_at) SELECT ?,?,b.id,?,?,?,?,b.status,?,?,? FROM brief_submissions b LEFT JOIN brief_reviews r ON r.brief_id=b.id WHERE b.id=? AND coalesce(r.version,0)=? AND NOT EXISTS(SELECT 1 FROM brief_review_commands WHERE request_key=?) AND EXISTS(SELECT 1 FROM dashboard_sessions s JOIN dashboard_credentials c ON c.id=s.credential_id WHERE s.token_hash=? AND s.expires_at>? AND c.active=1 AND c.owner_email=?)`,
        )
          .bind(
            requestKey,
            intent,
            user.email,
            user.sub,
            body.version,
            body.version + 1,
            body.status,
            body.notes,
            new Date(options.now?.() ?? Date.now()).toISOString(),
            id,
            body.version,
            requestKey,
            user.sessionHash,
            options.now?.()??Date.now(),
            env.OWNER_EMAIL,
          )
          .run();
        const result = await env.DB.prepare(
          "SELECT intent_hash,result_version,after_status FROM brief_review_commands WHERE request_key=?",
        )
          .bind(requestKey)
          .first();
        if (!await notExpired()) return json(401,{message:"انتهت الجلسة؛ سجّل الدخول مجددًا."});
        if (result) return replay(result);
        const exists = await env.DB.prepare(
          "SELECT id FROM brief_submissions WHERE id=?",
        )
          .bind(id)
          .first();
        return json(exists ? 409 : 404, {
          message: exists
            ? "في تعديل أحدث للبريف. ملاحظاتك لسه في الصفحة؛ حمّل النسخة الحالية قبل الحفظ."
            : "البريف غير موجود.",
        });
      }
      return json(405, { message: "الطلب غير متاح." });
    }
    if (path.startsWith("/api/"))
      return json(404, { message: "الطلب غير متاح." });
    if (
      !["GET", "HEAD"].includes(request.method) ||
      ![
        "/",
        "/index.html",
        "/app.js",
        "/style.css",
        "/logo.png",
        "/schema.js",
        "/excel-export.js",
        "/print.css",
        "/print-client.js",
      ].includes(path)
    )
      return json(404, { message: "الصفحة غير موجودة." });
    if (!env.ASSETS)
      return json(503, { message: "ملفات الداشبورد غير متاحة." });
    const target = new URL(request.url);if(path === "/")target.pathname="/index.html";
    const response = await env.ASSETS.fetch(new Request(target,request));
    const out = new Response(response.body, response);
    for (const [key, value] of Object.entries(security))
      out.headers.set(key, value);
    return out;
  } catch (error) {
    return json(error.message === "FILTER" ? 400 : 503, {
      message:
        error.message === "FILTER"
          ? "فلتر البحث غير صالح."
          : "تعذر تحميل البيانات أو حفظها. حاول مرة أخرى؛ لن نعرض نجاحًا دون تأكيد.",
    });
  }
}
export default { fetch: (request, env) => handle(request, env) };

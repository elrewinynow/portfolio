// Local synthetic preview only. No production credentials or real customer data.
import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { handle } from "../dashboard/worker.js";
import {
  identity,
  binding,
  seed,
  baseSchema,
  adminSchema,
} from "./dashboard-support.mjs";
const db = binding();
db.db.exec(baseSchema + adminSchema);
seed(db.db);
seed(db.db, undefined, 1);
const id = await identity(db);
const sessionCookie=await id.sign();
const root = fileURLToPath(new URL("../dashboard/public/", import.meta.url));
const env = {
  ...id.env,
  DB: db,
  ASSETS: {
    fetch: async (request) => {
      const pathname = new URL(request.url).pathname;
      const file = resolve(
        root,
        pathname === "/" ? "index.html" : pathname.slice(1),
      );
      if (!file.startsWith(root) || !existsSync(file))
        return new Response("Not Found", { status: 404 });
      const types = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".png": "image/png",
      };
      return new Response(readFileSync(file), {
        headers: { "Content-Type": types[extname(file)] || "text/plain" },
      });
    },
  },
};
const server = http.createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const headers = new Headers(req.headers);
    headers.set("Cookie", sessionCookie);
    const request = new Request("http://127.0.0.1:3001" + req.url, {
      method: req.method,
      headers,
      ...(["GET", "HEAD"].includes(req.method)
        ? {}
        : { body: Buffer.concat(chunks) }),
    });
    const response = await handle(request, env, {});
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    res.writeHead(500);
    res.end("Preview error");
  }
});
server.listen(3001, "127.0.0.1", () =>
  console.log(
    "Synthetic dashboard preview: http://127.0.0.1:3001 (test data only)",
  ),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () =>
    server.close(() => {
      db.db.close();
      process.exit(0);
    }),
  );

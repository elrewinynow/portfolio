import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/server.mjs";

test("separate API allows only the configured website, hides pages and exposes health", async () => {
  const dir = mkdtempSync(join(tmpdir(), "brief-cors-"));
  const app = createApp({
    dbPath: join(dir, "test.sqlite"),
    origin: "https://elrewiny.com",
    apiOnly: true,
  });
  await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const options = (
    origin,
    method = "POST",
    headers = "content-type,idempotency-key",
  ) =>
    fetch(base + "/api/brief", {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": method,
        "Access-Control-Request-Headers": headers,
      },
    });
  try {
    const allowed = await options("https://elrewiny.com");
    assert.equal(allowed.status, 204);
    assert.equal(
      allowed.headers.get("access-control-allow-origin"),
      "https://elrewiny.com",
    );
    assert.equal(allowed.headers.get("access-control-allow-credentials"), null);
    for (const args of [
      ["https://evil.example"],
      ["https://elrewiny.com", "DELETE"],
      ["https://elrewiny.com", "POST", "authorization"],
    ]) {
      const denied = await options(...args);
      assert.equal(denied.status, 403);
      if (args[0] !== "https://elrewiny.com")
        assert.equal(denied.headers.get("access-control-allow-origin"), null);
    }
    const challenge = await fetch(base + "/api/brief/challenge", {
      headers: { Origin: "https://elrewiny.com" },
    });
    assert.equal(challenge.status, 200);
    assert.equal(
      challenge.headers.get("access-control-allow-origin"),
      "https://elrewiny.com",
    );
    assert.equal((await fetch(base + "/healthz")).status, 200);
    for (const path of [
      "/",
      "/Brief",
      "/Brief/config.js",
      "/data/briefs.sqlite",
    ])
      assert.equal((await fetch(base + path)).status, 404);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

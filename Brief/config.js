// Public API address only. No keys or credentials belong in this file.
// Production uses Cloudflare Workers Free + D1. Local previews use the local server.
export const API_BASE = ["127.0.0.1", "localhost", "[::1]"].includes(location.hostname)
  ? ""
  : "https://elrewiny-brief-api.mrelrewiny.workers.dev";

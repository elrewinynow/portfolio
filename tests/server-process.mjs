// Isolated validation process; never a production dependency.
import { createApp } from "../server/server.mjs";
const app = createApp({
  dbPath: process.argv[2],
  secret: "concurrency-test-secret-only-32-chars",
  origin: "http://127.0.0.1:3000",
  minAge: 0,
});
app.server.listen(0, "127.0.0.1", () =>
  process.send({ port: app.server.address().port }),
);
process.on("message", (m) => {
  if (m === "close") app.close().then(() => process.exit(0));
});

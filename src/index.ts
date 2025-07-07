import { Hono } from "hono";
import node from "@/routes/nodes";
import { cors } from "hono/cors";

const app = new Hono();

app.route("/api/nodes", node);

app.use(
  "*",
  cors({
    origin: "https://watch.1dev.win",
    allowHeaders: ["X-Custom-Header", "Upgrade-Insecure-Requests"],
    allowMethods: ["POST", "GET", "OPTIONS"],
    credentials: true,
  }),
);

console.log("server running on http://localhost:3000");

Bun.serve({
  fetch: app.fetch,
  idleTimeout: 0,
});

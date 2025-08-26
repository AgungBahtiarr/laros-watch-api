import { Hono } from "hono";
import node from "@/routes/nodes";
import domains from "@/routes/domains";
import { cors } from "hono/cors";

const app = new Hono();

app.use("*", cors());

app.route("/api/nodes", node);
app.route("/api/domains", domains);

console.log("server running on http://localhost:3000");

Bun.serve({
  fetch: app.fetch,
  idleTimeout: 0,
});

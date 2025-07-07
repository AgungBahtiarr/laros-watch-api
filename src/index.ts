import { Hono } from "hono";
import node from "@/routes/nodes";
import { cors } from "hono/cors";

const app = new Hono();

app.use(
  "*",
  cors({
    origin: ["https://watch.1dev.win", "http://localhost:4321"],
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
    credentials: true,
  })
);

app.route("/api/nodes", node);

console.log("server running on http://localhost:3000");

Bun.serve({
  fetch: app.fetch,
  idleTimeout: 0,
});

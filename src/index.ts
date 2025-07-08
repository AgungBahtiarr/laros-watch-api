import { Hono } from "hono";
import node from "@/routes/nodes";
import { cors } from "hono/cors";

const app = new Hono();

app.route("/api/nodes", node);

app.use(
  "*",
  cors({
    origin: (origin) => {
      const allowedOrigins = [
        "https://watch.1dev.win",
        "http://localhost:4321",
        "http://tswww88c84og0gcws4ggkco0.172.16.100.12.sslip.io",
      ];
      if (allowedOrigins.includes(origin)) {
        return origin;
      }
      return null;
    },
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
    credentials: true,
  })
);

console.log("server running on http://localhost:3000");

Bun.serve({
  fetch: app.fetch,
  idleTimeout: 0,
});

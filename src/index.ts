import { Hono } from "hono";
import node from "@/routes/nodes";
import { cors } from "hono/cors";

const app = new Hono();

// app.use("*", async (c, next) => {
//   console.log("CORS middleware triggered for:", c.req.method, c.req.url);

//   c.header("Access-Control-Allow-Origin", "http://localhost:4321");
//   c.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
//   c.header("Access-Control-Allow-Headers", "Content-Type, Authorization");

//   if (c.req.method === "OPTIONS") {
//     console.log("Handling OPTIONS request");
//     return c.text("", 200);
//   }

//   await next();
// });

app.use("*", cors());

app.route("/api/nodes", node);

console.log("server running on http://localhost:3000");

Bun.serve({
  fetch: app.fetch,
  idleTimeout: 0,
});

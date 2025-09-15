import { OpenAPIHono } from "@hono/zod-openapi";
import node from "@/routes/nodes";
import domains from "@/routes/domains";

import { cors } from "hono/cors";
import { initScheduledJobs } from "@/services/scheduler";
import { swaggerUI } from "@hono/swagger-ui";

const app = new OpenAPIHono();

app.use("*", cors());

app.doc("/doc/json", {
  info: {
    title: "Laros Watch API",
    version: "v1",
  },
  openapi: "3.1.0",
});

app.get(
  "/doc",
  swaggerUI({
    url: "/doc/json",
  })
);

app.route("/api/nodes", node);
app.route("/api/domains", domains);

console.log("server running on http://localhost:3000");
console.log("OpenAPI Docs available at http://localhost:3000/doc");

// Initialize scheduled jobs
initScheduledJobs();

Bun.serve({
  fetch: app.fetch,
  idleTimeout: 0,
});

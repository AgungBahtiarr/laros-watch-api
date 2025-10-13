import { OpenAPIHono } from "@hono/zod-openapi";
import node from "@/routes/nodes";
import domains from "@/routes/domains";
import usersRoute from "@/routes/users";

import { cors } from "hono/cors";
import { initScheduledJobs } from "@/services/scheduler";
import { swaggerUI } from "@hono/swagger-ui";
import { basicAuth } from "hono/basic-auth";
import { db } from "@/db";
import { users as usersSchema } from "@/db/schema";
import { eq } from "drizzle-orm";

const app = new OpenAPIHono();

app.use("*", cors());

const authMiddleware = basicAuth({
  async verifyUser(username, password, c) {
    const user = await db.query.users.findFirst({
      where: eq(usersSchema.username, username),
    });
    if (!user) {
      return false;
    }
    const passwordMatch = await Bun.password.verify(password, user.password);
    return passwordMatch;
  },
});

app.use("/api/*", async (c, next) => {
  if (c.req.path === "/api/nodes/status/events") {
    return next();
  }
  return authMiddleware(c, next);
});

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
  }),
);

app.route("/api/nodes", node);
app.route("/api/domains", domains);
app.route("/api/users", usersRoute);

console.log("server running on http://localhost:3000");
console.log("OpenAPI Docs available at http://localhost:3000/doc");

// Initialize scheduled jobs
initScheduledJobs();

Bun.serve({
  fetch: app.fetch,
  idleTimeout: 0,
});

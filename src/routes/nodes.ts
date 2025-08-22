import { db } from "@/db";
import { nodes } from "@/db/schema";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import eventBus from "@/utils/event-bus";

import connectionsRouter from "./connections";
import odpRouter from "./odp";
import syncRouter from "./sync";
import webhooksRouter from "./webhooks";

const node = new Hono();

// Mount sub-routers
node.route("/connections", connectionsRouter);
node.route("/odp", odpRouter);
node.route("/", syncRouter);
node.route("/", webhooksRouter);

node.get("/status/events", (c) => {
  return streamSSE(c, async (stream) => {
    console.log("SSE client connected.");

    const onDbUpdate = async (data: {
      nodeChanges: any[];
      interfaceChanges: any[];
    }) => {
      console.log("SSE: Received 'db-updated' event. Sending notification.");
      if (stream.aborted) {
        console.log("SSE: Client disconnected, aborting notification send.");
        return;
      }
      try {
        const hasChanges =
          (data.nodeChanges && data.nodeChanges.length > 0) ||
          (data.interfaceChanges && data.interfaceChanges.length > 0);

        if (hasChanges) {
          await stream.writeSSE({
            event: "notification",
            data: JSON.stringify(data),
            id: `update-${Date.now()}`,
          });
        }
      } catch (e) {
        console.error("SSE: Failed to send notification", e);
      }
    };

    eventBus.on("db-updated", onDbUpdate);

    stream.onAbort(() => {
      console.log("SSE client disconnected. Cleaning up listener.");
      eventBus.off("db-updated", onDbUpdate);
    });

    // Loop for heartbeat
    while (!stream.aborted) {
      await stream.sleep(25000);
      if (stream.aborted) break;
      await stream.writeSSE({ event: "heartbeat", data: "ping" });
    }
  });
});

node.get("/", async (c) => {
  const allNodes = await db.query.nodes.findMany({
    with: {
      interfaces: true,
    },
  });
  return c.json(allNodes);
});

node.get("/:id", async (c) => {
  const id = parseInt(c.req.param("id"));
  const node = await db.query.nodes.findFirst({
    where: eq(nodes.id, id),
    with: {
      interfaces: true,
    },
  });

  if (!node) {
    return c.json({ error: "Node not found" }, 404);
  }
  return c.json(node);
});

export default node;
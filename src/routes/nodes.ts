import { db } from "../db";
import { nodes } from "@/db/schema";
import { eq } from "drizzle-orm";
import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { streamSSE } from "hono/streaming";
import eventBus from "@/utils/event-bus";

import connectionsRouter from "./connections";
import odpRouter from "./odp";
import syncRouter from "./sync";
import webhooksRouter from "./webhooks";
import vlansRouter from "./vlans";
import { NodeSchema, NodesSchema } from "@/schemas/schemas";

const node = new OpenAPIHono();

// Mount sub-routers
node.route("/connections", connectionsRouter);
node.route("/odp", odpRouter);
node.route("/", syncRouter);
node.route("/", webhooksRouter);
node.route("/vlans", vlansRouter);

const getStatusEventsRoute = createRoute({
  method: "get",
  path: "/status/events",
  responses: {
    200: {
      description: "Server-Sent Events for node status updates",
      content: {
        "text/event-stream": {
          schema: z.string(),
        },
      },
    },
  },
});

node.openapi(getStatusEventsRoute, (c) => {
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

const getNodesRoute = createRoute({
  method: "get",
  path: "/",
  responses: {
    200: {
      description: "List of all nodes",
      content: {
        "application/json": {
          schema: NodesSchema,
        },
      },
    },
  },
});

node.openapi(getNodesRoute, async (c) => {
  const allNodes = await db.query.nodes.findMany({
    with: {
      interfaces: true,
    },
  });
  return c.json(allNodes);
});

const getNodeByIdRoute = createRoute({
  method: "get",
  path: "/:id",
  request: {
    params: z.object({
      id: z.string().openapi({
        param: {
          name: "id",
          in: "path",
        },
        example: "1",
      }),
    }),
  },
  responses: {
    200: {
      description: "A single node",
      content: {
        "application/json": {
          schema: NodeSchema,
        },
      },
    },
    404: {
      description: "Node not found",
    },
  },
});

node.openapi(getNodeByIdRoute, async (c) => {
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
import { db } from "@/db";
import { nodes } from "@/db/schema";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { env } from "hono/adapter";
import { HTTPException } from "hono/http-exception";
import { streamSSE } from "hono/streaming";
import eventBus from "@/utils/event-bus";
import sendWhatsappReply from "@/utils/send-whatsapp";
import { handleWebhook } from "@/services/webhook";
import { syncNodes, syncInterfaces } from "@/services/sync";
import { sendChangeNotification } from "@/services/notification";

const node = new Hono();

node.post("/transport", async (c) => {
  const {
    WA_GROUP_ID,
    WA_API_URL,
    WA_USERNAME,
    WA_PASSWORD,
    LIBRENMS_API_URL,
    LIBRENMS_API_TOKEN,
  } = env<{
    WA_API_URL: string;
    WA_GROUP_ID: string;
    WA_USERNAME: string;
    WA_PASSWORD: string;
    LIBRENMS_API_URL: string;
    LIBRENMS_API_TOKEN: string;
  }>(c);

  console.log("Running sync to generate notification...");

  if (!LIBRENMS_API_URL || !LIBRENMS_API_TOKEN) {
    throw new HTTPException(500, {
      message: "API credentials for LibreNMS are not configured.",
    });
  }

  const libreNmsCreds = { url: LIBRENMS_API_URL, token: LIBRENMS_API_TOKEN };

  // Call services directly
  const nodeResult = await syncNodes(libreNmsCreds);
  const interfaceResult = await syncInterfaces(libreNmsCreds);

  const nodeChanges = nodeResult.changes || [];
  const interfaceChanges = interfaceResult.changes || [];

  // Emit event to update clients
  eventBus.emit("db-updated", { nodeChanges, interfaceChanges });
  console.log("Event 'db-updated' emitted.");

  const whatsappCreds = {
    apiUrl: WA_API_URL,
    groupId: WA_GROUP_ID,
    username: WA_USERNAME,
    password: WA_PASSWORD,
  };

  const notificationResult = await sendChangeNotification(whatsappCreds, {
    nodeChanges,
    interfaceChanges,
  });

  return c.json(notificationResult);
});

node.post("/webhook", async (c) => {
  const { WA_API_URL, WA_USERNAME, WA_PASSWORD, WA_DEVICE_SESSION } = env<{
    WA_API_URL: string;
    WA_USERNAME: string;
    WA_PASSWORD: string;
    WA_DEVICE_SESSION: string;
  }>(c);

  try {
    const data = await c.req.json();
    console.log("Webhook received:", JSON.stringify(data, null, 2));

    if (data.from && data.message?.text) {
      const fromString = data.from;
      let receiver;

      if (fromString.includes("@g.us")) {
        receiver = fromString.split(" in ")[1];
      } else {
        const rawJidWithResource = fromString.split(" ")[0];
        receiver = rawJidWithResource.split(":")[0] + "@s.whatsapp.net";
      }

      const replyText = await handleWebhook(data);

      if (replyText) {
        const waApiEndpoint = WA_API_URL;
        const authHeader = `Basic ${btoa(WA_USERNAME + ":" + WA_PASSWORD)}`;

        await sendWhatsappReply(
          waApiEndpoint,
          authHeader,
          receiver,
          replyText,
          WA_DEVICE_SESSION
        );

        return c.json({ status: "success", reply_sent: true });
      }
    } else {
      console.log(
        "Webhook received but format is not as expected or text is missing."
      );
    }

    return c.json({
      status: "success",
      reply_sent: false,
      reason: "No matching keyword or invalid format.",
    });
  } catch (error: any) {
    console.error("Error in /webhook:", error);
    throw new HTTPException(500, {
      message: `Webhook error: ${error.message}`,
    });
  }
});

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

node.post("/sync", async (c) => {
  const { LIBRENMS_API_TOKEN, LIBRENMS_API_URL } = env<{
    LIBRENMS_API_TOKEN: string;
    LIBRENMS_API_URL: string;
  }>(c);

  if (!LIBRENMS_API_URL || !LIBRENMS_API_TOKEN) {
    throw new HTTPException(500, {
      message: "API credentials for LibreNMS are not configured.",
    });
  }

  const result = await syncNodes({
    url: LIBRENMS_API_URL,
    token: LIBRENMS_API_TOKEN,
  });
  return c.json(result);
});

node.post("/sync/interfaces", async (c) => {
  const { LIBRENMS_API_TOKEN, LIBRENMS_API_URL } = env<{
    LIBRENMS_API_TOKEN: string;
    LIBRENMS_API_URL: string;
  }>(c);

  if (!LIBRENMS_API_URL || !LIBRENMS_API_TOKEN) {
    throw new HTTPException(500, {
      message: "API credentials for LibreNMS are not configured.",
    });
  }

  const result = await syncInterfaces({
    url: LIBRENMS_API_URL,
    token: LIBRENMS_API_TOKEN,
  });
  return c.json(result);
});

export default node;

import { db } from "@/db";
import { connections, fdb, nodes } from "@/db/schema";
import { countDistinct, eq, gt } from "drizzle-orm";
import { Hono } from "hono";
import { env } from "hono/adapter";
import { HTTPException } from "hono/http-exception";
import { streamSSE } from "hono/streaming";
import eventBus from "@/utils/event-bus";
import sendWhatsappReply from "@/utils/send-whatsapp";
import { handleWebhook } from "@/services/webhook";
import { syncFdb, syncNodes, syncInterfaces } from "@/services/sync";
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
          WA_DEVICE_SESSION,
        );

        return c.json({ status: "success", reply_sent: true });
      }
    } else {
      console.log(
        "Webhook received but format is not as expected or text is missing.",
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

node.get("/connections", async (c) => {
  const { LIBRENMS_API_TOKEN, LIBRENMS_API_URL } = env<{
    LIBRENMS_API_TOKEN: string;
    LIBRENMS_API_URL: string;
  }>(c);

  if (!LIBRENMS_API_URL || !LIBRENMS_API_TOKEN) {
    throw new HTTPException(500, {
      message: "API credentials for LibreNMS are not configured.",
    });
  }

  await syncFdb({ url: LIBRENMS_API_URL, token: LIBRENMS_API_TOKEN });

  const linkMacs = await db
    .select({
      macAddress: fdb.macAddress,
    })
    .from(fdb)
    .groupBy(fdb.macAddress)
    .having(gt(countDistinct(fdb.deviceId), 1));

  if (linkMacs.length === 0) {
    await db.delete(connections);
    return c.json([]);
  }

  const macAddresses = linkMacs.map((row) => row.macAddress);

  const fdbEntries = await db.query.fdb.findMany({
    where: (fdb, { inArray }) => inArray(fdb.macAddress, macAddresses),
  });

  const entriesByMac = fdbEntries.reduce(
    (acc, entry) => {
      if (!acc[entry.macAddress]) {
        acc[entry.macAddress] = [];
      }
      acc[entry.macAddress].push(entry);
      return acc;
    },
    {} as Record<string, (typeof fdbEntries)[0][]>,
  );

  const links = new Map<string, { endpoints: any[]; macCount: number }>();

  for (const mac in entriesByMac) {
    const entries = entriesByMac[mac];

    const entriesByDevice = entries.reduce(
      (acc, entry) => {
        if (!acc[entry.deviceId]) {
          acc[entry.deviceId] = entry;
        }
        return acc;
      },
      {} as Record<number, (typeof entries)[0]>,
    );

    const deviceEntries = Object.values(entriesByDevice);

    if (deviceEntries.length < 2) continue;

    for (let i = 0; i < deviceEntries.length; i++) {
      for (let j = i + 1; j < deviceEntries.length; j++) {
        const endpoints = [
          {
            deviceId: deviceEntries[i].deviceId,
            portId: deviceEntries[i].portId,
          },
          {
            deviceId: deviceEntries[j].deviceId,
            portId: deviceEntries[j].portId,
          },
        ].sort((a, b) => a.deviceId - b.deviceId || a.portId - b.portId);

        const linkKey = endpoints
          .map((e) => `${e.deviceId}:${e.portId}`)
          .join("|");

        if (links.has(linkKey)) {
          links.get(linkKey)!.macCount++;
        } else {
          links.set(linkKey, { endpoints, macCount: 1 });
        }
      }
    }
  }

  const pointToPointLinks = Array.from(links.values());

  if (pointToPointLinks.length > 0) {
    const connectionsToInsert = pointToPointLinks.map((link) => ({
      macAddressCount: link.macCount,
      deviceAId: link.endpoints[0].deviceId,
      portAId: link.endpoints[0].portId,
      deviceBId: link.endpoints[1].deviceId,
      portBId: link.endpoints[1].portId,
      updatedAt: new Date(),
    }));

    await db.transaction(async (tx) => {
      await tx.delete(connections);
      await tx.insert(connections).values(connectionsToInsert);
    });
  }

  const allConnections = await db.query.connections.findMany();
  return c.json(allConnections);
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

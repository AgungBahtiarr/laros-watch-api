import { db } from "@/db";
import {
  connections,
  fdb,
  nodes,
  interfaces,
  customRoutes,
  lldp,
} from "@/db/schema";
import { countDistinct, eq, gt, lt, and } from "drizzle-orm";
import { Hono } from "hono";
import { env } from "hono/adapter";
import { HTTPException } from "hono/http-exception";
import { streamSSE } from "hono/streaming";
import eventBus from "@/utils/event-bus";
import sendWhatsappReply from "@/utils/send-whatsapp";
import { handleWebhook } from "@/services/webhook";
import { syncFdb, syncNodes, syncInterfaces } from "@/services/sync";
import { sendChangeNotification } from "@/services/notification";
import { fetchAndProcessLldpData } from "@/services/snmp";

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

      const reply = await handleWebhook(data);

      if (reply.text) {
        const waApiEndpoint = WA_API_URL;
        const authHeader = `Basic ${btoa(WA_USERNAME + ":" + WA_PASSWORD)}`;

        if (reply.text) {
          await sendWhatsappReply(
            waApiEndpoint,
            authHeader,
            receiver,
            reply.text,
            WA_DEVICE_SESSION,
          );
        }

        const sendLocation = await fetch(`${waApiEndpoint}/send/location`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: authHeader,
          },
          body: JSON.stringify({
            phone: receiver,
            latitude: reply.location.lat,
            longitude: reply.location.lng,
            is_forwarded: false,
            duration: 3600,
          }),
        });

        console.log(sendLocation);

        const resLocation = await sendLocation.json();

        console.log(resLocation);

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
  const allConnections = await db.query.connections.findMany({
    with: {
      customRoute: true,
    },
  });
  return c.json(allConnections);
});

node.post("/connections", async (c) => {
  try {
    const body = await c.req.json();

    const { deviceAId, portAId, deviceBId, portBId, description } = body || {};

    // Basic validations
    if (
      typeof deviceAId !== "number" ||
      typeof portAId !== "number" ||
      typeof deviceBId !== "number" ||
      typeof portBId !== "number"
    ) {
      return c.json(
        {
          error:
            "Invalid payload. Required numeric fields: deviceAId, portAId, deviceBId, portBId",
        },
        400,
      );
    }

    if (deviceAId === deviceBId && portAId === portBId) {
      return c.json(
        { error: "deviceAId/portAId cannot be the same as deviceBId/portBId" },
        400,
      );
    }

    // Fetch nodes and interfaces for validation and description generation
    const [ifaceA, ifaceB] = await Promise.all([
      db.query.interfaces.findFirst({ where: eq(interfaces.id, portAId) }),
      db.query.interfaces.findFirst({ where: eq(interfaces.id, portBId) }),
    ]);

    if (!ifaceA || !ifaceB) {
      return c.json(
        { error: "One or both interfaces not found using provided port IDs" },
        400,
      );
    }

    const [nodeA, nodeB] = await Promise.all([
      db.query.nodes.findFirst({ where: eq(nodes.deviceId, deviceAId) }),
      db.query.nodes.findFirst({ where: eq(nodes.deviceId, deviceBId) }),
    ]);

    if (!nodeA || !nodeB) {
      return c.json(
        { error: "One or both devices not found using provided device IDs" },
        400,
      );
    }

    // Ensure consistent order to avoid duplicates in reverse order
    const ordered =
      deviceAId < deviceBId || (deviceAId === deviceBId && portAId <= portBId)
        ? {
            deviceAId,
            portAId,
            deviceBId,
            portBId,
            nodeA,
            nodeB,
            ifaceA,
            ifaceB,
          }
        : {
            deviceAId: deviceBId,
            portAId: portBId,
            deviceBId: deviceAId,
            portBId: portAId,
            nodeA: nodeB,
            nodeB: nodeA,
            ifaceA: ifaceB,
            ifaceB: ifaceA,
          };

    const finalDescription =
      typeof description === "string" && description.trim().length > 0
        ? description.trim()
        : `${ordered.nodeA?.name}_${ordered.ifaceA?.ifDescr || "N/A"}<>${ordered.nodeB?.name}_${ordered.ifaceB?.ifDescr || "N/A"}`;

    // Check if an identical connection already exists
    const existing = await db.query.connections.findFirst({
      where: and(
        eq(connections.deviceAId, ordered.deviceAId),
        eq(connections.portAId, ordered.portAId),
        eq(connections.deviceBId, ordered.deviceBId),
        eq(connections.portBId, ordered.portBId),
      ),
    });

    let saved;
    if (existing) {
      const [updated] = await db
        .update(connections)
        .set({
          description: finalDescription,
          updatedAt: new Date(),
        })
        .where(eq(connections.id, existing.id))
        .returning();
      saved = updated;
    } else {
      const [inserted] = await db
        .insert(connections)
        .values({
          deviceAId: ordered.deviceAId,
          portAId: ordered.portAId,
          deviceBId: ordered.deviceBId,
          portBId: ordered.portBId,
          description: finalDescription,
          updatedAt: new Date(),
        })
        .returning();
      saved = inserted;
    }

    const withRelation = await db.query.connections.findFirst({
      where: eq(connections.id, saved.id),
      with: { customRoute: true },
    });

    return c.json(withRelation ?? saved, existing ? 200 : 201);
  } catch (error: any) {
    throw new HTTPException(500, {
      message: `Failed to create connection: ${error.message}`,
    });
  }
});

node.post("/connections/:id/custom-route", async (c) => {
  const connectionId = parseInt(c.req.param("id"));
  const { coordinates } = await c.req.json();

  if (!Array.isArray(coordinates) || coordinates.length === 0) {
    return c.json({ error: "Invalid coordinates" }, 400);
  }

  const newRoute = await db
    .insert(customRoutes)
    .values({
      connectionId,
      coordinates,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: customRoutes.connectionId,
      set: {
        coordinates: customRoutes.coordinates,
        updatedAt: new Date(),
      },
    })
    .returning();

  return c.json(newRoute[0]);
});

// Update a connection by ID
node.put("/connections/:id", async (c) => {
  try {
    const id = parseInt(c.req.param("id"));
    const body = await c.req.json();
    const { deviceAId, portAId, deviceBId, portBId, description } = body || {};

    const existing = await db.query.connections.findFirst({
      where: eq(connections.id, id),
    });

    if (!existing) {
      return c.json({ error: "Connection not found" }, 404);
    }

    const identifiersProvided = [deviceAId, portAId, deviceBId, portBId].some(
      (v) => typeof v !== "undefined",
    );

    let nextDeviceAId = existing.deviceAId;
    let nextPortAId = existing.portAId;
    let nextDeviceBId = existing.deviceBId;
    let nextPortBId = existing.portBId;

    if (identifiersProvided) {
      if (
        typeof deviceAId !== "number" ||
        typeof portAId !== "number" ||
        typeof deviceBId !== "number" ||
        typeof portBId !== "number"
      ) {
        return c.json(
          {
            error:
              "When updating identifiers, all of deviceAId, portAId, deviceBId, portBId must be numeric",
          },
          400,
        );
      }

      if (deviceAId === deviceBId && portAId === portBId) {
        return c.json(
          {
            error: "deviceAId/portAId cannot be the same as deviceBId/portBId",
          },
          400,
        );
      }

      // reorder canonically to avoid duplicates
      const ordered =
        deviceAId < deviceBId || (deviceAId === deviceBId && portAId <= portBId)
          ? { deviceAId, portAId, deviceBId, portBId }
          : {
              deviceAId: deviceBId,
              portAId: portBId,
              deviceBId: deviceAId,
              portBId: portAId,
            };

      nextDeviceAId = ordered.deviceAId;
      nextPortAId = ordered.portAId;
      nextDeviceBId = ordered.deviceBId;
      nextPortBId = ordered.portBId;

      // prevent creating a duplicate connection (other than self)
      const dup = await db.query.connections.findFirst({
        where: and(
          eq(connections.deviceAId, nextDeviceAId),
          eq(connections.portAId, nextPortAId),
          eq(connections.deviceBId, nextDeviceBId),
          eq(connections.portBId, nextPortBId),
        ),
      });

      if (dup && dup.id !== id) {
        return c.json(
          {
            error: "Another connection with the same endpoints already exists",
          },
          409,
        );
      }
    }

    const updatePayload: any = {
      updatedAt: new Date(),
    };

    if (identifiersProvided) {
      updatePayload.deviceAId = nextDeviceAId;
      updatePayload.portAId = nextPortAId;
      updatePayload.deviceBId = nextDeviceBId;
      updatePayload.portBId = nextPortBId;
    }

    if (typeof description === "string") {
      updatePayload.description = description.trim();
    }

    const [updated] = await db
      .update(connections)
      .set(updatePayload)
      .where(eq(connections.id, id))
      .returning();

    const withRelation = await db.query.connections.findFirst({
      where: eq(connections.id, updated.id),
      with: { customRoute: true },
    });

    return c.json(withRelation ?? updated);
  } catch (error: any) {
    throw new HTTPException(500, {
      message: `Failed to update connection: ${error.message}`,
    });
  }
});

// Delete a connection by ID
node.delete("/connections/:id", async (c) => {
  try {
    const id = parseInt(c.req.param("id"));

    const existing = await db.query.connections.findFirst({
      where: eq(connections.id, id),
    });

    if (!existing) {
      return c.json({ error: "Connection not found" }, 404);
    }

    // Also delete custom route if exists (FK may cascade, but handle explicitly)
    await db.delete(customRoutes).where(eq(customRoutes.connectionId, id));

    await db.delete(connections).where(eq(connections.id, id));

    return c.json({ message: "Connection deleted" });
  } catch (error: any) {
    throw new HTTPException(500, {
      message: `Failed to delete connection: ${error.message}`,
    });
  }
});

node.delete("/connections/:id/custom-route", async (c) => {
  const connectionId = parseInt(c.req.param("id"));

  await db
    .delete(customRoutes)
    .where(eq(customRoutes.connectionId, connectionId));

  return c.json({ message: "Custom route deleted" });
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

node.post("/lldp/sync", async (c) => {
  const allNodes = await db.query.nodes.findMany();

  if (!allNodes || allNodes.length === 0) {
    return c.json({ message: "No nodes found in the database." });
  }

  const allInterfaces = await db.query.interfaces.findMany();
  const interfaceMap = new Map(
    allInterfaces.map((iface) => [
      `${iface.nodeId}-${iface.ifIndex}`,
      iface.ifDescr,
    ]),
  );

  let successfulDevices = 0;
  let failedDevices = 0;

  try {
    const allLldpData = await Promise.all(
      allNodes.map(async (node) => {
        try {
          const lldpData = await fetchAndProcessLldpData(
            node.ipMgmt,
            node.snmpCommunity,
          );
          successfulDevices++;
          return { nodeId: node.id, nodeName: node.name, data: lldpData };
        } catch (error) {
          failedDevices++;
          console.error(
            `Failed to fetch LLDP data for node ${node.name}:`,
            error,
          );
          return { nodeId: node.id, nodeName: node.name, data: [] }; // Return empty data on error
        }
      }),
    );

    const valuesToUpsert = allLldpData.flatMap(({ nodeId, nodeName, data }) =>
      data.map((entry) => ({
        ...entry,
        nodeId,
        localDeviceName: nodeName,
        localPortDescription: interfaceMap.get(
          `${nodeId}-${entry.localPortIfIndex}`,
        ),
      })),
    );

    if (valuesToUpsert.length > 0) {
      await db
        .insert(lldp)
        .values(valuesToUpsert)
        .onConflictDoUpdate({
          target: [lldp.nodeId, lldp.localPortIfIndex],
          set: {
            localDeviceName: lldp.localDeviceName,
            localPortDescription: lldp.localPortDescription,
            remoteChassisIdSubtypeCode: lldp.remoteChassisIdSubtypeCode,
            remoteChassisIdSubtypeName: lldp.remoteChassisIdSubtypeName,
            remoteChassisId: lldp.remoteChassisId,
            remotePortIdSubtypeCode: lldp.remotePortIdSubtypeCode,
            remotePortIdSubtypeName: lldp.remotePortIdSubtypeName,
            remotePortId: lldp.remotePortId,
            remotePortDescription: lldp.remotePortDescription,
            remoteSystemName: lldp.remoteSystemName,
            remoteSystemDescription: lldp.remoteSystemDescription,
            updatedAt: new Date(),
          },
        });
    }

    return c.json({
      message: "LLDP sync completed successfully.",
      successfulDevices,
      failedDevices,
      syncedCount: valuesToUpsert.length,
      data: valuesToUpsert,
    });
  } catch (error: any) {
    throw new HTTPException(500, {
      message: `Failed to sync LLDP data: ${error.message}`,
    });
  }
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

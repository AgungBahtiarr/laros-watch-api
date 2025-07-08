import { db } from "@/db";
import { interfaces, nodes } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { env } from "hono/adapter";
import { HTTPException } from "hono/http-exception";
import { streamSSE } from "hono/streaming";
import eventBus from "@/utils/event-bus";

const node = new Hono();

node.post("/transport", async (c) => {
  const { BASE_URL, WA_GROUP_ID, WA_API_URL, WA_USERNAME, WA_PASSWORD } = env<{
    BASE_URL: string;
    WA_API_URL: string;
    WA_GROUP_ID: string;
    WA_USERNAME: string;
    WA_PASSWORD: string;
  }>(c);

  console.log("Running sync to generate notification...");

  const syncNodeResponse = await fetch(`${BASE_URL}/nodes/sync`, {
    method: "post",
  });
  const syncInterfaceResponse = await fetch(
    `${BASE_URL}/nodes/sync/interfaces`,
    { method: "post" }
  );

  // Emit event to update clients regardless of sync success
  eventBus.emit("db-updated");
  console.log("Event 'db-updated' emitted.");

  if (!syncNodeResponse.ok || !syncInterfaceResponse.ok) {
    console.error("Failed during sync process, notification will not be sent.");
    throw new HTTPException(500, {
      message: "One of the sync processes failed.",
    });
  }

  const nodeResult = await syncNodeResponse.json();
  const interfaceResult = await syncInterfaceResponse.json();

  const nodeChanges = nodeResult.changes || [];
  const interfaceChanges = interfaceResult.changes || [];

  if (nodeChanges.length === 0 && interfaceChanges.length === 0) {
    console.log("No status changes detected. No notification sent.");
    return c.json({
      success: true,
      notification_sent: false,
      reason: "No status changes detected.",
    });
  }

  const now = new Date();
  const timestamp = now.toLocaleString("id-ID", {
    dateStyle: "full",
    timeStyle: "long",
  });
  let messageLines = [
    `*🚨 Laporan Status Jaringan 🚨*`,
    `*Waktu:* ${timestamp}`,
    `-----------------------------------`,
  ];

  if (nodeChanges.length > 0) {
    messageLines.push(`*Perubahan Status Perangkat:*`);
    nodeChanges.forEach((node: any) => {
      const icon = node.current_status === "UP" ? "✅" : "❌";
      messageLines.push(
        `${icon} *${node.name}* (${node.ipMgmt}) sekarang *${node.current_status}*`
      );
    });
    messageLines.push(``);
  }

  if (interfaceChanges.length > 0) {
    messageLines.push(`*Perubahan Status Interface:*`);
    interfaceChanges.forEach((iface: any) => {
      const icon = iface.current_status === "UP" ? "🔵" : "🔴";
      const description = iface.description ? ` (${iface.description})` : "";
      messageLines.push(
        `${icon} *${iface.name}*${description} di _${iface.nodeName}_ sekarang *${iface.current_status}*`
      );
    });
    messageLines.push(``);
  }

  messageLines.push(`_Pesan ini dibuat secara otomatis._`);

  const finalMessage = messageLines.join("\n");
  console.log("Generated notification message:\n", finalMessage);

  try {
    const response = await fetch(WA_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${btoa(WA_USERNAME + ":" + WA_PASSWORD)}`,
      },
      body: JSON.stringify({
        phone: WA_GROUP_ID,
        message: finalMessage,
        is_forwarded: false,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error("Failed to send WhatsApp message:", errorBody);
      throw new Error("WhatsApp API returned an error.");
    }

    const waResponse = await response.json();
    console.log("WhatsApp API response:", waResponse);

    return c.json({
      success: true,
      notification_sent: true,
      data_sent: {
        nodeChanges,
        interfaceChanges,
      },
    });
  } catch (e) {
    console.error("Error during WhatsApp notification sending:", e);
    throw new HTTPException(500, {
      message: "Failed to send notification via WhatsApp.",
    });
  }
});

node.get("/status/events", (c) => {
  return streamSSE(c, async (stream) => {
    console.log("SSE client connected.");

    const onDbUpdate = async () => {
      console.log("SSE: Received 'db-updated' event. Sending notification.");
      if (stream.aborted) {
        console.log("SSE: Client disconnected, aborting notification send.");
        return;
      }
      try {
        await stream.writeSSE({
          event: "notification",
          data: "db-updated",
          id: `update-${Date.now()}`,
        });
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
  console.log("Starting device sync from LibreNMS...");

  const { LIBRENMS_API_TOKEN, LIBRENMS_API_URL } = env<{
    LIBRENMS_API_TOKEN: string;
    LIBRENMS_API_URL: string;
  }>(c);

  if (!LIBRENMS_API_URL || !LIBRENMS_API_TOKEN) {
    throw new HTTPException(500, {
      message: "API credentials for LibreNMS are not configured.",
    });
  }

  try {
    const oldNodes = await db
      .select({ ipMgmt: nodes.ipMgmt, status: nodes.status, name: nodes.name })
      .from(nodes);
    const oldNodesStatusMap = new Map(
      oldNodes.map((node) => [node.ipMgmt, node.status])
    );

    const response = await fetch(`${LIBRENMS_API_URL}/devices`, {
      headers: { "X-Auth-Token": LIBRENMS_API_TOKEN },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Failed to fetch data from LibreNMS:", errorText);
      throw new HTTPException(response.status, {
        message: `Failed to fetch from LibreNMS: ${errorText}`,
      });
    }

    const data = await response.json();
    const devicesFromApi = data.devices;

    if (!devicesFromApi || devicesFromApi.length === 0) {
      return c.json({
        message: "Sync finished. No devices found in LibreNMS.",
        syncedCount: 0,
        changes: [],
      });
    }
    console.log(`Found ${devicesFromApi.length} devices in LibreNMS.`);

    const newValues = devicesFromApi.map((device: any) => ({
      name: device.sysName || device.hostname,
      deviceId: parseInt(device.device_id),
      ipMgmt: device.ip,
      status: device.status,
      snmpCommunity: device.community,
      popLocation: device.location || null,
      updatedAt: new Date(),
    }));

    const changedNodes = [];
    for (const newValue of newValues) {
      const oldStatus = oldNodesStatusMap.get(newValue.ipMgmt);
      if (oldStatus !== undefined && oldStatus !== newValue.status) {
        changedNodes.push({
          name: newValue.name,
          ipMgmt: newValue.ipMgmt,
          previous_status: oldStatus ? "UP" : "DOWN",
          current_status: newValue.status ? "UP" : "DOWN",
        });
      }
    }

    await db
      .insert(nodes)
      .values(newValues)
      .onConflictDoUpdate({
        target: nodes.ipMgmt,
        set: {
          name: sql`excluded.name`,
          deviceId: sql`excluded.devices_id`,
          snmpCommunity: sql`excluded.snmp_community`,
          popLocation: sql`excluded.pop_location`,
          status: sql`excluded.status`,
          updatedAt: new Date(),
        },
      });

    console.log("Database node sync completed successfully.");

    return c.json({
      message: "Node sync with LibreNMS completed successfully.",
      syncedCount: devicesFromApi.length,
      changes: changedNodes,
    });
  } catch (error) {
    console.error("An error occurred during the node sync process:", error);
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, {
      message: "An internal server error occurred during node sync.",
    });
  }
});

node.post("/sync/interfaces", async (c) => {
  console.log("Starting smart interfaces sync from LibreNMS...");
  const { LIBRENMS_API_TOKEN, LIBRENMS_API_URL } = env<{
    LIBRENMS_API_TOKEN: string;
    LIBRENMS_API_URL: string;
  }>(c);

  if (!LIBRENMS_API_URL || !LIBRENMS_API_TOKEN) {
    throw new HTTPException(500, {
      message: "API credentials for LibreNMS are not configured.",
    });
  }

  try {
    const oldInterfaces = await db.query.interfaces.findMany({
      columns: { id: true, ifOperStatus: true, ifName: true },
      with: { node: { columns: { name: true } } },
    });
    const oldInterfaceStatusMap = new Map(
      oldInterfaces.map((iface) => [
        iface.id,
        {
          status: iface.ifOperStatus,
          name: iface.ifName,
          nodeName: iface.node.name,
        },
      ])
    );

    const allNodesInDb = await db
      .select({
        id: nodes.id,
        deviceId: nodes.deviceId,
        status: nodes.status,
        name: nodes.name,
      })
      .from(nodes);

    if (allNodesInDb.length === 0) {
      return c.json({ message: "No nodes found in local DB.", changes: [] });
    }
    console.log(
      `Found ${allNodesInDb.length} nodes. Checking status for each...`
    );

    let interfacesToUpsert = [];

    const sensorResponse = await fetch(
      `${LIBRENMS_API_URL}/resources/sensors`,
      {
        headers: { "X-Auth-Token": LIBRENMS_API_TOKEN },
      }
    );

    const sensorMap = new Map();
    if (sensorResponse.ok) {
      const sensorData = await sensorResponse.json();
      const opticalSensors = (sensorData.sensors || []).filter(
        (s: any) =>
          s.entPhysicalIndex_measured === "ports" && s.sensor_class === "dbm"
      );

      for (const sensor of opticalSensors) {
        const key = `${sensor.device_id}-${sensor.entPhysicalIndex}`;
        if (!sensorMap.has(key)) {
          sensorMap.set(key, {});
        }
        if (sensor.sensor_index.includes("OpticalTxPower")) {
          sensorMap.get(key).opticalTx = sensor.sensor_current;
        }
        if (sensor.sensor_index.includes("OpticalRxPower")) {
          sensorMap.get(key).opticalRx = sensor.sensor_current;
        }
        // console.log(`Sensor Map Key: ${key}, Sensor:`, sensor);
      }
    }

    for (const node of allNodesInDb) {
      if (node.status === false || node.status === 0) {
        await db
          .update(interfaces)
          .set({ ifOperStatus: 2, updatedAt: new Date() })
          .where(eq(interfaces.nodeId, node.id));
      } else {
        const endpoint = `${LIBRENMS_API_URL}/devices/${node.deviceId}/ports?columns=port_id,ifName,ifDescr,ifAlias,ifOperStatus,ifLastChange,ifIndex`;
        const response = await fetch(endpoint, {
          headers: { "X-Auth-Token": LIBRENMS_API_TOKEN },
        });

        if (!response.ok) {
          console.error(
            `Failed to fetch interfaces for UP device ${node.deviceId}: ${response.statusText}`
          );
          continue;
        }

        const data = await response.json();
        const ports = data.ports || [];

        const mappedPorts = ports.map((port: any) => {
          const key = `${node.deviceId}-${String(port.ifIndex)}`;
          const opticalData = sensorMap.get(key) || {};
          // console.log(`Port Map Key: ${key}, Optical Data:`, opticalData);

          return {
            nodeId: node.id,
            id: port.port_id,
            ifIndex: port.ifIndex,
            ifName: port.ifName,
            ifDescr: port.ifAlias,
            ifOperStatus: port.ifOperStatus === "up" ? 1 : 2,
            lastChange: port.ifLastChange
              ? new Date(port.ifLastChange * 1000)
              : null,
            opticalTx: opticalData.opticalTx || null,
            opticalRx: opticalData.opticalRx || null,
          };
        });
        interfacesToUpsert.push(...mappedPorts);
      }
    }

    if (interfacesToUpsert.length > 0) {
      await db
        .insert(interfaces)
        .values(interfacesToUpsert)
        .onConflictDoUpdate({
          target: [interfaces.nodeId, interfaces.ifIndex],
          set: {
            ifName: sql`excluded.if_name`,
            ifDescr: sql`excluded.if_descr`,
            ifOperStatus: sql`excluded.if_oper_status`,
            opticalTx: sql`excluded.optical_tx`,
            opticalRx: sql`excluded.optical_rx`,
            lastChange: sql`excluded.last_change`,
            updatedAt: new Date(),
          },
        });
    }

    const newInterfaces = await db.query.interfaces.findMany({
      columns: { id: true, ifOperStatus: true, ifName: true, ifDescr: true },
      with: { node: { columns: { name: true } } },
    });
    const changedInterfaces = [];

    for (const newIface of newInterfaces) {
      const oldIface = oldInterfaceStatusMap.get(newIface.id);
      if (oldIface && oldIface.status !== newIface.ifOperStatus) {
        changedInterfaces.push({
          name: newIface.ifName,
          description: newIface.ifDescr,
          nodeName: newIface.node.name,
          previous_status: oldIface.status === 1 ? "UP" : "DOWN",
          current_status: newIface.ifOperStatus === 1 ? "UP" : "DOWN",
        });
      }
    }

    console.log("Database interface sync completed successfully.");

    return c.json({
      message: "Smart interface sync completed successfully.",
      changes: changedInterfaces,
    });
  } catch (error) {
    console.error(
      "An error occurred during the interface sync process:",
      error
    );
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, {
      message: "An internal server error occurred during interface sync.",
    });
  }
});

export default node;

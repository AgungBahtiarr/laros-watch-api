import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { env } from "hono/adapter";
import { HTTPException } from "hono/http-exception";
import { db } from "@/db";
import { lldp } from "@/db/schema";
import { sql } from "drizzle-orm";
import eventBus from "@/utils/event-bus";
import { syncNodes, syncInterfaces, syncVlans } from "@/services/sync";
import { sendChangeNotification } from "@/services/notification";
import {
  fetchAndProcessLldpData,
  fetchMikroTikBridgeVlans,
  fetchHuaweiVrpVlans,
} from "@/services/snmp/index";
import { LldpDataSchema, SyncResponseSchema } from "@/schemas/schemas";

const syncRouter = new OpenAPIHono();

const transportSyncRoute = createRoute({
  method: "post",
  path: "/transport",
  responses: {
    200: {
      description: "Sync result",
      content: {
        "application/json": {
          schema: SyncResponseSchema,
        },
      },
    },
  },
});

syncRouter.openapi(transportSyncRoute, async (c) => {
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

  // Get timeout from query parameter or use default (8 seconds)
  const snmpTimeout = parseInt((c.req.query("timeout") as string) || "8000");

  // Call services directly
  const nodeResult = await syncNodes(libreNmsCreds, snmpTimeout);
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

const syncNodesRoute = createRoute({
  method: "post",
  path: "/sync",
  responses: {
    200: {
      description: "Sync result",
      content: {
        "application/json": {
          schema: SyncResponseSchema,
        },
      },
    },
  },
});

syncRouter.openapi(syncNodesRoute, async (c) => {
  const { LIBRENMS_API_TOKEN, LIBRENMS_API_URL } = env<{
    LIBRENMS_API_TOKEN: string;
    LIBRENMS_API_URL: string;
  }>(c);

  if (!LIBRENMS_API_URL || !LIBRENMS_API_TOKEN) {
    throw new HTTPException(500, {
      message: "API credentials for LibreNMS are not configured.",
    });
  }

  const result = await syncNodes(
    {
      url: LIBRENMS_API_URL,
      token: LIBRENMS_API_TOKEN,
    },
    20000,
  );
  return c.json(result);
});

const lldpSyncRoute = createRoute({
  method: "post",
  path: "/lldp/sync",
  responses: {
    200: {
      description: "LLDP Sync result",
      content: {
        "application/json": {
          schema: SyncResponseSchema.extend({ data: z.array(LldpDataSchema) }),
        },
      },
    },
  },
});

syncRouter.openapi(lldpSyncRoute, async (c) => {
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
            node.ipMgmt as string,
            node.snmpCommunity as string,
          );
          successfulDevices++;
          return { nodeId: node.id, nodeName: node.name, data: lldpData };
        } catch (error) {
          failedDevices++;
          console.error(
            `Failed to fetch LLDP data for node ${node.name}:`,
            error,
          );
          return { nodeId: node.id, nodeName: node.name, data: [] };
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
          target: [
            lldp.nodeId,
            lldp.localPortIfIndex,
            lldp.remoteChassisId,
            lldp.remotePortId,
          ],
          set: {
            localDeviceName: sql`excluded.local_device_name`,
            localPortDescription: sql`excluded.local_port_description`,
            remoteChassisIdSubtypeCode: sql`excluded.remote_chassis_id_subtype_code`,
            remoteChassisIdSubtypeName: sql`excluded.remote_chassis_id_subtype_name`,
            remoteChassisId: sql`excluded.remote_chassis_id`,
            remotePortIdSubtypeCode: sql`excluded.remote_port_id_subtype_code`,
            remotePortIdSubtypeName: sql`excluded.remote_port_id_subtype_name`,
            remotePortId: sql`excluded.remote_port_id`,
            remotePortDescription: sql`excluded.remote_port_description`,
            remoteSystemName: sql`excluded.remote_system_name`,
            remoteSystemDescription: sql`excluded.remote_system_description`,
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

const syncInterfacesRoute = createRoute({
  method: "post",
  path: "/sync/interfaces",
  responses: {
    200: {
      description: "Sync result",
      content: {
        "application/json": {
          schema: SyncResponseSchema,
        },
      },
    },
  },
});

syncRouter.openapi(syncInterfacesRoute, async (c) => {
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

const syncVlansRoute = createRoute({
  method: "post",
  path: "/vlans",
  responses: {
    200: {
      description: "Sync result",
      content: {
        "application/json": {
          schema: SyncResponseSchema,
        },
      },
    },
  },
});

syncRouter.openapi(syncVlansRoute, async (c) => {
  try {
    const result = await syncVlans();
    return c.json(result);
  } catch (error: any) {
    throw new HTTPException(500, {
      message: `Failed to sync VLAN data: ${error.message}`,
    });
  }
});

const testVlansRoute = createRoute({
  method: "post",
  path: "/vlans/test",
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            ip: z.string(),
            community: z.string(),
            os: z.enum(["routeros", "vrp"]).optional().default("routeros"),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "VLAN Test result",
      content: {
        "application/json": {
          schema: SyncResponseSchema,
        },
      },
    },
  },
});

syncRouter.openapi(testVlansRoute, async (c) => {
  try {
    const { ip, community, os } = await c.req.json();

    console.log(`Testing VLAN sync for ${ip} with OS: ${os}`);

    // Mock interface data for testing
    const mockInterfaces = [
      { ifIndex: 1, ifName: "ether1", id: 1 },
      { ifIndex: 2, ifName: "ether2", id: 2 },
      { ifIndex: 3, ifName: "ether3", id: 3 },
      { ifIndex: 4, ifName: "ether4", id: 4 },
      { ifIndex: 5, ifName: "ether5", id: 5 },
    ];

    let vlanData: any[] = [];

    if (os === "routeros") {
      vlanData = await fetchMikroTikBridgeVlans(ip, community, mockInterfaces);
    } else if (os === "vrp") {
      vlanData = await fetchHuaweiVrpVlans(ip, community, mockInterfaces);
    } else {
      throw new HTTPException(400, {
        message: `Unsupported OS: ${os}. Supported: routeros, vrp`,
      });
    }

    return c.json({
      message: `VLAN test completed for ${os} device at ${ip}`,
      syncedCount: vlanData.length,
      testData: vlanData,
      success: true,
    });
  } catch (error: any) {
    throw new HTTPException(500, {
      message: `Failed to test VLAN sync: ${error.message}`,
    });
  }
});

export default syncRouter;

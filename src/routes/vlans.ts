import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { db } from "@/db";
import { vlanInterfaces, nodes, interfaces } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { fetchRouterOSVlans } from "@/services/snmp/index";
import { VlanInterfaceSchema, VlanSummarySchema, SyncResponseSchema } from "./schemas";

const vlanRouter = new OpenAPIHono();

const getVlansRoute = createRoute({
  method: "get",
  path: "/",
  responses: {
    200: {
      description: "List of all VLANs",
      content: {
        "application/json": {
          schema: z.object({
            message: z.string(),
            count: z.number(),
            data: z.array(VlanInterfaceSchema),
          }),
        },
      },
    },
  },
});

vlanRouter.openapi(getVlansRoute, async (c) => {
  try {
    const vlans = await db.query.vlanInterfaces.findMany({
      with: {
        node: {
          columns: { id: true, name: true, ipMgmt: true, os: true },
        },
        interface: {
          columns: { id: true, ifName: true, ifDescr: true },
        },
      },
      orderBy: [vlanInterfaces.nodeId, vlanInterfaces.vlanId],
    });

    return c.json({
      message: "VLANs retrieved successfully",
      count: vlans.length,
      data: vlans,
    });
  } catch (error: any) {
    throw new HTTPException(500, {
      message: `Failed to retrieve VLANs: ${error.message}`,
    });
  }
});

const getVlansByNodeIdRoute = createRoute({
  method: "get",
  path: "/node/:nodeId",
  request: {
    params: z.object({
      nodeId: z.string().openapi({
        param: {
          name: "nodeId",
          in: "path",
        },
        example: "1",
      }),
    }),
  },
  responses: {
    200: {
      description: "List of VLANs for a node",
      content: {
        "application/json": {
          schema: z.object({
            message: z.string(),
            count: z.number(),
            data: z.array(VlanInterfaceSchema),
          }),
        },
      },
    },
  },
});

vlanRouter.openapi(getVlansByNodeIdRoute, async (c) => {
  const nodeId = parseInt(c.req.param("nodeId"));

  if (isNaN(nodeId)) {
    throw new HTTPException(400, {
      message: "Invalid node ID",
    });
  }

  try {
    const vlans = await db.query.vlanInterfaces.findMany({
      where: eq(vlanInterfaces.nodeId, nodeId),
      with: {
        node: {
          columns: { id: true, name: true, ipMgmt: true, os: true },
        },
        interface: {
          columns: { id: true, ifName: true, ifDescr: true },
        },
      },
      orderBy: [vlanInterfaces.vlanId],
    });

    return c.json({
      message: `VLANs for node ${nodeId} retrieved successfully`,
      count: vlans.length,
      data: vlans,
    });
  } catch (error: any) {
    throw new HTTPException(500, {
      message: `Failed to retrieve VLANs for node: ${error.message}`,
    });
  }
});

const getVlanByNodeIdAndVlanIdRoute = createRoute({
  method: "get",
  path: "/node/:nodeId/vlan/:vlanId",
  request: {
    params: z.object({
      nodeId: z.string().openapi({
        param: {
          name: "nodeId",
          in: "path",
        },
        example: "1",
      }),
      vlanId: z.string().openapi({
        param: {
          name: "vlanId",
          in: "path",
        },
        example: "100",
      }),
    }),
  },
  responses: {
    200: {
      description: "A single VLAN",
      content: {
        "application/json": {
          schema: z.object({
            message: z.string(),
            data: VlanSummarySchema,
          }),
        },
      },
    },
    404: {
      description: "VLAN not found",
    },
  },
});

vlanRouter.openapi(getVlanByNodeIdAndVlanIdRoute, async (c) => {
  const nodeId = parseInt(c.req.param("nodeId"));
  const vlanId = parseInt(c.req.param("vlanId"));

  if (isNaN(nodeId) || isNaN(vlanId)) {
    throw new HTTPException(400, {
      message: "Invalid node ID or VLAN ID",
    });
  }

  try {
    const vlans = await db.query.vlanInterfaces.findMany({
      where: and(
        eq(vlanInterfaces.nodeId, nodeId),
        eq(vlanInterfaces.vlanId, vlanId),
      ),
      with: {
        node: {
          columns: { id: true, name: true, ipMgmt: true, os: true },
        },
        interface: {
          columns: { id: true, ifName: true, ifDescr: true },
        },
      },
    });

    if (vlans.length === 0) {
      throw new HTTPException(404, {
        message: `VLAN ${vlanId} not found on node ${nodeId}`,
      });
    }

    // Group by tagged/untagged
    const tagged = vlans.filter((vlan) => vlan.isTagged);
    const untagged = vlans.filter((vlan) => !vlan.isTagged);

    return c.json({
      message: `VLAN ${vlanId} on node ${nodeId} retrieved successfully`,
      data: {
        nodeId,
        vlanId,
        node: vlans[0].node,
        name: vlans[0].name,
        description: vlans[0].description,
        tagged: tagged.map((v) => v.interface),
        untagged: untagged.map((v) => v.interface),
        totalInterfaces: vlans.length,
      },
    });
  } catch (error: any) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, {
      message: `Failed to retrieve VLAN: ${error.message}`,
    });
  }
});

const getVlansByInterfaceIdRoute = createRoute({
  method: "get",
  path: "/interface/:interfaceId",
  request: {
    params: z.object({
      interfaceId: z.string().openapi({
        param: {
          name: "interfaceId",
          in: "path",
        },
        example: "1",
      }),
    }),
  },
  responses: {
    200: {
      description: "List of VLANs for an interface",
      content: {
        "application/json": {
          schema: z.object({
            message: z.string(),
            count: z.number(),
            data: z.array(VlanInterfaceSchema),
          }),
        },
      },
    },
  },
});

vlanRouter.openapi(getVlansByInterfaceIdRoute, async (c) => {
  const interfaceId = parseInt(c.req.param("interfaceId"));

  if (isNaN(interfaceId)) {
    throw new HTTPException(400, {
      message: "Invalid interface ID",
    });
  }

  try {
    const vlans = await db.query.vlanInterfaces.findMany({
      where: eq(vlanInterfaces.interfaceId, interfaceId),
      with: {
        node: {
          columns: { id: true, name: true, ipMgmt: true, os: true },
        },
        interface: {
          columns: { id: true, ifName: true, ifDescr: true },
        },
      },
      orderBy: [vlanInterfaces.vlanId],
    });

    return c.json({
      message: `VLANs for interface ${interfaceId} retrieved successfully`,
      count: vlans.length,
      data: vlans,
    });
  } catch (error: any) {
    throw new HTTPException(500, {
      message: `Failed to retrieve VLANs for interface: ${error.message}`,
    });
  }
});

const getVlanSummaryByNodeRoute = createRoute({
  method: "get",
  path: "/summary/node/:nodeId",
  request: {
    params: z.object({
      nodeId: z.string().openapi({
        param: {
          name: "nodeId",
          in: "path",
        },
        example: "1",
      }),
    }),
  },
  responses: {
    200: {
      description: "VLAN summary for a node",
      content: {
        "application/json": {
          schema: z.object({
            message: z.string(),
            node: z.any(),
            count: z.number(),
            data: z.array(VlanSummarySchema),
          }),
        },
      },
    },
  },
});

vlanRouter.openapi(getVlanSummaryByNodeRoute, async (c) => {
  const nodeId = parseInt(c.req.param("nodeId"));

  if (isNaN(nodeId)) {
    throw new HTTPException(400, {
      message: "Invalid node ID",
    });
  }

  try {
    const vlans = await db.query.vlanInterfaces.findMany({
      where: eq(vlanInterfaces.nodeId, nodeId),
      with: {
        node: {
          columns: { id: true, name: true, ipMgmt: true, os: true },
        },
        interface: {
          columns: { id: true, ifName: true, ifDescr: true },
        },
      },
      orderBy: [vlanInterfaces.vlanId],
    });

    // Group VLANs by VLAN ID
    const vlanGroups = vlans.reduce((acc: any, vlan) => {
      const vlanId = vlan.vlanId;
      if (!acc[vlanId]) {
        acc[vlanId] = {
          vlanId,
          name: vlan.name,
          description: vlan.description,
          tagged: [],
          untagged: [],
        };
      }

      if (vlan.isTagged) {
        acc[vlanId].tagged.push(vlan.interface);
      } else {
        acc[vlanId].untagged.push(vlan.interface);
      }

      return acc;
    }, {});

    const summary = Object.values(vlanGroups);

    return c.json({
      message: `VLAN summary for node ${nodeId} retrieved successfully`,
      node: vlans[0]?.node || null,
      count: summary.length,
      data: summary,
    });
  } catch (error: any) {
    throw new HTTPException(500, {
      message: `Failed to retrieve VLAN summary: ${error.message}`,
    });
  }
});

const syncVlansFromNodeRoute = createRoute({
  method: "post",
  path: "/sync/node/:nodeId",
  request: {
    params: z.object({
      nodeId: z.string().openapi({
        param: {
          name: "nodeId",
          in: "path",
        },
        example: "1",
      }),
    }),
  },
  responses: {
    200: {
      description: "VLAN sync result",
      content: {
        "application/json": {
          schema: SyncResponseSchema,
        },
      },
    },
  },
});

vlanRouter.openapi(syncVlansFromNodeRoute, async (c) => {
  const nodeId = parseInt(c.req.param("nodeId"));

  if (isNaN(nodeId)) {
    throw new HTTPException(400, {
      message: "Invalid node ID",
    });
  }

  try {
    // Get node information
    const node = await db.query.nodes.findFirst({
      where: eq(nodes.id, nodeId),
      with: {
        interfaces: true,
      },
    });

    if (!node) {
      throw new HTTPException(404, {
        message: `Node with ID ${nodeId} not found`,
      });
    }

    console.log(
      `[VLAN-SYNC] Starting VLAN sync for node ${node.name} (${node.ipMgmt})`,
    );

    // Fetch VLAN data from device with interface data for dynamic mapping
    const vlanData = await fetchRouterOSVlans(
      node.ipMgmt,
      node.snmpCommunity,
      node.interfaces,
    );

    if (vlanData.length === 0) {
      return c.json({
        message: `No VLAN data found for node ${node.name}`,
        nodeId,
        synced: 0,
        skipped: 0,
      });
    }

    let synced = 0;
    let skipped = 0;

    // Process each VLAN
    for (const vlan of vlanData) {
      try {
        // Skip VLAN 1 and 99 as they should not be inserted into database
        if (vlan.vlanId === 1 || vlan.vlanId === 99) {
          console.log(
            `[VLAN-SYNC] Skipping VLAN ${vlan.vlanId} for node ${node.name} (excluded from sync)`,
          );
          skipped++;
          continue;
        }

        // Parse tagged and untagged ports
        const taggedPortNames = vlan.taggedPorts
          ? vlan.taggedPorts.split(",").filter((p: string) => p.trim())
          : [];
        const untaggedPortNames = vlan.untaggedPorts
          ? vlan.untaggedPorts.split(",").filter((p: string) => p.trim())
          : [];

        // Create interface mappings
        const interfaceMap = new Map();
        node.interfaces.forEach((iface) => {
          if (iface.ifName) {
            interfaceMap.set(iface.ifName, iface);
          }
          if (iface.ifDescr && iface.ifDescr !== iface.ifName) {
            interfaceMap.set(iface.ifDescr, iface);
          }
        });

        // Process tagged ports
        for (const portName of taggedPortNames) {
          const trimmedPortName = portName.trim();
          const iface = interfaceMap.get(trimmedPortName);

          if (iface) {
            try {
              await db
                .insert(vlanInterfaces)
                .values({
                  nodeId: nodeId,
                  vlanId: vlan.vlanId,
                  interfaceId: iface.id,
                  isTagged: true,
                  name: vlan.name,
                  description: vlan.description,
                })
                .onConflictDoUpdate({
                  target: [
                    vlanInterfaces.nodeId,
                    vlanInterfaces.vlanId,
                    vlanInterfaces.interfaceId,
                  ],
                  set: {
                    isTagged: true,
                    name: vlan.name,
                    description: vlan.description,
                    updatedAt: new Date(),
                  },
                });
              synced++;
            } catch (insertError) {
              console.warn(
                `[VLAN-SYNC] Failed to sync tagged VLAN ${vlan.vlanId} for port ${trimmedPortName}:`,
                insertError,
              );
              skipped++;
            }
          } else {
            console.warn(
              `[VLAN-SYNC] Interface ${trimmedPortName} not found in database for VLAN ${vlan.vlanId}`,
            );
            skipped++;
          }
        }

        // Process untagged ports
        for (const portName of untaggedPortNames) {
          const trimmedPortName = portName.trim();
          const iface = interfaceMap.get(trimmedPortName);

          if (iface) {
            try {
              await db
                .insert(vlanInterfaces)
                .values({
                  nodeId: nodeId,
                  vlanId: vlan.vlanId,
                  interfaceId: iface.id,
                  isTagged: false,
                  name: vlan.name,
                  description: vlan.description,
                })
                .onConflictDoUpdate({
                  target: [
                    vlanInterfaces.nodeId,
                    vlanInterfaces.vlanId,
                    vlanInterfaces.interfaceId,
                  ],
                  set: {
                    isTagged: false,
                    name: vlan.name,
                    description: vlan.description,
                    updatedAt: new Date(),
                  },
                });
              synced++;
            } catch (insertError) {
              console.warn(
                `[VLAN-SYNC] Failed to sync untagged VLAN ${vlan.vlanId} for port ${trimmedPortName}:`,
                insertError,
              );
              skipped++;
            }
          } else {
            console.warn(
              `[VLAN-SYNC] Interface ${trimmedPortName} not found in database for VLAN ${vlan.vlanId}`,
            );
            skipped++;
          }
        }
      } catch (vlanError) {
        console.error(
          `[VLAN-SYNC] Error processing VLAN ${vlan.vlanId}:`,
          vlanError,
        );
        skipped++;
      }
    }

    console.log(
      `[VLAN-SYNC] Completed VLAN sync for node ${node.name}: ${synced} synced, ${skipped} skipped`,
    );

    return c.json({
      message: `VLAN sync completed for node ${node.name}`,
      nodeId,
      nodeName: node.name,
      totalVlansFound: vlanData.length,
      synced,
      skipped,
      data: vlanData.map((v) => ({
        vlanId: v.vlanId,
        name: v.name,
        taggedPorts: v.taggedPorts,
        untaggedPorts: v.untaggedPorts,
        tableUsed: v.tableUsed,
      })),
    });
  } catch (error: any) {
    if (error instanceof HTTPException) throw error;
    console.error(`[VLAN-SYNC] Error syncing VLANs for node ${nodeId}:`, error);
    throw new HTTPException(500, {
      message: `Failed to sync VLANs: ${error.message}`,
    });
  }
});

const testVlanFetchingRoute = createRoute({
  method: "get",
  path: "/test/node/:nodeId",
  request: {
    params: z.object({
      nodeId: z.string().openapi({
        param: {
          name: "nodeId",
          in: "path",
        },
        example: "1",
      }),
    }),
  },
  responses: {
    200: {
      description: "VLAN test result",
      content: {
        "application/json": {
          schema: SyncResponseSchema,
        },
      },
    },
  },
});

vlanRouter.openapi(testVlanFetchingRoute, async (c) => {
  const nodeId = parseInt(c.req.param("nodeId"));

  if (isNaN(nodeId)) {
    throw new HTTPException(400, {
      message: "Invalid node ID",
    });
  }

  try {
    // Get node information
    const node = await db.query.nodes.findFirst({
      where: eq(nodes.id, nodeId),
    });

    if (!node) {
      throw new HTTPException(404, {
        message: `Node with ID ${nodeId} not found`,
      });
    }

    console.log(
      `[VLAN-TEST] Testing VLAN fetch for node ${node.name} (${node.ipMgmt})`,
    );

    // Get node with interfaces for dynamic mapping
    const nodeWithInterfaces = await db.query.nodes.findFirst({
      where: eq(nodes.id, nodeId),
      with: {
        interfaces: true,
      },
    });

    if (!nodeWithInterfaces) {
      throw new HTTPException(404, {
        message: `Node with ID ${nodeId} not found`,
      });
    }

    // Fetch VLAN data from device with interface data for dynamic mapping
    const vlanData = await fetchRouterOSVlans(
      nodeWithInterfaces.ipMgmt,
      nodeWithInterfaces.snmpCommunity,
      nodeWithInterfaces.interfaces,
    );

    return c.json({
      message: `VLAN test completed for node ${nodeWithInterfaces.name}`,
      nodeId,
      nodeName: nodeWithInterfaces.name,
      ipAddress: nodeWithInterfaces.ipMgmt,
      totalVlansFound: vlanData.length,
      success: vlanData.length > 0,
      data: vlanData,
    });
  } catch (error: any) {
    if (error instanceof HTTPException) throw error;
    console.error(`[VLAN-TEST] Error testing VLANs for node ${nodeId}:`, error);
    throw new HTTPException(500, {
      message: `Failed to test VLANs: ${error.message}`,
    });
  }
});

const updateSnmpCommunityRoute = createRoute({
  method: "patch",
  path: "/node/:nodeId/community",
  request: {
    params: z.object({
      nodeId: z.string().openapi({
        param: {
          name: "nodeId",
          in: "path",
        },
        example: "1",
      }),
    }),
    body: {
      content: {
        "application/json": {
          schema: z.object({ community: z.string() }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "SNMP community updated",
      content: {
        "application/json": {
          schema: z.object({
            message: z.string(),
            nodeId: z.number(),
            nodeName: z.string(),
            ipAddress: z.string(),
            community: z.string(),
          }),
        },
      },
    },
  },
});

vlanRouter.openapi(updateSnmpCommunityRoute, async (c) => {
  const nodeId = parseInt(c.req.param("nodeId"));
  const body = await c.req.json();
  const { community } = body;

  if (isNaN(nodeId)) {
    throw new HTTPException(400, {
      message: "Invalid node ID",
    });
  }

  if (!community || typeof community !== "string") {
    throw new HTTPException(400, {
      message: "Community string is required",
    });
  }

  try {
    const node = await db.query.nodes.findFirst({
      where: eq(nodes.id, nodeId),
    });

    if (!node) {
      throw new HTTPException(404, {
        message: `Node with ID ${nodeId} not found`,
      });
    }

    // Update the SNMP community
    await db
      .update(nodes)
      .set({
        snmpCommunity: community,
        updatedAt: new Date(),
      })
      .where(eq(nodes.id, nodeId));

    console.log(
      `[VLAN-UPDATE] Updated SNMP community for node ${node.name} (${node.ipMgmt}) to: ${community}`,
    );

    return c.json({
      message: `SNMP community updated for node ${node.name}`,
      nodeId,
      nodeName: node.name,
      ipAddress: node.ipMgmt,
      community,
    });
  } catch (error: any) {
    if (error instanceof HTTPException) throw error;
    console.error(
      `[VLAN-UPDATE] Error updating SNMP community for node ${nodeId}:`,
      error,
    );
    throw new HTTPException(500, {
      message: `Failed to update SNMP community: ${error.message}`,
    });
  }
});

export default vlanRouter;

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { db } from "@/db";
import { vlanInterfaces, nodes, interfaces } from "@/db/schema";
import { eq, and } from "drizzle-orm";

const vlanRouter = new Hono();

// Get all VLANs
vlanRouter.get("/", async (c) => {
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

// Get VLANs by node ID
vlanRouter.get("/node/:nodeId", async (c) => {
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

// Get specific VLAN by node ID and VLAN ID
vlanRouter.get("/node/:nodeId/vlan/:vlanId", async (c) => {
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

// Get VLANs by interface ID
vlanRouter.get("/interface/:interfaceId", async (c) => {
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

// Get VLAN summary by node (grouped by VLAN ID)
vlanRouter.get("/summary/node/:nodeId", async (c) => {
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

export default vlanRouter;

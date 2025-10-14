import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { db } from "@/db";
import { vlanInterfaces } from "@/db/schema";

import { VlanInterfaceSchema } from "@/schemas/schemas";

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

export default vlanRouter;

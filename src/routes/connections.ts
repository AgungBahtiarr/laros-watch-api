import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { db } from "@/db";
import { connections, customRoutes, interfaces, nodes, odp } from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { ConnectionSchema, ConnectionsSchema, CustomRouteSchema } from "./schemas";

const connectionsRouter = new OpenAPIHono();

const getConnectionsRoute = createRoute({
  method: "get",
  path: "/",
  responses: {
    200: {
      description: "List of all connections",
      content: {
        "application/json": {
          schema: ConnectionsSchema,
        },
      },
    },
  },
});

connectionsRouter.openapi(getConnectionsRoute, async (c) => {
  const allConnections = await db.query.connections.findMany({
    with: {
      customRoute: true,
    },
  });

  const odpIds = new Set<number>();
  allConnections.forEach((conn) => {
    if (conn.odpPath) {
      conn.odpPath.forEach((id) => odpIds.add(id));
    }
  });

  if (odpIds.size > 0) {
    const odps = await db
      .select()
      .from(odp)
      .where(inArray(odp.id, Array.from(odpIds)));
    const odpsById = new Map(odps.map((o) => [o.id, o]));

    const connectionsWithOdps = allConnections.map((conn) => {
      const odpPathDetails = conn.odpPath
        ? conn.odpPath.map((id) => odpsById.get(id)).filter(Boolean)
        : [];
      return { ...conn, odpPath: odpPathDetails };
    });
    return c.json(connectionsWithOdps);
  }

  return c.json(allConnections);
});

const createConnectionRoute = createRoute({
  method: "post",
  path: "/",
  request: {
    body: {
      content: {
        "application/json": {
          schema: ConnectionSchema.omit({ id: true, createdAt: true, updatedAt: true }),
        },
      },
    },
  },
  responses: {
    201: {
      description: "A new connection",
      content: {
        "application/json": {
          schema: ConnectionSchema,
        },
      },
    },
    400: {
      description: "Invalid request",
    },
  },
});

connectionsRouter.openapi(createConnectionRoute, async (c) => {
  try {
    const body = await c.req.json();

    const { deviceAId, portAId, deviceBId, portBId, description, odpPath } =
      body || {};

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

    if (odpPath && (!Array.isArray(odpPath) || odpPath.some((id) => typeof id !== "number"))) {
      return c.json({ error: "Invalid payload. odpPath must be an array of numbers." }, 400);
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
          odpPath: odpPath,
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
          odpPath: odpPath,
          updatedAt: new Date(),
        })
        .returning();
      saved = inserted;
    }

    const withRelation = await db.query.connections.findFirst({
      where: eq(connections.id, saved.id),
      with: { customRoute: true },
    });

    if (withRelation && withRelation.odpPath && withRelation.odpPath.length > 0) {
      const odps = await db
        .select()
        .from(odp)
        .where(inArray(odp.id, withRelation.odpPath));
      const odpsById = new Map(odps.map((o) => [o.id, o]));
      const odpPathDetails = withRelation.odpPath
        .map((id) => odpsById.get(id))
        .filter(Boolean);
      const result = { ...withRelation, odpPath: odpPathDetails };
      return c.json(result, existing ? 200 : 201);
    }

    return c.json(withRelation ?? saved, existing ? 200 : 201);
  } catch (error: any) {
    throw new HTTPException(500, {
      message: `Failed to create connection: ${error.message}`,
    });
  }
});

const createCustomRouteRoute = createRoute({
  method: "post",
  path: "/:id/custom-route",
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
    body: {
      content: {
        "application/json": {
          schema: z.object({ coordinates: z.array(z.number()) }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "A new custom route",
      content: {
        "application/json": {
          schema: CustomRouteSchema,
        },
      },
    },
    400: {
      description: "Invalid request",
    },
  },
});

connectionsRouter.openapi(createCustomRouteRoute, async (c) => {
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

const updateConnectionRoute = createRoute({
  method: "put",
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
    body: {
      content: {
        "application/json": {
          schema: ConnectionSchema.omit({ id: true, createdAt: true, updatedAt: true }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Updated connection",
      content: {
        "application/json": {
          schema: ConnectionSchema,
        },
      },
    },
    404: {
      description: "Connection not found",
    },
  },
});

connectionsRouter.openapi(updateConnectionRoute, async (c) => {
  try {
    const id = parseInt(c.req.param("id"));
    const body = await c.req.json();
    const { deviceAId, portAId, deviceBId, portBId, description, odpPath } =
      body || {};

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

    if (typeof odpPath !== "undefined") {
      if (odpPath !== null && (!Array.isArray(odpPath) || odpPath.some((id) => typeof id !== "number"))) {
        return c.json({ error: "Invalid odpPath. Must be an array of numbers or null." }, 400);
      }
      updatePayload.odpPath = odpPath;
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

    if (withRelation && withRelation.odpPath && withRelation.odpPath.length > 0) {
      const odps = await db
        .select()
        .from(odp)
        .where(inArray(odp.id, withRelation.odpPath));
      const odpsById = new Map(odps.map((o) => [o.id, o]));
      const odpPathDetails = withRelation.odpPath
        .map((id) => odpsById.get(id))
        .filter(Boolean);
      const result = { ...withRelation, odpPath: odpPathDetails };
      return c.json(result);
    }

    return c.json(withRelation ?? updated);
  } catch (error: any) {
    throw new HTTPException(500, {
      message: `Failed to update connection: ${error.message}`,
    });
  }
});

const deleteConnectionRoute = createRoute({
  method: "delete",
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
      description: "Connection deleted successfully",
    },
    404: {
      description: "Connection not found",
    },
  },
});

connectionsRouter.openapi(deleteConnectionRoute, async (c) => {
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

const deleteCustomRouteRoute = createRoute({
  method: "delete",
  path: "/:id/custom-route",
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
      description: "Custom route deleted successfully",
    },
  },
});

connectionsRouter.openapi(deleteCustomRouteRoute, async (c) => {
  const connectionId = parseInt(c.req.param("id"));

  await db
    .delete(customRoutes)
    .where(eq(customRoutes.connectionId, connectionId));

  return c.json({ message: "Custom route deleted" });
});

export default connectionsRouter;

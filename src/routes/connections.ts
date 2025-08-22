import { Hono } from 'hono';
import { db } from '@/db';
import { connections, customRoutes, interfaces, nodes } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';

const connectionsRouter = new Hono();

// GET /connections
connectionsRouter.get("/", async (c) => {
  const allConnections = await db.query.connections.findMany({
    with: {
      customRoute: true,
      odp: true,
    },
  });
  return c.json(allConnections);
});

// POST /connections
connectionsRouter.post("/", async (c) => {
    try {
        const body = await c.req.json();

        const { deviceAId, portAId, deviceBId, portBId, description, odpId } =
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

        if (typeof odpId !== "undefined" && odpId !== null && typeof odpId !== "number") {
          return c.json({ error: "Invalid payload. odpId must be a number." }, 400);
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
              odpId: odpId,
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
              odpId: odpId,
              updatedAt: new Date(),
            })
            .returning();
          saved = inserted;
        }

        const withRelation = await db.query.connections.findFirst({
          where: eq(connections.id, saved.id),
          with: { customRoute: true, odp: true },
        });

        return c.json(withRelation ?? saved, existing ? 200 : 201);
      } catch (error: any) {
        throw new HTTPException(500, {
          message: `Failed to create connection: ${error.message}`,
        });
      }
});

// POST /connections/:id/custom-route
connectionsRouter.post("/:id/custom-route", async (c) => {
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

// PUT /connections/:id
connectionsRouter.put("/:id", async (c) => {
    try {
        const id = parseInt(c.req.param("id"));
        const body = await c.req.json();
        const { deviceAId, portAId, deviceBId, portBId, description, odpId } =
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

        if (typeof odpId !== "undefined") {
          if (odpId !== null && typeof odpId !== "number") {
            return c.json({ error: "Invalid odpId. Must be a number or null." }, 400);
          }
          updatePayload.odpId = odpId;
        }

        const [updated] = await db
          .update(connections)
          .set(updatePayload)
          .where(eq(connections.id, id))
          .returning();

        const withRelation = await db.query.connections.findFirst({
          where: eq(connections.id, updated.id),
          with: { customRoute: true, odp: true },
        });

        return c.json(withRelation ?? updated);
      } catch (error: any) {
        throw new HTTPException(500, {
          message: `Failed to update connection: ${error.message}`,
        });
      }
});

// DELETE /connections/:id
connectionsRouter.delete("/:id", async (c) => {
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

// DELETE /connections/:id/custom-route
connectionsRouter.delete("/:id/custom-route", async (c) => {
    const connectionId = parseInt(c.req.param("id"));

    await db
        .delete(customRoutes)
        .where(eq(customRoutes.connectionId, connectionId));

    return c.json({ message: "Custom route deleted" });
});


export default connectionsRouter;

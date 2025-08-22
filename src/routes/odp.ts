import { Hono } from 'hono';
import { db } from '@/db';
import { odp, connections } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';

const odpRouter = new Hono();

// ODP Endpoints
odpRouter.get("/", async (c) => {
    const allOdp = await db.query.odp.findMany({
      with: {
        connections: true,
      },
    });
    return c.json(allOdp);
  });
  
odpRouter.get("/:id", async (c) => {
    const id = parseInt(c.req.param("id"));
    const odpItem = await db.query.odp.findFirst({
      where: eq(odp.id, id),
      with: {
        connections: true,
      },
    });
  
    if (!odpItem) {
      return c.json({ error: "ODP not found" }, 404);
    }
    return c.json(odpItem);
  });
  
odpRouter.post("/", async (c) => {
    try {
      const body = await c.req.json();
      const { name, location, lat, lng } = body || {};
  
      if (!name || typeof name !== "string") {
        return c.json(
          { error: "Invalid payload. `name` is required and must be a string." },
          400,
        );
      }
  
      const [newOdp] = await db
        .insert(odp)
        .values({
          name,
          location,
          lat,
          lng,
          updatedAt: new Date(),
        })
        .returning();
  
      return c.json(newOdp, 201);
    } catch (error: any) {
      throw new HTTPException(500, {
        message: `Failed to create ODP: ${error.message}`,
      });
    }
  });
  
odpRouter.put("/:id", async (c) => {
    try {
      const id = parseInt(c.req.param("id"));
      const body = await c.req.json();
      const { name, location, lat, lng } = body || {};
  
      const existing = await db.query.odp.findFirst({
        where: eq(odp.id, id),
      });
  
      if (!existing) {
        return c.json({ error: "ODP not found" }, 404);
      }
  
      const updatePayload: any = {
        updatedAt: new Date(),
      };
  
      if (typeof name === "string") {
        updatePayload.name = name;
      }
      if (typeof location !== "undefined") {
        updatePayload.location = location;
      }
      if (typeof lat !== "undefined") {
        updatePayload.lat = lat;
      }
      if (typeof lng !== "undefined") {
        updatePayload.lng = lng;
      }
  
      const [updatedOdp] = await db
        .update(odp)
        .set(updatePayload)
        .where(eq(odp.id, id))
        .returning();
  
      return c.json(updatedOdp);
    } catch (error: any) {
      throw new HTTPException(500, {
        message: `Failed to update ODP: ${error.message}`,
      });
    }
  });
  
odpRouter.delete("/:id", async (c) => {
    try {
      const id = parseInt(c.req.param("id"));
  
      const existing = await db.query.odp.findFirst({
        where: eq(odp.id, id),
      });
  
      if (!existing) {
        return c.json({ error: "ODP not found" }, 404);
      }
  
      const connectionsInUse = await db.query.connections.findFirst({
        where: eq(connections.odpId, id),
      });
  
      if (connectionsInUse) {
        return c.json(
          {
            error:
              "Cannot delete ODP. It is currently in use by one or more connections.",
          },
          409,
        );
      }
  
      await db.delete(odp).where(eq(odp.id, id));
  
      return c.json({ message: "ODP deleted" });
    } catch (error: any) {
      throw new HTTPException(500, {
        message: `Failed to delete ODP: ${error.message}`,
      });
    }
  });

export default odpRouter;

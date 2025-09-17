import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { db } from "@/db";
import { odp, connections } from "@/db/schema";
import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { OdpSchema, OdpsSchema } from "./schemas";

const odpRouter = new OpenAPIHono();

const getOdpsRoute = createRoute({
  method: "get",
  path: "/",
  responses: {
    200: {
      description: "List of all ODPs",
      content: {
        "application/json": {
          schema: OdpsSchema,
        },
      },
    },
  },
});

odpRouter.openapi(getOdpsRoute, async (c) => {
  const allOdp = await db.query.odp.findMany({
    with: {
      connections: true,
    },
  });
  return c.json(allOdp);
});

const getOdpByIdRoute = createRoute({
  method: "get",
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
      description: "A single ODP",
      content: {
        "application/json": {
          schema: OdpSchema,
        },
      },
    },
    404: {
      description: "ODP not found",
    },
  },
});

odpRouter.openapi(getOdpByIdRoute, async (c) => {
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

const createOdpRoute = createRoute({
  method: "post",
  path: "/",
  request: {
    body: {
      content: {
        "application/json": {
          schema: OdpSchema.omit({ id: true, createdAt: true, updatedAt: true }),
        },
      },
    },
  },
  responses: {
    201: {
      description: "A new ODP",
      content: {
        "application/json": {
          schema: OdpSchema,
        },
      },
    },
    400: {
      description: "Invalid request",
    },
  },
});

odpRouter.openapi(createOdpRoute, async (c) => {
  try {
    const body = await c.req.json();
    const { name, location, lat, lng, notes } = body || {};

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
        notes,
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

const updateOdpRoute = createRoute({
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
          schema: OdpSchema.omit({ id: true, createdAt: true, updatedAt: true }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Updated ODP",
      content: {
        "application/json": {
          schema: OdpSchema,
        },
      },
    },
    404: {
      description: "ODP not found",
    },
  },
});

odpRouter.openapi(updateOdpRoute, async (c) => {
  try {
    const id = parseInt(c.req.param("id"));
    const body = await c.req.json();
    const { name, location, lat, lng, notes } = body || {};

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
    if (typeof notes !== "undefined") {
      updatePayload.notes = notes;
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

const deleteOdpRoute = createRoute({
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
      description: "ODP deleted successfully",
    },
    404: {
      description: "ODP not found",
    },
    409: {
      description: "ODP is in use",
    },
  },
});

odpRouter.openapi(deleteOdpRoute, async (c) => {
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


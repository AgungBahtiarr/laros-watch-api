import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import {
  getDomains,
  getDomain,
  createDomain,
  refreshDomain,
  deleteDomain,
} from "../services/domain";
import { DomainSchema, DomainsSchema } from "@/schemas/schemas";

const domains = new OpenAPIHono();

const getDomainsRoute = createRoute({
  method: "get",
  path: "/",
  responses: {
    200: {
      description: "List of all domains",
      content: {
        "application/json": {
          schema: DomainsSchema,
        },
      },
    },
  },
});

domains.openapi(getDomainsRoute, async (c) => {
  try {
    const allDomains = await getDomains();
    return c.json(allDomains);
  } catch (error) {
    console.error("Error fetching domains:", error);
    return c.json({ error: "Internal Server Error" }, 500);
  }
});

const getDomainByIdRoute = createRoute({
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
      description: "A single domain",
      content: {
        "application/json": {
          schema: DomainSchema,
        },
      },
    },
    404: {
      description: "Domain not found",
    },
  },
});

domains.openapi(getDomainByIdRoute, async (c) => {
  try {
    const id = parseInt(c.req.param("id"));
    const domain = await getDomain(id);
    if (!domain) {
      return c.json({ error: "Domain not found" }, 404);
    }
    return c.json(domain);
  } catch (error) {
    console.error("Error fetching domain:", error);
    return c.json({ error: "Internal Server Error" }, 500);
  }
});

const createDomainRoute = createRoute({
  method: "post",
  path: "/",
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({ name: z.string() }),
        },
      },
    },
  },
  responses: {
    201: {
      description: "A new domain",
      content: {
        "application/json": {
          schema: DomainSchema,
        },
      },
    },
    400: {
      description: "Invalid request",
    },
  },
});

domains.openapi(createDomainRoute, async (c) => {
  try {
    const { name } = await c.req.json();
    if (!name) {
      return c.json({ error: "Domain name is required" }, 400);
    }
    const newDomain = await createDomain(name);
    return c.json(newDomain, 201);
  } catch (error) {
    console.error("Error creating domain:", error);
    return c.json({ error: "Internal Server Error" }, 500);
  }
});

const refreshDomainRoute = createRoute({
  method: "post",
  path: "/:id/refresh",
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
      description: "Refreshed domain",
      content: {
        "application/json": {
          schema: DomainSchema,
        },
      },
    },
    404: {
      description: "Domain not found",
    },
  },
});

domains.openapi(refreshDomainRoute, async (c) => {
  try {
    const id = parseInt(c.req.param("id"));
    const updatedDomain = await refreshDomain(id);
    if (!updatedDomain) {
      return c.json({ error: "Domain not found" }, 404);
    }
    return c.json(updatedDomain);
  } catch (error) {
    console.error("Error refreshing domain:", error);
    return c.json({ error: "Internal Server Error" }, 500);
  }
});

const deleteDomainRoute = createRoute({
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
      description: "Domain deleted successfully",
    },
    404: {
      description: "Domain not found",
    },
  },
});

domains.openapi(deleteDomainRoute, async (c) => {
  try {
    const id = parseInt(c.req.param("id"));
    const deletedDomain = await deleteDomain(id);
    if (!deletedDomain) {
      return c.json({ error: "Domain not found" }, 404);
    }
    return c.json({ message: "Domain deleted successfully" });
  } catch (error) {
    console.error("Error deleting domain:", error);
    return c.json({ error: "Internal Server Error" }, 500);
  }
});

export default domains;

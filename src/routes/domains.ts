import { Hono } from "hono";
import {
  getDomains,
  getDomain,
  createDomain,
  refreshDomain,
  deleteDomain,
} from "../services/domain";

const domains = new Hono();

// GET /domains
domains.get("/", async (c) => {
  try {
    const allDomains = await getDomains();
    return c.json(allDomains);
  } catch (error) {
    console.error("Error fetching domains:", error);
    return c.json({ error: "Internal Server Error" }, 500);
  }
});

// GET /domains/:id
domains.get("/:id", async (c) => {
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

// POST /domains
domains.post("/", async (c) => {
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

// POST /domains/:id/refresh
domains.post("/:id/refresh", async (c) => {
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

// DELETE /domains/:id
domains.delete("/:id", async (c) => {
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

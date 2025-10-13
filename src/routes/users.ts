import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";

const app = new OpenAPIHono();

// Get all users
app.openapi(
  createRoute({
    method: "get",
    path: "/",
    responses: {
      200: {
        description: "List of users",
        content: {
          "application/json": {
            schema: z.array(
              z.object({
                id: z.number(),
                username: z.string(),
                createdAt: z.string().datetime(),
                updatedAt: z.string().datetime(),
              })
            ),
          },
        },
      },
    },
  }),
  async (c) => {
    const allUsers = await db
      .select({
        id: users.id,
        username: users.username,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      })
      .from(users)
      .orderBy(desc(users.createdAt));
    return c.json(allUsers);
  }
);

// Get one user
app.openapi(
  createRoute({
    method: "get",
    path: "/{id}",
    request: {
      params: z.object({
        id: z.string(),
      }),
    },
    responses: {
      200: {
        description: "A user",
        content: {
          "application/json": {
            schema: z.object({
              id: z.number(),
              username: z.string(),
              createdAt: z.string().datetime(),
              updatedAt: z.string().datetime(),
            }),
          },
        },
      },
      404: {
        description: "User not found",
      },
    },
  }),
  async (c) => {
    const id = parseInt(c.req.param("id"));
    const user = await db.query.users.findFirst({
      where: eq(users.id, id),
      columns: {
        password: false,
      },
    });
    if (!user) {
      throw new HTTPException(404, { message: "User not found" });
    }
    return c.json(user);
  }
);

// Create a user
const CreateUserSchema = z.object({
  username: z.string(),
  password: z.string(),
});

app.openapi(
  createRoute({
    method: "post",
    path: "/",
    request: {
      body: {
        content: {
          "application/json": {
            schema: CreateUserSchema,
          },
        },
      },
    },
    responses: {
      201: {
        description: "User created",
        content: {
          "application/json": {
            schema: z.object({
              id: z.number(),
              username: z.string(),
            }),
          },
        },
      },
    },
  }),
  async (c) => {
    const { username, password } = await c.req.json();
    const hashedPassword = await Bun.password.hash(password);
    const result = await db
      .insert(users)
      .values({
        username,
        password: hashedPassword,
      })
      .returning({
        id: users.id,
        username: users.username,
      });
    return c.json(result[0], 201);
  }
);

// Update a user
const UpdateUserSchema = z.object({
  username: z.string().optional(),
  password: z.string().optional(),
});

app.openapi(
  createRoute({
    method: "put",
    path: "/{id}",
    request: {
      params: z.object({
        id: z.string(),
      }),
      body: {
        content: {
          "application/json": {
            schema: UpdateUserSchema,
          },
        },
      },
    },
    responses: {
      200: {
        description: "User updated",
        content: {
          "application/json": {
            schema: z.object({
              id: z.number(),
              username: z.string(),
            }),
          },
        },
      },
      404: {
        description: "User not found",
      },
    },
  }),
  async (c) => {
    const id = parseInt(c.req.param("id"));
    const { username, password } = await c.req.json();

    const user = await db.query.users.findFirst({
      where: eq(users.id, id),
    });

    if (!user) {
      throw new HTTPException(404, { message: "User not found" });
    }

    const hashedPassword = password
      ? await Bun.password.hash(password)
      : undefined;

    const result = await db
      .update(users)
      .set({
        username: username,
        password: hashedPassword,
        updatedAt: new Date(),
      })
      .where(eq(users.id, id))
      .returning({
        id: users.id,
        username: users.username,
      });

    return c.json(result[0]);
  }
);

// Delete a user
app.openapi(
  createRoute({
    method: "delete",
    path: "/{id}",
    request: {
      params: z.object({
        id: z.string(),
      }),
    },
    responses: {
      200: {
        description: "User deleted",
      },
      404: {
        description: "User not found",
      },
    },
  }),
  async (c) => {
    const id = parseInt(c.req.param("id"));
    const user = await db.query.users.findFirst({
      where: eq(users.id, id),
    });

    if (!user) {
      throw new HTTPException(404, { message: "User not found" });
    }

    await db.delete(users).where(eq(users.id, id));

    return c.json({ message: "User deleted" });
  }
);

// Login endpoint
app.openapi(
  createRoute({
    method: "post",
    path: "/login",
    responses: {
      200: {
        description: "Login successful",
      },
    },
  }),
  (c) => {
    return c.json({ message: "Login successful" });
  }
);

export default app;

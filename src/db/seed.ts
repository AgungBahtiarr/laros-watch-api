import { db } from ".";
import { connections, users } from "./schema";

const seedUsers = async () => {
  console.log("Seeding user data...");

  const hashedPassword = await Bun.password.hash("password123");

  const data: (typeof users.$inferInsert)[] = [
    {
      username: "admin",
      password: hashedPassword,
    },
  ];

  await db.insert(users).values(data);

  console.log("User data seeded successfully.");
};

const seedConnections = async () => {
  console.log("Seeding connections data...");

  // INI CONTOH!

  // const data: (typeof connections.$inferInsert)[] = [
  //   {
  //     deviceAId: 1,
  //     portAId: 1,
  //     deviceBId: 2,
  //     portBId: 1,
  //     description: "Connection between Node 1 and Node 2",
  //     odpPath: [1, 2],
  //   },
  //   {
  //     deviceAId: 3,
  //     portAId: 1,
  //     deviceBId: 4,
  //     portBId: 1,
  //     description: "Connection between Node 3 and Node 4",
  //   },
  // ];

  // await db.insert(connections).values(data);

  console.log("Connections data seeded successfully.");
};

const main = async () => {
  await seedUsers();
  await seedConnections();
};

main()
  .catch((e) => {
    console.error("Error during seeding:", e);
    process.exit(1);
  })
  .finally(async () => {
    console.log("Seeding process finished.");
    process.exit(0);
  });

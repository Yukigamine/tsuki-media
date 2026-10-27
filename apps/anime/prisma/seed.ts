import prisma from "../src/lib/prisma";

await prisma.settings.upsert({
  where: { id: "app" },
  update: {},
  create: { id: "app" },
});

await prisma.$disconnect();

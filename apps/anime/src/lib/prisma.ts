import "server-only";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const env = process.env.VERCEL ? "prod" : "dev";
const dbUrl = process.env.POSTGRES_URL_NON_POOLING;
const poolUrl = process.env.POSTGRES_URL;

const adapter =
  env === "dev"
    ? new PrismaPg({
        connectionString: dbUrl,
      })
    : new PrismaNeon({
        connectionString: poolUrl,
      });

const globalForPrisma = global as unknown as {
  prisma: PrismaClient;
};

const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    adapter,
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export default prisma;

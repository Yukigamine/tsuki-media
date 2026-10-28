import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({
  pg: vi.fn(
    class {
      adapter = "pg";
    },
  ),
  neon: vi.fn(
    class {
      adapter = "neon";
    },
  ),
  client: vi.fn(
    class {
      options: unknown;
      constructor(options: unknown) {
        this.options = options;
      }
    },
  ),
}));
vi.mock("@prisma/adapter-pg", () => ({ PrismaPg: f.pg }));
vi.mock("@prisma/adapter-neon", () => ({ PrismaNeon: f.neon }));
vi.mock("@/generated/prisma/client", () => ({ PrismaClient: f.client }));
const singleton = globalThis as typeof globalThis & { prisma?: unknown };
let original: unknown;
beforeEach(() => {
  original = singleton.prisma;
  delete singleton.prisma;
  vi.resetModules();
  f.pg.mockReset();
  f.neon.mockReset();
  f.client.mockReset();
  vi.stubEnv("POSTGRES_URL_NON_POOLING", "postgresql://fake.test/direct");
  vi.stubEnv("POSTGRES_URL", "postgresql://fake.test/pool");
  vi.stubEnv("VERCEL", undefined);
  vi.stubEnv("NODE_ENV", "development");
});
afterEach(() => {
  if (original === undefined) delete singleton.prisma;
  else singleton.prisma = original;
});

describe("Prisma adapter and lifecycle wiring", () => {
  it("uses the direct Postgres adapter locally and reuses the development client across reloads", async () => {
    const first = (await import("./prisma")).default;
    expect(f.pg).toHaveBeenCalledWith({
      connectionString: "postgresql://fake.test/direct",
    });
    expect(f.neon).not.toHaveBeenCalled();
    expect(f.client).toHaveBeenCalledWith({ adapter: { adapter: "pg" } });
    expect(singleton.prisma).toBe(first);
    vi.resetModules();
    expect((await import("./prisma")).default).toBe(first);
    expect(f.client).toHaveBeenCalledOnce();
  });
  it("selects the pooled Neon adapter on Vercel without persisting a production singleton", async () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("NODE_ENV", "production");
    await import("./prisma");
    expect(f.neon).toHaveBeenCalledWith({
      connectionString: "postgresql://fake.test/pool",
    });
    expect(f.pg).not.toHaveBeenCalled();
    expect(f.client).toHaveBeenCalledWith({ adapter: { adapter: "neon" } });
    expect(singleton.prisma).toBeUndefined();
  });
  it("retains an existing global client instead of opening another database client", async () => {
    const existing = { testClient: true };
    singleton.prisma = existing;
    expect((await import("./prisma")).default).toBe(existing);
    expect(f.client).not.toHaveBeenCalled();
  });
});

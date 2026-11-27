import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("redis", () => ({ createClient: state.createClient }));

function client() {
  const transaction = { incr: vi.fn(), del: vi.fn(), exec: vi.fn() };
  transaction.incr.mockReturnValue(transaction);
  transaction.del.mockReturnValue(transaction);
  transaction.exec.mockResolvedValue([1, 1]);
  const value = {
    isOpen: true,
    on: vi.fn(),
    connect: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
    setEx: vi.fn().mockResolvedValue("OK"),
    del: vi.fn().mockResolvedValue(1),
    keys: vi.fn().mockResolvedValue([]),
    eval: vi.fn().mockResolvedValue("OK"),
    multi: vi.fn().mockReturnValue(transaction),
    transaction,
  };
  value.connect.mockImplementation(async () => value);
  return value;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv("REDIS_URL", "redis://unit-test.invalid:6379");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("Redis cache boundary", () => {
  it("uses one configured connection for concurrent callers and preserves JSON values", async () => {
    const redis = client();
    state.createClient.mockReturnValue(redis);
    redis.get
      .mockResolvedValueOnce('{"count":0}')
      .mockResolvedValueOnce("false");
    const cache = await import("./redis");
    expect(
      await Promise.all([cache.getCached("one"), cache.getCached("two")]),
    ).toEqual([{ count: 0 }, false]);
    expect(state.createClient).toHaveBeenCalledTimes(1);
    expect(state.createClient).toHaveBeenCalledWith({
      url: "redis://unit-test.invalid:6379",
      socket: { connectTimeout: 5000, reconnectStrategy: false },
      disableOfflineQueue: true,
    });
    expect(redis.connect).toHaveBeenCalledTimes(1);
    expect(redis.on).toHaveBeenCalledWith("error", expect.any(Function));
    redis.on.mock.calls[0][1](new Error("connection lost"));
    expect(console.error).toHaveBeenCalledWith(
      "[redis] error:",
      expect.any(Error),
    );
  });

  it("treats misses, malformed JSON and read failures as cache misses", async () => {
    const redis = client();
    state.createClient.mockReturnValue(redis);
    redis.get
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce("{broken")
      .mockRejectedValueOnce(new Error("down"));
    const cache = await import("./redis");
    for (const key of ["missing", "empty", "broken", "down"])
      expect(await cache.getCached(key)).toBeNull();
    expect(console.error).toHaveBeenCalledTimes(2);
  });

  it("does not connect without configuration and leaves writes best-effort", async () => {
    vi.stubEnv("REDIS_URL", "");
    const cache = await import("./redis");
    expect(await cache.getCached("a")).toBeNull();
    expect(await cache.getLibraryRevision()).toBeNull();
    await expect(cache.setCached("a", {}, 10)).resolves.toBeUndefined();
    await expect(cache.deleteCached("a")).resolves.toBeUndefined();
    await expect(cache.cacheLibrary({}, "1")).resolves.toBeUndefined();
    await expect(cache.invalidateListCache()).resolves.toBeUndefined();
    expect(state.createClient).not.toHaveBeenCalled();
  });

  it("recovers after a failed connection and replaces a closed client", async () => {
    const first = client(),
      second = client(),
      third = client();
    first.connect.mockRejectedValueOnce(new Error("refused"));
    state.createClient
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second)
      .mockReturnValueOnce(third);
    const cache = await import("./redis");
    expect(await cache.getCached("a")).toBeNull();
    second.get.mockResolvedValue('"second"');
    expect(await cache.getCached("a")).toBe("second");
    second.isOpen = false;
    third.get.mockResolvedValue('"third"');
    expect(await cache.getCached("a")).toBe("third");
    expect(state.createClient).toHaveBeenCalledTimes(3);
  });

  it("serializes writes with their TTL and suppresses serialization/store errors", async () => {
    const redis = client();
    state.createClient.mockReturnValue(redis);
    const cache = await import("./redis");
    await cache.setCached(
      "title:1",
      { title: "A", date: new Date("2026-01-01Z") },
      86400,
    );
    expect(redis.setEx).toHaveBeenCalledWith(
      "title:1",
      86400,
      '{"title":"A","date":"2026-01-01T00:00:00.000Z"}',
    );
    redis.setEx.mockRejectedValueOnce(new Error("read-only"));
    await expect(cache.setCached("a", 1, 1)).resolves.toBeUndefined();
    const circular: { self?: unknown } = {};
    circular.self = circular;
    await expect(cache.setCached("a", circular, 1)).resolves.toBeUndefined();
    redis.del.mockRejectedValueOnce(new Error("down"));
    await expect(cache.deleteCached("a")).resolves.toBeUndefined();
  });

  it("publishes library snapshots through a revision-checked Redis operation", async () => {
    const redis = client();
    state.createClient.mockReturnValue(redis);
    const cache = await import("./redis");
    expect(await cache.getLibraryRevision()).toBe("0");
    redis.get.mockResolvedValueOnce("17");
    expect(await cache.getLibraryRevision()).toBe("17");
    await cache.cacheLibrary({ anime: [] }, "17");
    const [script, options] = redis.eval.mock.calls[0];
    expect(script).toContain("redis.call('GET', KEYS[1]) or '0'");
    expect(script).toContain("== ARGV[1]");
    expect(options).toEqual({
      keys: ["library:v1:revision", "library:v1:all"],
      arguments: ["17", '{"anime":[]}', "86400"],
    });
    redis.eval.mockRejectedValueOnce(new Error("down"));
    await expect(cache.cacheLibrary({}, "18")).resolves.toBeUndefined();
  });

  it("invokes revision transactions and invalidates only the requested namespaces", async () => {
    const redis = client();
    state.createClient.mockReturnValue(redis);
    redis.keys
      .mockResolvedValueOnce(["anime:list:WATCHING", "anime:list:ALL"])
      .mockResolvedValueOnce([]);
    const cache = await import("./redis");
    await cache.invalidateAnimeListCache();
    await cache.invalidateMangaListCache();
    expect(redis.transaction.incr).toHaveBeenCalledWith("library:v1:revision");
    expect(redis.transaction.del).toHaveBeenCalledWith("library:v1:all");
    expect(redis.transaction.exec).toHaveBeenCalledTimes(2);
    expect(redis.keys.mock.calls).toEqual([["anime:list:*"], ["manga:list:*"]]);
    expect(redis.del).toHaveBeenCalledExactlyOnceWith([
      "anime:list:WATCHING",
      "anime:list:ALL",
    ]);
    await cache.invalidateListCache();
    expect(redis.keys.mock.calls.slice(-2)).toEqual([
      ["anime:list:*"],
      ["manga:list:*"],
    ]);
  });

  it("invalidates both local and provider title identifiers, never a null key", async () => {
    const redis = client();
    state.createClient.mockReturnValue(redis);
    const cache = await import("./redis");
    await cache.invalidateAnimeTitleCache("local-a", "101");
    await cache.invalidateMangaTitleCache("local-m", null);
    expect(redis.del.mock.calls).toEqual([
      ["anime:title:local-a"],
      ["anime:title:101"],
      ["manga:title:local-m"],
    ]);
    expect(redis.transaction.exec).toHaveBeenCalledTimes(2);
  });

  it("keeps invalidation failures best-effort", async () => {
    const redis = client();
    state.createClient.mockReturnValue(redis);
    redis.transaction.exec.mockRejectedValue(new Error("down"));
    redis.keys.mockRejectedValue(new Error("down"));
    const cache = await import("./redis");
    await expect(cache.invalidateListCache()).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledTimes(3);
  });
});

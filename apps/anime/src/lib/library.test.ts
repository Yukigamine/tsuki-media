import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  anime: vi.fn(),
  manga: vi.fn(),
  getCached: vi.fn(),
  revision: vi.fn(),
  cacheLibrary: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({
  default: {
    anime: { findMany: mocks.anime },
    manga: { findMany: mocks.manga },
  },
}));
vi.mock("@/lib/redis", () => ({
  getCached: mocks.getCached,
  getLibraryRevision: mocks.revision,
  cacheLibrary: mocks.cacheLibrary,
}));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.getCached.mockResolvedValue(null);
  mocks.revision.mockResolvedValue("0");
  mocks.cacheLibrary.mockResolvedValue(undefined);
  mocks.anime.mockResolvedValue([]);
  mocks.manga.mockResolvedValue([]);
});

describe("shared library snapshots", () => {
  it("restores nested Prisma date fields from Redis while leaving text and null dates alone", async () => {
    mocks.getCached.mockResolvedValue({
      anime: [
        {
          createdAt: "2026-01-01T00:00:00.000Z",
          titleEn: "2026-01-01",
          endDate: null,
          listEntry: { startedAt: "2026-01-02T00:00:00.000Z" },
          collectionItems: [{ purchasedAt: "2026-01-03T00:00:00.000Z" }],
        },
      ],
      manga: [],
    });
    const { getLibrarySnapshot } = await import("./library");
    const result = await getLibrarySnapshot();
    expect(result.anime[0].createdAt).toBeInstanceOf(Date);
    expect(result.anime[0].listEntry?.startedAt).toEqual(
      new Date("2026-01-02Z"),
    );
    expect(result.anime[0].collectionItems[0].purchasedAt).toEqual(
      new Date("2026-01-03Z"),
    );
    expect(result.anime[0].titleEn).toBe("2026-01-01");
    expect(result.anime[0].endDate).toBeNull();
    expect(mocks.anime).not.toHaveBeenCalled();
    expect(mocks.revision).not.toHaveBeenCalled();
  });
  it("fetches both media tables with entries/collections and caches using the observed revision", async () => {
    mocks.anime.mockResolvedValue([{ id: "a" }]);
    mocks.manga.mockResolvedValue([{ id: "m" }]);
    mocks.revision.mockResolvedValue("9");
    const { getLibrarySnapshot } = await import("./library");
    expect(await getLibrarySnapshot()).toEqual({
      anime: [{ id: "a" }],
      manga: [{ id: "m" }],
    });
    expect(mocks.anime).toHaveBeenCalledWith({
      include: { listEntry: true, collectionItems: true },
      orderBy: { titleEn: "asc" },
    });
    expect(mocks.manga).toHaveBeenCalledWith({
      include: { listEntry: true, collectionItems: true },
      orderBy: { titleEn: "asc" },
    });
    expect(mocks.cacheLibrary).toHaveBeenCalledWith(
      { anime: [{ id: "a" }], manga: [{ id: "m" }] },
      "9",
    );
  });
  it("deduplicates simultaneous misses for the same revision", async () => {
    const request = deferred<never[]>();
    mocks.anime.mockReturnValue(request.promise);
    const { getLibrarySnapshot } = await import("./library");
    const first = getLibrarySnapshot(),
      second = getLibrarySnapshot();
    await vi.waitFor(() => expect(mocks.anime).toHaveBeenCalledTimes(1));
    request.resolve([]);
    expect(await first).toEqual(await second);
    expect(mocks.cacheLibrary).toHaveBeenCalledTimes(1);
  });
  it("does not share an in-flight rebuild across a changed revision or clear the newer rebuild", async () => {
    const old = deferred<never[]>(),
      fresh = deferred<never[]>();
    mocks.anime
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(fresh.promise);
    mocks.revision.mockResolvedValueOnce("1").mockResolvedValue("2");
    const { getLibrarySnapshot } = await import("./library");
    const first = getLibrarySnapshot();
    await vi.waitFor(() => expect(mocks.anime).toHaveBeenCalledTimes(1));
    const second = getLibrarySnapshot();
    await vi.waitFor(() => expect(mocks.anime).toHaveBeenCalledTimes(2));
    old.resolve([]);
    await first;
    const third = getLibrarySnapshot();
    await Promise.resolve();
    fresh.resolve([]);
    await Promise.all([second, third]);
    expect(mocks.anime).toHaveBeenCalledTimes(2);
    expect(mocks.cacheLibrary.mock.calls.map((call) => call[1])).toEqual([
      "1",
      "2",
    ]);
  });
  it("avoids publishing unversioned snapshots during a cache outage", async () => {
    mocks.revision.mockResolvedValue(null);
    const { getLibrarySnapshot } = await import("./library");
    expect(await getLibrarySnapshot()).toEqual({ anime: [], manga: [] });
    expect(mocks.cacheLibrary).not.toHaveBeenCalled();
  });
  it("propagates database errors and permits the next request to retry", async () => {
    mocks.anime.mockRejectedValueOnce(new Error("database unavailable"));
    const { getLibrarySnapshot } = await import("./library");
    await expect(getLibrarySnapshot()).rejects.toThrow("database unavailable");
    expect(await getLibrarySnapshot()).toEqual({ anime: [], manga: [] });
    expect(mocks.anime).toHaveBeenCalledTimes(2);
  });
});

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import KitsuSyncButton from "./KitsuSyncButton";

const m = vi.hoisted(() => ({
  token: vi.fn(),
  start: vi.fn(),
  finish: vi.fn(),
  sync: vi.fn(),
  snapshot: vi.fn(),
  repair: vi.fn(),
  fetch: vi.fn(),
  snack: vi.fn(),
}));
vi.mock("@/lib/actions/auth", () => ({
  getLinkedProviderAccessTokenAction: m.token,
}));
vi.mock("@/lib/actions/kitsu-sync", () => ({
  startKitsuSyncLogAction: m.start,
  finishKitsuSyncLogAction: m.finish,
  syncKitsuLibraryAction: m.sync,
  getKitsuPushSnapshotAction: m.snapshot,
}));
vi.mock("@/lib/kitsu/client-mapping-repair", () => ({
  repairMissingKitsuMappings: m.repair,
}));
vi.mock("@/lib/kitsu/fetch", () => ({
  kitsuFetch: m.fetch,
  assertNoCloudflareChallenge: vi.fn(),
}));
vi.mock("notistack", () => ({ enqueueSnackbar: m.snack }));
let anime: unknown[];
let manga: unknown[];
let queries: string[];
function remote(id: string, extra = {}) {
  return {
    id: `entry-${id}`,
    status: "CURRENT",
    progress: 1,
    media: {
      id,
      titles: { canonical: `Title ${id}` },
      episodeCount: 12,
      chapterCount: 20,
      mappings: { nodes: [] },
      description: "large description",
    },
    ...extra,
  };
}
function local(id: string) {
  return {
    id,
    progress: 30,
    rating: 25,
    notes: 'quoted "note"',
    private: true,
    rewatchCount: 2,
    rewatching: true,
    watchStatus: "COMPLETED",
    anime: { id, kitsuId: id, malId: null, episodeCount: 24 },
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  anime = [];
  manga = [];
  queries = [];
  m.token.mockResolvedValue({ ok: true, data: "fake-token" });
  m.start.mockResolvedValue({ ok: true, data: { logId: "log" } });
  m.finish.mockResolvedValue({ ok: true });
  m.sync.mockResolvedValue({
    ok: true,
    data: {
      animeSynced: 1,
      mangaSynced: 2,
      animeChanged: 1,
      mangaChanged: 0,
      errors: [],
    },
  });
  m.snapshot.mockResolvedValue({ ok: true, data: { anime: [], manga: [] } });
  m.repair.mockResolvedValue({ unresolved: [] });
  m.fetch.mockImplementation(async (_url, init) => {
    const { query } = JSON.parse(init.body);
    queries.push(query);
    let data: unknown = {};
    if (query.includes("currentProfile"))
      data = { currentProfile: { slug: "reader" } };
    else if (query.includes("findProfileBySlug"))
      data = {
        findProfileBySlug: {
          library: {
            all: {
              nodes: /mediaType:\s*ANIME/.test(query) ? anime : manga,
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      };
    else if (query.includes("findMediaByIdAndType"))
      data = { findMediaByIdAndType: { episodeCount: 10, chapterCount: 15 } };
    return { status: 200, body: JSON.stringify({ data }) };
  });
});
async function click(direction = "Pull from Kitsu") {
  fireEvent.click(screen.getByRole("button", { name: direction }));
  await waitFor(() => expect(m.finish).toHaveBeenCalled());
  await waitFor(() =>
    expect(screen.getByRole("button", { name: direction })).toBeEnabled(),
  );
}
describe("Kitsu browser sync", () => {
  it.each(["Pull from Kitsu", "Push to Kitsu"])(
    "requires a linked account before %s without contacting Kitsu",
    async (name) => {
      m.token.mockResolvedValue({ ok: false });
      render(<KitsuSyncButton />);
      await click(name);
      expect(m.fetch).not.toHaveBeenCalled();
      expect(m.finish).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "FAILED",
          errors: ["Connect your Kitsu account first"],
        }),
      );
    },
  );
  it("pulls both libraries using authenticated GraphQL and strips bulky descriptions before server submission", async () => {
    anime = [remote("1")];
    manga = [remote("2")];
    const done = vi.fn();
    render(
      <KitsuSyncButton
        onSynced={done}
        renderAfterButton={(d) => <span>{d} summary</span>}
      />,
    );
    await click();
    expect(m.sync).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: "reader",
        anime: [
          expect.objectContaining({
            media: expect.not.objectContaining({
              description: expect.anything(),
            }),
          }),
        ],
        manga: [expect.objectContaining({ id: "entry-2" })],
      }),
    );
    expect(m.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer fake-token",
        }),
      }),
    );
    expect(done).toHaveBeenCalledOnce();
    expect(screen.getByText("PUSH summary")).toBeInTheDocument();
  });
  it("records partial pull errors while refreshing the collection", async () => {
    m.sync.mockResolvedValue({ ok: true, data: { errors: ["invalid entry"] } });
    render(<KitsuSyncButton />);
    await click();
    expect(m.finish).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "FAILED",
        errors: ["invalid entry"],
        animeSynced: 0,
      }),
    );
    expect(m.snack).toHaveBeenCalledWith(expect.stringContaining("1 error"), {
      variant: "warning",
    });
  });
  it("does not refresh after server rejects a pull and permits retry", async () => {
    m.sync.mockResolvedValueOnce({ ok: false, error: "Session expired" });
    const done = vi.fn();
    render(<KitsuSyncButton onSynced={done} />);
    await click();
    expect(done).not.toHaveBeenCalled();
    expect(m.snack).toHaveBeenCalledWith("Session expired", {
      variant: "error",
    });
    await click();
    expect(done).toHaveBeenCalledOnce();
  });
  it.each([
    { status: 503, body: "{}" },
    {
      status: 200,
      body: JSON.stringify({ errors: [{ message: "Token expired" }] }),
    },
    { status: 200, body: "{}" },
    { status: 200, body: JSON.stringify({ data: { currentProfile: null } }) },
  ])(
    "records provider failure rather than submitting an empty library: %j",
    async (response) => {
      m.fetch.mockResolvedValue(response);
      render(<KitsuSyncButton />);
      await click();
      expect(m.sync).not.toHaveBeenCalled();
      expect(m.finish).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "FAILED",
          errors: [expect.any(String)],
        }),
      );
    },
  );
  it("updates, creates and deletes both media types with count and rating clamps", async () => {
    anime = [remote("1"), remote("orphan")];
    manga = [remote("m1"), remote("m-orphan")];
    const a = local("1");
    const a2 = local("2");
    const convert = (id: string) => {
      const {
        anime: media,
        watchStatus: _,
        rewatchCount,
        rewatching,
        ...rest
      } = local(id);
      return {
        ...rest,
        readStatus: "READING",
        rereadCount: rewatchCount,
        rereading: rewatching,
        manga: { ...media, chapterCount: 30 },
      };
    };
    m.snapshot.mockResolvedValue({
      ok: true,
      data: { anime: [a, a2], manga: [convert("m1"), convert("m2")] },
    });
    render(<KitsuSyncButton />);
    await click("Push to Kitsu");
    const mutations = queries.filter((q) => q.startsWith("mutation"));
    expect(mutations).toHaveLength(6);
    expect(mutations.join("\n")).toContain("progress: 12");
    expect(mutations.join("\n")).toContain("progress: 10");
    expect(mutations.join("\n")).toContain("progress: 15");
    expect(mutations.join("\n")).toContain("rating: 20");
    expect(mutations.join("\n")).toContain("status: CURRENT");
    expect(mutations.join("\n")).toContain('id: "entry-orphan"');
    expect(m.finish).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "COMPLETED",
        animeSynced: 2,
        mangaSynced: 2,
        animeChanged: 3,
        mangaChanged: 3,
        deletions: expect.arrayContaining([
          expect.stringContaining("Title orphan"),
        ]),
      }),
    );
  });
  it("aggregates mapping and batch errors and still attempts independent batches", async () => {
    anime = [remote("orphan")];
    manga = [remote("m-orphan")];
    m.repair.mockResolvedValue({ unresolved: ["Missing title"] });
    const fetch = m.fetch.getMockImplementation();
    m.fetch.mockImplementation(async (...args) => {
      const response = await fetch?.(...args);
      return JSON.parse(args[1].body).query.startsWith("mutation")
        ? {
            status: 200,
            body: JSON.stringify({
              data: { ad0: { errors: [{ message: "Forbidden" }] } },
            }),
          }
        : response;
    });
    render(<KitsuSyncButton />);
    await click("Push to Kitsu");
    expect(queries.filter((q) => q.startsWith("mutation"))).toHaveLength(2);
    expect(m.finish).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "FAILED",
        errors: [
          "Missing title: provider mapping could not be resolved",
          "anime delete batch 1: Forbidden",
          "manga delete batch 1: Forbidden",
        ],
      }),
    );
  });
  it("records missing local snapshot as failure without deleting remote entries", async () => {
    m.snapshot.mockResolvedValue({ ok: false, error: "Unauthorized" });
    render(<KitsuSyncButton />);
    await click("Push to Kitsu");
    expect(queries).toHaveLength(1);
    expect(m.finish).toHaveBeenCalledWith(
      expect.objectContaining({ errors: ["Unauthorized"], status: "FAILED" }),
    );
  });

  it("keeps both directions disabled while a pull is running and restores them afterwards", async () => {
    let release!: (value: unknown) => void;
    m.sync.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    render(<KitsuSyncButton />);
    fireEvent.click(screen.getByRole("button", { name: "Pull from Kitsu" }));
    await waitFor(() => expect(m.sync).toHaveBeenCalledOnce());
    expect(screen.getByRole("button", { name: "Running..." })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Push to Kitsu" }),
    ).toBeDisabled();
    release({ ok: true });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Pull from Kitsu" }),
      ).toBeEnabled(),
    );
  });
  it("follows pagination cursors without dropping either media library", async () => {
    const fetch = m.fetch.getMockImplementation();
    m.fetch.mockImplementation(async (...args) => {
      const query = JSON.parse(args[1].body).query;
      if (
        query.includes("findProfileBySlug") &&
        /mediaType:\s*ANIME/.test(query)
      ) {
        queries.push(query);
        const second = query.includes('"next"');
        return {
          status: 200,
          body: JSON.stringify({
            data: {
              findProfileBySlug: {
                library: {
                  all: {
                    nodes: [remote(second ? "second" : "first")],
                    pageInfo: {
                      hasNextPage: !second,
                      endCursor: second ? null : "next",
                    },
                  },
                },
              },
            },
          }),
        };
      }
      return fetch?.(...args);
    });
    render(<KitsuSyncButton />);
    await click();
    expect(m.sync).toHaveBeenCalledWith(
      expect.objectContaining({
        anime: [
          expect.objectContaining({ id: "entry-first" }),
          expect.objectContaining({ id: "entry-second" }),
        ],
        manga: [],
      }),
    );
  });
  it("does not rewrite unchanged entries or delete MAL-matched entries when Kitsu IDs are absent locally", async () => {
    anime = [
      remote("1", {
        rating: null,
        notes: null,
        private: false,
        reconsumeCount: 0,
        reconsuming: false,
        media: {
          id: "1",
          mappings: {
            nodes: [{ externalId: "123", externalSite: "MYANIMELIST_ANIME" }],
          },
        },
      }),
    ];
    m.snapshot.mockResolvedValue({
      ok: true,
      data: {
        anime: [
          {
            ...local("1"),
            progress: 1,
            rating: 0,
            notes: "",
            private: false,
            rewatchCount: 0,
            rewatching: false,
            watchStatus: "WATCHING",
            anime: { kitsuId: null, malId: 123 },
          },
        ],
        manga: [],
      },
    });
    render(<KitsuSyncButton />);
    await click("Push to Kitsu");
    expect(queries.filter((q) => q.startsWith("mutation"))).toEqual([]);
    expect(m.finish).toHaveBeenCalledWith(
      expect.objectContaining({
        animeSynced: 1,
        animeChanged: 0,
        deletions: [],
      }),
    );
  });
  it("chunks more than ten mutations and continues after HTTP and top-level GraphQL batch errors", async () => {
    anime = Array.from({ length: 21 }, (_, i) => remote(`orphan-${i}`));
    const fetch = m.fetch.getMockImplementation();
    let batch = 0;
    m.fetch.mockImplementation(async (...args) => {
      const result = await fetch?.(...args);
      if (JSON.parse(args[1].body).query.startsWith("mutation")) {
        batch++;
        if (batch === 1) return { status: 503, body: "{}" };
        if (batch === 2)
          return {
            status: 200,
            body: JSON.stringify({
              errors: [{ message: "Permission denied" }, {}],
            }),
          };
      }
      return result;
    });
    render(<KitsuSyncButton />);
    await click("Push to Kitsu");
    const mutations = queries.filter((q) => q.startsWith("mutation"));
    expect(
      mutations.map((q) => (q.match(/: libraryEntry \{/g) ?? []).length),
    ).toEqual([10, 10, 1]);
    expect(m.finish).toHaveBeenCalledWith(
      expect.objectContaining({
        errors: [
          "anime delete batch 1: Kitsu GraphQL 503",
          "anime delete batch 2: Permission denied; Unknown error",
        ],
        status: "FAILED",
      }),
    );
  });
  it.each([
    ["WATCHING", "READING", "CURRENT"],
    ["PLAN_TO_WATCH", "PLAN_TO_READ", "PLANNED"],
    ["COMPLETED", "COMPLETED", "COMPLETED"],
    ["ON_HOLD", "ON_HOLD", "ON_HOLD"],
    ["DROPPED", "DROPPED", "DROPPED"],
  ])(
    "serializes anime %s and manga %s statuses for new entries",
    async (watchStatus, readStatus, expected) => {
      m.snapshot.mockResolvedValue({
        ok: true,
        data: {
          anime: [
            {
              ...local("a"),
              progress: 0,
              rating: null,
              notes: null,
              watchStatus,
            },
          ],
          manga: [
            {
              id: "m",
              progress: 0,
              rating: 1,
              notes: null,
              private: false,
              rereadCount: 0,
              rereading: false,
              readStatus,
              manga: { kitsuId: "m", malId: null, chapterCount: null },
            },
          ],
        },
      });
      render(<KitsuSyncButton />);
      await click("Push to Kitsu");
      const mutations = queries.filter((q) => q.startsWith("mutation"));
      expect(mutations).toHaveLength(2);
      for (const mutation of mutations)
        expect(mutation).toContain(`status: ${expected}`);
      expect(mutations[0]).toContain("rating: null");
      expect(mutations[1]).toContain("rating: 2");
      expect(queries.some((q) => q.includes("findMediaByIdAndType"))).toBe(
        false,
      );
    },
  );

  it.each([
    ["status", "PLANNED", "PLAN_TO_WATCH", "PLAN_TO_READ"],
    ["status", "COMPLETED", "COMPLETED", "COMPLETED"],
    ["status", "ON_HOLD", "ON_HOLD", "ON_HOLD"],
    ["status", "DROPPED", "DROPPED", "DROPPED"],
    ["status", null, "PLAN_TO_WATCH", "PLAN_TO_READ"],
  ])(
    "does not rewrite equivalent remote %s=%s statuses",
    async (_field, status, watchStatus, readStatus) => {
      anime = [remote("a", { status, progress: null, media: { id: "a" } })];
      manga = [remote("m", { status, progress: null, media: { id: "m" } })];
      m.snapshot.mockResolvedValue({
        ok: true,
        data: {
          anime: [
            {
              ...local("a"),
              progress: 0,
              rating: null,
              notes: null,
              private: false,
              rewatchCount: 0,
              rewatching: false,
              watchStatus,
            },
          ],
          manga: [
            {
              id: "m",
              progress: 0,
              rating: null,
              notes: null,
              private: false,
              rereadCount: 0,
              rereading: false,
              readStatus,
              manga: { kitsuId: "m", malId: null },
            },
          ],
        },
      });
      render(<KitsuSyncButton />);
      await click("Push to Kitsu");
      expect(queries.filter((q) => q.startsWith("mutation"))).toEqual([]);
    },
  );

  it.each([
    ["progress", 2],
    ["rating", 9],
    ["notes", "updated note"],
    ["reconsumeCount", 1],
    ["reconsuming", true],
    ["private", true],
  ])(
    "pushes a change isolated to remote %s for both media types",
    async (field, value) => {
      const base = {
        status: "CURRENT",
        progress: 0,
        rating: null,
        notes: null,
        reconsumeCount: 0,
        reconsuming: false,
        private: false,
      };
      anime = [remote("a", { ...base, [field]: value, media: { id: "a" } })];
      manga = [remote("m", { ...base, [field]: value, media: { id: "m" } })];
      m.snapshot.mockResolvedValue({
        ok: true,
        data: {
          anime: [
            {
              ...local("a"),
              progress: 0,
              rating: null,
              notes: null,
              private: false,
              rewatchCount: 0,
              rewatching: false,
              watchStatus: "WATCHING",
            },
          ],
          manga: [
            {
              id: "m",
              progress: 0,
              rating: null,
              notes: null,
              private: false,
              rereadCount: 0,
              rereading: false,
              readStatus: "READING",
              manga: { kitsuId: "m", malId: null },
            },
          ],
        },
      });
      render(<KitsuSyncButton />);
      await click("Push to Kitsu");
      const mutations = queries.filter((q) => q.startsWith("mutation"));
      expect(mutations).toHaveLength(2);
      expect(mutations.every((q) => q.includes("update(input:"))).toBe(true);
      for (const [index, id] of ["a", "m"].entries()) {
        expect(mutations[index]).toContain(`id: "entry-${id}"`);
        for (const serialized of [
          "progress: 0",
          "rating: null",
          'notes: ""',
          "reconsumeCount: 0",
          "reconsuming: false",
          "private: false",
        ])
          expect(mutations[index]).toContain(serialized);
      }
      expect(m.finish).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "COMPLETED",
          animeChanged: 1,
          mangaChanged: 1,
        }),
      );
    },
  );

  it("ignores malformed remote entries and uses MAL mappings for manga without a Kitsu ID", async () => {
    anime = [{ id: "no-media" }, { media: { id: "missing-entry" } }];
    manga = [
      remote("m", {
        status: "CURRENT",
        progress: 0,
        media: {
          id: "m",
          mappings: {
            nodes: [{ externalSite: "MYANIMELIST_MANGA", externalId: "123" }],
          },
        },
      }),
    ];
    m.snapshot.mockResolvedValue({
      ok: true,
      data: {
        anime: [],
        manga: [
          {
            id: "local",
            progress: 0,
            rating: null,
            notes: null,
            private: false,
            rereadCount: 0,
            rereading: false,
            readStatus: "READING",
            manga: { kitsuId: null, malId: 123 },
          },
        ],
      },
    });
    render(<KitsuSyncButton />);
    await click("Push to Kitsu");
    expect(queries.filter((q) => q.startsWith("mutation"))).toEqual([]);
    expect(m.finish).toHaveBeenCalledWith(
      expect.objectContaining({ mangaSynced: 1, status: "COMPLETED" }),
    );
  });

  it.each(["Pull from Kitsu", "Push to Kitsu"])(
    "still syncs when logging cannot start for %s",
    async (name) => {
      m.start.mockResolvedValue({ ok: false, error: "Log unavailable" });
      render(<KitsuSyncButton />);
      fireEvent.click(screen.getByRole("button", { name }));
      await waitFor(() =>
        expect(m.snack).toHaveBeenCalledWith(expect.any(String), {
          variant: "success",
        }),
      );
      expect(m.finish).not.toHaveBeenCalled();
      expect(screen.getByRole("button", { name })).toBeEnabled();
    },
  );
});

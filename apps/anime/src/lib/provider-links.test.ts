import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  users: vi.fn(),
  find: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("./prisma", () => ({
  default: {
    user: { findMany: db.users },
    account: {
      findFirst: db.find,
      update: db.update,
      create: db.create,
      deleteMany: db.remove,
    },
  },
}));

import {
  deleteToken,
  getAuthStatus,
  getToken,
  saveToken,
} from "./provider-links";

beforeEach(() => {
  vi.clearAllMocks();
  db.users.mockResolvedValue([{ id: "only-user" }]);
  db.find.mockResolvedValue(null);
  db.update.mockResolvedValue({});
  db.create.mockResolvedValue({});
  db.remove.mockResolvedValue({ count: 1 });
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-02T03:04:05Z"));
});
afterEach(() => vi.useRealTimers());

describe("user-scoped linked provider credentials", () => {
  it("creates only in the explicit user's provider namespace with consistent nullable fields", async () => {
    await saveToken(
      "KITSU",
      { accessToken: "dummy-access" },
      { userId: "explicit" },
    );
    expect(db.users).not.toHaveBeenCalled();
    expect(db.find).toHaveBeenCalledWith({
      where: { userId: "explicit", providerId: "kitsu-link" },
      select: { id: true },
    });
    expect(db.create).toHaveBeenCalledWith({
      data: {
        id: expect.any(String),
        userId: "explicit",
        providerId: "kitsu-link",
        accountId: "kitsu",
        accessToken: "dummy-access",
        refreshToken: null,
        accessTokenExpiresAt: null,
        refreshTokenExpiresAt: null,
        idToken: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
  });
  it("updates an existing account without creating a duplicate or discarding optional token fields", async () => {
    db.find.mockResolvedValue({ id: "existing" });
    const expiry = new Date("2027-01-01Z");
    await saveToken("ANILIST", {
      accessToken: "access",
      refreshToken: "refresh",
      expiresAt: expiry,
      username: "Yuki",
      providerUserId: "42",
      avatarUrl: "avatar",
    });
    expect(db.update).toHaveBeenCalledWith({
      where: { id: "existing" },
      data: {
        accountId: "Yuki",
        accessToken: "access",
        refreshToken: "refresh",
        accessTokenExpiresAt: expiry,
        idToken: "avatar",
      },
    });
    expect(db.create).not.toHaveBeenCalled();
  });
  it("uses provider ID when username is absent and resolves an unambiguous default user", async () => {
    await saveToken("ANILIST", {
      accessToken: "access",
      providerUserId: "123",
      refreshToken: "r",
      expiresAt: new Date("2027-01-01Z"),
      avatarUrl: "a",
    });
    expect(db.create.mock.calls[0][0].data).toMatchObject({
      userId: "only-user",
      accountId: "123",
      refreshToken: "r",
      idToken: "a",
    });
    expect(db.users).toHaveBeenCalledWith({
      select: { id: true },
      take: 2,
      orderBy: { createdAt: "asc" },
    });
  });
  it.each([{ users: [] }, { users: [{ id: "one" }, { id: "two" }] }])(
    "fails closed for an ambiguous or missing default user",
    async ({ users }) => {
      db.users.mockResolvedValue(users);
      await expect(getToken("KITSU")).rejects.toThrow(
        users.length ? "require explicit user context" : "No user found",
      );
      expect(db.find).not.toHaveBeenCalled();
    },
  );
  it("does not treat an account with no token as linked token access", async () => {
    expect(await getToken("KITSU", { userId: "u" })).toBeNull();
    db.find.mockResolvedValue({ accessToken: "" });
    expect(await getToken("KITSU", { userId: "u" })).toBeNull();
    db.find.mockResolvedValue({
      accessToken: "access",
      accountId: "name",
      idToken: "avatar",
    });
    expect(await getToken("KITSU", { userId: "u" })).toEqual({
      accessToken: "access",
      refreshToken: null,
      expiresAt: null,
      username: "name",
      providerUserId: "name",
      avatarUrl: "avatar",
    });
    expect(db.find).toHaveBeenLastCalledWith({
      where: { userId: "u", providerId: "kitsu-link" },
      orderBy: { updatedAt: "desc" },
    });
  });
  it("preserves persisted expiry/refresh values and deletes only the requested user/provider", async () => {
    const date = new Date("2027-01-01Z");
    db.find.mockResolvedValue({
      accessToken: "a",
      refreshToken: "r",
      accessTokenExpiresAt: date,
      accountId: "42",
      idToken: null,
    });
    expect(await getToken("ANILIST", { userId: "u" })).toMatchObject({
      expiresAt: date,
      refreshToken: "r",
    });
    await deleteToken("ANILIST", { userId: "u" });
    expect(db.remove).toHaveBeenCalledExactlyOnceWith({
      where: { userId: "u", providerId: "anilist-link" },
    });
  });
  it("reports independent provider status without leaking tokens", async () => {
    db.find
      .mockResolvedValueOnce({ accountId: "kitsu-name" })
      .mockResolvedValueOnce(null);
    expect(await getAuthStatus("u")).toEqual({
      KITSU: { loggedIn: true, username: "kitsu-name" },
      ANILIST: { loggedIn: false, username: null },
    });
    db.find
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ accountId: "anilist-name" });
    expect(await getAuthStatus()).toEqual({
      KITSU: { loggedIn: false, username: null },
      ANILIST: { loggedIn: true, username: "anilist-name" },
    });
    for (const [args] of db.find.mock.calls)
      expect(args.select).toEqual({ accountId: true });
  });
  it("propagates database failure rather than pretending persistence succeeded", async () => {
    db.create.mockRejectedValue(new Error("database down"));
    await expect(
      saveToken("KITSU", { accessToken: "dummy" }, { userId: "u" }),
    ).rejects.toThrow("database down");
  });
});

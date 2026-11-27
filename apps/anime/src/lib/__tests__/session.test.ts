import { beforeEach, describe, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => ({ headers: vi.fn(), getSession: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: fakes.headers }));
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: fakes.getSession } },
}));

import { getSession, requireSession } from "../session";
import { getSessionFromRequest } from "../session-edge";

beforeEach(() => {
  for (const fake of Object.values(fakes)) fake.mockReset();
});
describe("server sessions", () => {
  it("passes incoming headers to the authoritative auth API", async () => {
    const headers = new Headers({ cookie: "session=test" });
    const session = { user: { id: "owner" } };
    fakes.headers.mockResolvedValue(headers);
    fakes.getSession.mockResolvedValue(session);
    expect(await getSession()).toBe(session);
    expect(fakes.getSession).toHaveBeenCalledWith({ headers });
    expect(await requireSession()).toBe(session);
  });
  it("rejects missing sessions and propagates auth-provider failures", async () => {
    fakes.getSession.mockResolvedValue(null);
    await expect(requireSession()).rejects.toThrow("Unauthorized");
    fakes.getSession.mockRejectedValue(new Error("auth unavailable"));
    await expect(getSession()).rejects.toThrow("auth unavailable");
  });
});
describe("edge cookie hint", () => {
  it.each([
    [
      {
        "better-auth.session_token": "plain",
        "__Secure-better-auth.session_token": "secure",
      },
      "plain",
    ],
    [{ "__Secure-better-auth.session_token": "secure" }, "secure"],
    [{}, null],
    [{ "better-auth.session_token": "" }, ""],
  ])(
    "reads supported cookie names without interpreting them as an authenticated user",
    async (values, expected) => {
      const request = {
        cookies: {
          get: (key: string) =>
            key in values
              ? { value: values[key as keyof typeof values] }
              : undefined,
        },
      };
      expect(await getSessionFromRequest(request as never)).toBe(expected);
    },
  );
});

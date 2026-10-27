"use client";

import { Thunder } from "@/lib/zeus/kitsu";
import { assertNoCloudflareChallenge, kitsuFetch } from "./fetch";

const KITSU_GRAPHQL =
  process.env.NEXT_PUBLIC_KITSU_API_URL ?? "https://kitsu.app/api/graphql";

export const kitsuBrowserClient = Thunder(async (query, variables) => {
  const response = await kitsuFetch(KITSU_GRAPHQL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Referer: "https://kitsu.app",
      Origin: "https://kitsu.app",
    },
    body: JSON.stringify({ query, variables }),
  });

  assertNoCloudflareChallenge(response);

  const body = JSON.parse(response.body) as {
    data?: unknown;
    errors?: { message: string }[];
  };

  if (response.status < 200 || response.status >= 300 || body.errors?.length) {
    throw new Error(
      body.errors?.[0]?.message ?? `Kitsu GraphQL ${response.status}`,
    );
  }

  if (!body.data) throw new Error("Kitsu GraphQL returned no data");
  return body.data;
});

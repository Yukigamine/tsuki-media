import { searchTmdbMovies } from "@tsuki-media/providers/tmdb";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim();
  if (!query || query.length > 200) {
    return NextResponse.json(
      { error: "Enter a search between 1 and 200 characters." },
      { status: 400 },
    );
  }

  const token = process.env.TMDB_API_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "TMDB is not configured." },
      { status: 503 },
    );
  }

  try {
    return NextResponse.json({
      results: await searchTmdbMovies(query, token),
    });
  } catch (error) {
    console.error("TMDB search failed", error);
    return NextResponse.json(
      { error: "TMDB search is temporarily unavailable." },
      { status: 502 },
    );
  }
}

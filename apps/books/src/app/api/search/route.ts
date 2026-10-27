import { searchHardcoverBooks } from "@tsuki-media/providers/hardcover";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim();
  if (!query || query.length > 200) {
    return NextResponse.json(
      { error: "Enter a search between 1 and 200 characters." },
      { status: 400 },
    );
  }

  const token = process.env.HARDCOVER_API_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "Hardcover is not configured." },
      { status: 503 },
    );
  }

  try {
    return NextResponse.json({
      results: await searchHardcoverBooks(query, token),
    });
  } catch (error) {
    console.error("Hardcover search failed", error);
    return NextResponse.json(
      { error: "Hardcover search is temporarily unavailable." },
      { status: 502 },
    );
  }
}

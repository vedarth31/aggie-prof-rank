import { NextRequest, NextResponse } from "next/server";
import { searchByCourse, searchByProfessor } from "../../lib/rank";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();
  const mode = req.nextUrl.searchParams.get("mode") ?? "course";

  if (!q) {
    return NextResponse.json({ error: "Missing query parameter 'q'" }, { status: 400 });
  }

  try {
    const results =
      mode === "professor"
        ? await searchByProfessor(q)
        : await searchByCourse(q);

    return NextResponse.json({ results });
  } catch (err) {
    console.error("[rank API]", err);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}

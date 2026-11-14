import { NextResponse, type NextRequest } from "next/server";
import { getLiveSnapshot } from "@/graph/live";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/pictograms/kind/[code] — return a kind's fallback pictogram
 *  SVG inner markup, or null if the kind has none. Cached at the CDN
 *  edge; revalidates on snapshot bump. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code: rawCode } = await params;
  const code = decodeURIComponent(rawCode);
  const live = await getLiveSnapshot();
  const svg = live.kindPictograms.get(code) ?? null;
  const etag = `"v${live.version}-kind-${code}"`;
  return NextResponse.json(
    { svg },
    {
      headers: {
        "cache-control": "public, max-age=60, stale-while-revalidate=86400",
        etag,
      },
    },
  );
}

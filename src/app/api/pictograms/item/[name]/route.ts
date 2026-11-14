import { NextResponse, type NextRequest } from "next/server";
import { getLiveSnapshot } from "@/graph/live";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/pictograms/item/[name] — return an item's pictogram SVG inner
 *  markup, or null if the item has none (callers fall back to the kind
 *  pictogram). Cached at the CDN edge; revalidates on snapshot bump. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name: rawName } = await params;
  const name = decodeURIComponent(rawName);
  const live = await getLiveSnapshot();
  const node = live.snapshot.byName.get(name);
  const svg = node?.pictogram ?? null;
  const etag = `"v${live.version}-${name}"`;
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

import { ImageResponse } from "next/og";
import { getItemPage } from "@/graph/queries";
import { TIER, KIND } from "@/lib/taxonomy";
import { KIND_PICTO, PICTO } from "@/pictograms/data";

export const runtime = "nodejs";
export const alt = "Made Of · an item page";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const TIER_FILL: Record<string, string> = {
  F: "#C9B8F5",
  N: "#B5DDA4",
  M: "#F5C96B",
  C: "#9ED9D5",
  P: "#F4A38C",
  S: "#A9B8E8",
};

const TIER_INK: Record<string, string> = {
  F: "#5A3EAD",
  N: "#357030",
  M: "#94630A",
  C: "#0D6E77",
  P: "#B03B2F",
  S: "#33528F",
};

/**
 * Open Graph image for item pages. Rendered on demand via next/og's
 * ImageResponse (Satori under the hood). We render the pictogram as inline
 * SVG at a chunky size, surrounded by the item name, tier/kind pills, and
 * a short slice of the fact.
 */
export default async function OgImage({
  params,
}: {
  params: { slug: string };
}) {
  const item = await getItemPage(params.slug);
  if (!item) {
    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#F2F3EF",
            fontSize: 64,
            color: "#111417",
            fontFamily: "sans-serif",
          }}
        >
          Made Of
        </div>
      ),
      size,
    );
  }

  const fill = TIER_FILL[item.tier] ?? "#F2F3EF";
  const ink = TIER_INK[item.tier] ?? "#111417";
  const fact = item.fact
    ? item.fact.length > 200
      ? item.fact.slice(0, 197) + "…"
      : item.fact
    : "";

  const svgInner = pictogramSvg(item.name, item.kind, item.symbol);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          padding: "60px 72px",
          background: "#F2F3EF",
          color: "#111417",
          fontFamily: "sans-serif",
        }}
      >
        {/* Brand strip */}
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 14,
            fontWeight: 800,
          }}
        >
          <div style={{ fontSize: 38, letterSpacing: "-0.02em" }}>Made Of</div>
          <div style={{ fontSize: 18, color: "#4A4F55", fontFamily: "mono" }}>
            everything is made of something
          </div>
        </div>

        {/* Main row: pictogram tile + name + pills */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 48,
            marginTop: 48,
          }}
        >
          <div
            style={{
              width: 240,
              height: 240,
              background: fill,
              border: "6px solid #111417",
              borderRadius: 8,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flex: "none",
              boxShadow: "10px 10px 0 #111417",
            }}
          >
            {item.symbol && item.kind === "element" ? (
              <div
                style={{
                  fontSize: 140,
                  fontWeight: 700,
                  color: "#111417",
                  lineHeight: 1,
                }}
              >
                {item.symbol}
              </div>
            ) : (
              <svg
                viewBox="0 0 32 32"
                width="190"
                height="190"
                dangerouslySetInnerHTML={{ __html: svgInner }}
              />
            )}
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 18,
              flex: 1,
            }}
          >
            <div
              style={{
                fontSize: 92,
                fontWeight: 800,
                letterSpacing: "-0.025em",
                lineHeight: 1,
              }}
            >
              {item.name}
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 700,
                  background: "#111417",
                  color: "#F2F3EF",
                  padding: "6px 14px",
                  borderRadius: 6,
                  letterSpacing: "0.07em",
                  textTransform: "uppercase",
                }}
              >
                {TIER[item.tier].name}
              </div>
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 500,
                  border: `3px solid ${ink}`,
                  padding: "4px 14px",
                  borderRadius: 6,
                  letterSpacing: "0.07em",
                  textTransform: "uppercase",
                  color: ink,
                }}
              >
                {KIND[item.kind]}
              </div>
            </div>
          </div>
        </div>

        {/* Fact strip */}
        {fact ? (
          <div
            style={{
              marginTop: "auto",
              fontSize: 32,
              lineHeight: 1.35,
              color: "#111417",
              maxWidth: 1000,
            }}
          >
            {fact}
          </div>
        ) : null}
      </div>
    ),
    size,
  );
}

function pictogramSvg(
  name: string,
  kind: string,
  symbol: string | null,
): string {
  if (symbol) return "";
  const map = PICTO as Record<string, string>;
  const kinds = KIND_PICTO as Record<string, string>;
  return map[name] ?? kinds[kind] ?? kinds.object ?? "";
}

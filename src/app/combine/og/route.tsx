import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";

const SIZE = { width: 1200, height: 630 };

const AGE_COUNT_DEFAULT = 6;

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const day = sp.get("d") ?? "";
  const score = Number(sp.get("s") ?? "0") || 0;
  const age = Math.max(0, Math.min(10, Number(sp.get("a") ?? "0") || 0));
  const made = Math.max(0, Number(sp.get("m") ?? "0") || 0);
  const best = (sp.get("b") ?? "").slice(0, 48);
  const ageName = (sp.get("an") ?? "").slice(0, 24);
  const totalAges = Math.max(
    age + 1,
    Math.min(10, Number(sp.get("ac") ?? AGE_COUNT_DEFAULT) || AGE_COUNT_DEFAULT),
  );

  const title = day ? `Daily Combine · ${day}` : "Combine";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          padding: "64px 80px",
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
            gap: 16,
            fontWeight: 800,
          }}
        >
          <div style={{ fontSize: 42, letterSpacing: "-0.02em" }}>Made Of</div>
          <div style={{ fontSize: 20, color: "#4A4F55" }}>{title}</div>
        </div>

        {/* Ages row — one square per age, filled up to the reached age */}
        <div
          style={{
            display: "flex",
            gap: 20,
            marginTop: 56,
          }}
        >
          {Array.from({ length: totalAges }, (_, k) => {
            const reached = k <= age;
            return (
              <div
                key={k}
                style={{
                  width: 112,
                  height: 112,
                  background: reached ? "#B5DDA4" : "#E6E7E2",
                  border: "6px solid #111417",
                  borderRadius: 10,
                  boxShadow: reached ? "8px 8px 0 #111417" : "none",
                }}
              />
            );
          })}
        </div>

        {/* Reached line */}
        {ageName ? (
          <div
            style={{
              marginTop: 36,
              fontSize: 44,
              fontWeight: 700,
              letterSpacing: "-0.015em",
            }}
          >
            Reached the {ageName} age
          </div>
        ) : null}

        {/* Score + made row */}
        <div
          style={{
            marginTop: ageName ? 20 : 36,
            display: "flex",
            alignItems: "baseline",
            gap: 32,
          }}
        >
          <div
            style={{
              fontSize: 128,
              fontWeight: 800,
              letterSpacing: "-0.03em",
              lineHeight: 1,
            }}
          >
            {score.toLocaleString("en")}
          </div>
          <div style={{ fontSize: 36, fontWeight: 600, color: "#4A4F55" }}>
            points · {made} made
          </div>
        </div>

        {/* Best line */}
        {best ? (
          <div
            style={{
              marginTop: "auto",
              fontSize: 32,
              fontWeight: 600,
              color: "#111417",
            }}
          >
            best: {best}
          </div>
        ) : (
          <div style={{ marginTop: "auto" }} />
        )}

        {/* Footer */}
        <div
          style={{
            marginTop: 24,
            fontSize: 24,
            color: "#4A4F55",
            fontWeight: 600,
          }}
        >
          madeof.app/combine
        </div>
      </div>
    ),
    SIZE,
  );
}

import { ImageResponse } from "next/og";

export const runtime = "nodejs";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#C9B8F5",
        }}
      >
        <svg
          width="135"
          height="135"
          viewBox="0 0 32 32"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M16 2l3 8 8-3-4 8 7 3-8 3 3 8-8-4-3 8-3-8-8 4 3-8-8-3 7-3-4-8 8 3z"
            fill="#fff"
            stroke="#111417"
            strokeWidth="2.2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <circle cx="16" cy="16" r="2.5" fill="#111417" />
        </svg>
      </div>
    ),
    size,
  );
}

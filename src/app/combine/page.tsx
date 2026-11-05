import type { Metadata } from "next";
import { CombinePageBody } from "@/components/combine/CombinePageBody";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;

function pick(sp: SP, key: string): string | null {
  const v = sp[key];
  if (!v) return null;
  return Array.isArray(v) ? v[0] ?? null : v;
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<SP>;
}): Promise<Metadata> {
  const sp = await searchParams;
  const day = pick(sp, "d");
  const score = pick(sp, "s");
  const mode = pick(sp, "mo");
  const themeName = pick(sp, "tn");
  // Only render a result card when the share params are present; otherwise
  // fall back to the generic Combine metadata.
  const hasDaily = Boolean(day && score);
  const hasMode = Boolean(mode && score);
  const hasResult = hasDaily || hasMode;
  let title = "Combine · Made Of";
  let description =
    "A tile-combining puzzle. Place touching things that make something, and watch recipes chain into one another.";
  if (hasDaily) {
    title = `Daily Combine · ${day}`;
    description = `${Number(score).toLocaleString("en")} points in today's Daily Combine. Can you beat it?`;
  } else if (hasMode) {
    const themeLabel = themeName ? ` · ${themeName}` : "";
    title =
      mode === "fast"
        ? `Fast Combine${themeLabel}`
        : `Combine${themeLabel}`;
    description = `${Number(score).toLocaleString("en")} points in ${
      mode === "fast" ? "Fast Combine" : "Combine"
    }${themeName ? ` (${themeName})` : ""}. Can you beat it?`;
  }
  const ogQs = hasResult
    ? "?" +
      new URLSearchParams(
        Object.fromEntries(
          (["d", "s", "a", "m", "b", "an", "ac", "f", "lc", "sh", "mo", "tn", "t", "tg"] as const)
            .map((k) => [k, pick(sp, k)] as const)
            .filter(([, v]) => v != null) as [string, string][],
        ),
      ).toString()
    : "";
  return {
    title,
    description,
    alternates: { canonical: "/combine" },
    openGraph: {
      title,
      description,
      type: "website",
      images: [`/combine/og${ogQs}`],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [`/combine/og${ogQs}`],
    },
  };
}

export default function CombinePage() {
  return <CombinePageBody />;
}

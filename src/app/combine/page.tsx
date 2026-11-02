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
  // Only render a result card when the share params are present; otherwise
  // fall back to the generic Combine metadata.
  const hasResult = Boolean(day && score);
  const title = hasResult ? `Daily Combine · ${day}` : "Combine · Made Of";
  const description = hasResult
    ? `${Number(score).toLocaleString("en")} points in today's Daily Combine. Can you beat it?`
    : "A tile-combining puzzle. Place touching things that make something, and watch recipes chain into one another.";
  const ogQs = hasResult
    ? "?" +
      new URLSearchParams(
        Object.fromEntries(
          (["d", "s", "a", "m", "b", "an", "ac", "f", "lc", "sh"] as const)
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

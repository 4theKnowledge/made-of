import type { Metadata } from "next";
import { CombinePageBody } from "@/components/combine/CombinePageBody";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Combine · Made Of",
  description:
    "A tile-combining puzzle. Place touching things that make something, and watch recipes chain into one another.",
  alternates: { canonical: "/combine" },
};

export default function CombinePage() {
  return <CombinePageBody />;
}

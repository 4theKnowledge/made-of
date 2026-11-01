import type { Metadata } from "next";
import { CombinePageBody } from "@/components/combine/CombinePageBody";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Made Of — a game of combining things",
  description:
    "Combine touching things that make something, and watch recipes chain into one another. Everything is made of something.",
  alternates: { canonical: "/combine" },
};

export default function HomePage() {
  return <CombinePageBody />;
}

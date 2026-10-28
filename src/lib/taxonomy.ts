import type { ItemKind, Tier } from "@/db/schema";

/** Ported from legacy/made-of.html TIERS, KINDS (lines 1096 and 1101). */

export const TIER: Record<Tier, { name: string; var: string }> = {
  F: { name: "Fundamental", var: "--tF" },
  N: { name: "Natural", var: "--tN" },
  M: { name: "Material", var: "--tM" },
  C: { name: "Component", var: "--tC" },
  P: { name: "Product", var: "--tP" },
  S: { name: "System", var: "--tS" },
};

export const TIER_ORDER: Tier[] = ["F", "N", "M", "C", "P", "S"];

export const KIND: Record<ItemKind, string> = {
  cosmic: "Cosmic",
  element: "Element",
  mineral: "Mineral",
  living: "Living",
  substance: "Substance",
  food: "Food",
  energy: "Energy",
  part: "Part",
  object: "Object",
  tool: "Tool",
  place: "Place",
  information: "Information",
};

/** CSS var reference for the tier's ink colour. */
export function tierColor(t: Tier) {
  return `var(${TIER[t].var})`;
}

/** Capitalise the first letter — the prototype's `cap` helper. */
export function cap(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

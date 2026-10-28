import type { ItemKind, Tier } from "@/db/schema";

export interface ScratchItem {
  slug: string;
  code: string;
  name: string;
  tier: Tier;
  kind: ItemKind;
  symbol: string | null;
}

export interface ScratchItemFull extends ScratchItem {
  fact: string;
  firstAppeared: string | null;
}

export interface ScratchRecipeView {
  id: string;
  label: string | null;
  position: number;
  requires: Array<ScratchItem & { have: boolean }>;
}

export interface ScratchStateResponse {
  target: ScratchItemFull;
  targetRecipes: ScratchRecipeView[];
  bestRecipeIndex: number;
  par: number;
  ready: ScratchItemFull[];
  missing: number;
  won: boolean;
}

export interface ScratchPickerResult {
  code: string;
  slug: string;
  name: string;
  tier: Tier;
  kind: ItemKind;
  symbol: string | null;
  difficulty: "easy" | "medium" | "hard" | "extra";
  par: number;
}

export interface ScratchMakeResponse {
  ok: boolean;
  reason?: string;
  item?: ScratchItemFull;
  won?: boolean;
}

export type SortMode = "tier" | "az";

export const PENALTY = {
  hint: 50,
  hide: 25,
  detour: 5,
};

import type { LinkType } from "@/db/schema";

/**
 * Ported verbatim from legacy/made-of.html REL (line 1105) and REL_INFO
 * (line 2608). "up" is the view from the thing looking at its parent
 * ("made from"); "down" is the view from the parent looking at its child
 * ("goes into").
 */
export const REL: Record<
  LinkType,
  { up: string; down: string; dash: string; group: string; desc: string }
> = {
  f: {
    up: "Made from",
    down: "Goes into",
    dash: "",
    group: "Made from",
    desc: "An ingredient that becomes part of the thing.",
  },
  w: {
    up: "Made with",
    down: "Used to make",
    dash: "6 5",
    group: "Made with",
    desc: "A tool or process that's needed but doesn't end up in the thing.",
  },
  n: {
    up: "Needs",
    down: "Needed by",
    dash: "1.5 4.5",
    group: "Needs",
    desc: "Something required, like energy, food or the right conditions, that isn't an ingredient.",
  },
  s: {
    up: "Comes from",
    down: "Source of",
    dash: "14 4 2 4",
    group: "Comes from",
    desc: "Where something is found or produced, when that's worth knowing.",
  },
  e: {
    up: "Evolved from",
    down: "Evolved into",
    dash: "3 3 9 3",
    group: "Evolved from",
    desc: "A living ancestor. Used only for living things.",
  },
};

/** Up-side order of link groups in the UI (matches artifact RORDER). */
export const RORDER: LinkType[] = ["e", "f", "w", "n", "s"];

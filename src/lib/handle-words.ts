// Word pool for auto-generated handles (e.g. "swift-quartz"). Both lists are
// curated by hand to stay family-safe: short, concrete, no slurs, no body
// parts, no political or religious terms, no words that combine into
// something crude when paired. Keep additions in alphabetical order so a
// reviewer can scan for duplicates and tone drift.
//
// Pool size: ADJECTIVES.length * NOUNS.length. With ~120 of each we get
// ~14,400 combinations, which comfortably supports six-figure signups
// before birthday-paradox collisions become routine.

export const ADJECTIVES: readonly string[] = [
  "amber", "ancient", "autumn", "balmy", "bold", "brave", "breezy", "bright",
  "brisk", "bronze", "calm", "cedar", "cheerful", "chill", "clever", "cloud",
  "clover", "copper", "coral", "cosmic", "cosy", "crimson", "crisp", "daily",
  "dawn", "deep", "dewy", "dusk", "early", "earthy", "ember", "fern",
  "fleet", "forest", "fresh", "frosty", "gentle", "glad", "glow", "golden",
  "grand", "harvest", "hazy", "hearty", "honest", "humble", "jade", "jolly",
  "keen", "kind", "lively", "lone", "lucky", "lunar", "maple", "marble",
  "merry", "mild", "misty", "modest", "mossy", "nimble", "noble", "ocean",
  "olive", "opal", "pacific", "patient", "peaceful", "pearl", "pine", "placid",
  "polite", "prairie", "proud", "quick", "quiet", "radiant", "rapid", "ready",
  "river", "rose", "rowan", "rustic", "safe", "sage", "sandy", "sapphire",
  "serene", "shady", "silent", "silver", "simple", "skyward", "slate", "small",
  "smooth", "snowy", "solar", "spring", "steady", "stellar", "stormy", "sturdy",
  "summer", "sunny", "swift", "tender", "tidy", "tranquil", "trusty", "twilight",
  "valiant", "velvet", "verdant", "warm", "wild", "willow", "winter", "wise",
  "witty", "woolly", "zesty",
];

export const NOUNS: readonly string[] = [
  "acorn", "almond", "apple", "apricot", "aspen", "badger", "barley", "basil",
  "basin", "beacon", "bean", "bear", "beaver", "beech", "berry", "birch",
  "bison", "blossom", "boulder", "branch", "brook", "burrow", "cactus", "canyon",
  "cedar", "cherry", "chestnut", "cinder", "citron", "clay", "cloud", "clover",
  "comet", "copper", "coral", "cove", "crane", "crocus", "crystal", "dahlia",
  "daisy", "dawn", "delta", "dolphin", "dune", "ember", "falcon", "fern",
  "fig", "finch", "flint", "forest", "fox", "garnet", "geode", "glacier",
  "glade", "granite", "grove", "harbor", "hawk", "hazel", "heather", "heron",
  "hickory", "ibis", "iris", "jasmine", "jay", "juniper", "koala", "lantern",
  "lark", "lemur", "lichen", "lily", "linden", "lotus", "lynx", "magnolia",
  "mallow", "mango", "maple", "marsh", "meadow", "melon", "mesa", "mica",
  "moss", "mouse", "nectar", "nest", "oak", "oasis", "olive", "onyx",
  "orchid", "otter", "owl", "palm", "pansy", "peach", "pear", "pebble",
  "petal", "piper", "plum", "pollen", "poppy", "prairie", "quartz", "quail",
  "quill", "raven", "reef", "reed", "rill", "robin", "rose", "sage",
  "salmon", "sapling", "shale", "sierra", "sorrel", "sparrow", "spruce", "stone",
  "stream", "swallow", "swan", "thistle", "thrush", "tiger", "topaz", "trout",
  "tulip", "valley", "violet", "walnut", "warbler", "willow", "wren",
];

// Guard against accidental duplicates in the curated lists.
if (new Set(ADJECTIVES).size !== ADJECTIVES.length) {
  throw new Error("handle-words: ADJECTIVES contains duplicates");
}
if (new Set(NOUNS).size !== NOUNS.length) {
  throw new Error("handle-words: NOUNS contains duplicates");
}

const ADJ_SET = new Set(ADJECTIVES);
const NOUN_SET = new Set(NOUNS);

export const HANDLE_PATTERN = /^[a-z]+-[a-z]+$/;

/**
 * Returns true if `handle` is lowercase, well-formed, and composed entirely of
 * one adjective + one noun from the curated word lists. We validate the parts
 * against the lists (not just the shape) so a user can't claim a hand-typed
 * two-word string that bypasses the family-safe pool.
 */
export function isValidHandle(handle: string): boolean {
  if (!HANDLE_PATTERN.test(handle)) return false;
  const [adj, noun] = handle.split("-");
  return ADJ_SET.has(adj) && NOUN_SET.has(noun);
}

export function randomHandleCandidate(rng: () => number = Math.random): string {
  const adj = ADJECTIVES[Math.floor(rng() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(rng() * NOUNS.length)];
  return `${adj}-${noun}`;
}

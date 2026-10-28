/**
 * Opaque ids: short random codes the API emits in place of slugs, so the
 * graph can't be walked by guessing item or link names.
 *
 * Codes are 8 base32 characters (Crockford, no vowels or ambiguous digits).
 * At 2^40 possibilities, collisions are vanishingly rare at our scale (~1k
 * items + ~1k links). The map is rebuilt each snapshot reload; codes are
 * stable within a process but will rotate on redeploy, which is fine for an
 * anti-scraping measure.
 */

import { createHash, randomBytes } from "node:crypto";

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz"; // Crockford, lowercase
const CODE_LEN = 8;

export interface CodeMap<T extends string> {
  toCode(id: T): string | undefined;
  toId(code: string): T | undefined;
  entries(): IterableIterator<[T, string]>;
  size: number;
}

/**
 * Build a code map over a list of ids. Deterministic if `seed` is given,
 * otherwise random. We default to deterministic (hash of id + process-start
 * salt) so codes stay stable across the snapshot's lifetime and tests can
 * assert them.
 */
export function buildCodeMap<T extends string>(
  ids: Iterable<T>,
  seed: string = randomBytes(16).toString("hex"),
): CodeMap<T> {
  const toCode = new Map<T, string>();
  const toId = new Map<string, T>();

  for (const id of ids) {
    let attempt = 0;
    let code = hashCode(seed, id, attempt);
    while (toId.has(code)) {
      attempt += 1;
      code = hashCode(seed, id, attempt);
    }
    toCode.set(id, code);
    toId.set(code, id);
  }

  return {
    toCode: (id) => toCode.get(id),
    toId: (code) => toId.get(code),
    entries: () => toCode.entries(),
    get size() {
      return toCode.size;
    },
  };
}

function hashCode(seed: string, id: string, attempt: number): string {
  const h = createHash("sha256")
    .update(seed)
    .update("\0")
    .update(id)
    .update("\0")
    .update(String(attempt))
    .digest();
  // Take 5 bytes (40 bits), base32-encode.
  let bits = 0n;
  for (let i = 0; i < 5; i++) bits = (bits << 8n) | BigInt(h[i]);
  let out = "";
  for (let i = 0; i < CODE_LEN; i++) {
    out = ALPHABET[Number(bits & 31n)] + out;
    bits >>= 5n;
  }
  return out;
}

/** Validate a code looks well-formed before even trying to look it up. */
const CODE_RE = new RegExp(`^[${ALPHABET}]{${CODE_LEN}}$`);
export function isValidCode(s: string): boolean {
  return CODE_RE.test(s);
}

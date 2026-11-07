/**
 * HMAC-signed cookie round-trip for anon sessions (T-0175).
 *
 * We can't exercise the Next.js cookie store from a unit test, so this
 * file tests the signing primitives via their public surface
 * (`readAnonId` with a stubbed `cookies()`). The goals:
 *   - a valid signed value round-trips to the same uuid
 *   - a tampered value is rejected
 *   - an unsigned value is rejected
 *   - a different secret rejects the cookie
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// Ensure a predictable secret before the module is imported.
const SECRET = "test-combine-signing-secret-1234567890";
process.env.COMBINE_SIGNING_SECRET = SECRET;

// Stub `next/headers` so `cookies()` returns an in-memory store we can
// write to from each test.
const store = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      store.has(name) ? { name, value: store.get(name)! } : undefined,
    set: (name: string, value: string) => {
      store.set(name, value);
    },
  }),
  headers: async () => new Headers(),
}));

// Also stub session so `getRunOwner` doesn't try to boot Better Auth.
vi.mock("./session", () => ({
  getSession: async () => null,
  isAdmin: async () => false,
  requireUser: async () => {
    throw new Error("not used");
  },
}));

async function importModule() {
  // Fresh import per test so env mutations take effect.
  vi.resetModules();
  return await import("./anon-session");
}

describe("anon-session cookie signing", () => {
  beforeEach(() => {
    store.clear();
    process.env.COMBINE_SIGNING_SECRET = SECRET;
  });

  it("mints + round-trips a signed id", async () => {
    const mod = await importModule();
    const id = await mod.getOrMintAnonId();
    expect(id).toMatch(/^[0-9a-f-]{36}$/i);
    // Second call reads the cookie and returns the same id.
    const again = await mod.getOrMintAnonId();
    expect(again).toBe(id);
    const read = await mod.readAnonId();
    expect(read).toBe(id);
  });

  it("rejects an unsigned cookie value", async () => {
    store.set("madeof_anon", "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    const mod = await importModule();
    expect(await mod.readAnonId()).toBeNull();
  });

  it("rejects a tampered signature", async () => {
    const mod = await importModule();
    await mod.getOrMintAnonId();
    const value = store.get("madeof_anon")!;
    // Flip one base64url char in the signature half.
    const dot = value.indexOf(".");
    const tampered = value.slice(0, dot + 1) + "A" + value.slice(dot + 2);
    store.set("madeof_anon", tampered);
    expect(await mod.readAnonId()).toBeNull();
  });

  it("rejects when the secret changes", async () => {
    const mod = await importModule();
    const id = await mod.getOrMintAnonId();
    expect(id).toBeTruthy();
    // Rotate the secret and re-import. The old signature no longer
    // verifies, so readAnonId returns null.
    process.env.COMBINE_SIGNING_SECRET = SECRET + "-rotated";
    const mod2 = await importModule();
    expect(await mod2.readAnonId()).toBeNull();
  });

  it("refuses to sign when the secret is missing", async () => {
    delete process.env.COMBINE_SIGNING_SECRET;
    const mod = await importModule();
    await expect(mod.getOrMintAnonId()).rejects.toThrow();
  });
});

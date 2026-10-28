import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { parsePrototype } from "../parser/prototype";
import { toRows } from "../parser/load";
import { buildCanaryLinks } from "../parser/canaries";
import { buildSnapshot } from "../graph/snapshot";
import { buildCodeMap } from "../graph/codes";
import { buildClosedSet } from "../graph/daily";
import {
  setLiveSnapshotForTesting,
  type LiveSnapshot,
} from "../graph/live";
import { resetAllLimiters } from "./rate-limit";
import { GET as getItem } from "../app/api/items/[code]/route";
import { GET as getSearch } from "../app/api/search/route";
import { GET as getPath } from "../app/api/path/route";
import { GET as getEverything } from "../app/api/items/[code]/everything/route";

/* Build an in-memory LiveSnapshot from the artifact + canaries. No DB needed. */
function buildFixture(): LiveSnapshot {
  const html = readFileSync(
    resolve(process.cwd(), "legacy/made-of.html"),
    "utf8",
  );
  const rows = toRows(parsePrototype(html));
  const canaries = buildCanaryLinks(new Set(rows.items.map((i) => i.id)));
  rows.links.push(...canaries.links);
  const snapshot = buildSnapshot(rows);
  const itemCodes = buildCodeMap(
    [...snapshot.nodes.keys()],
    "test-seed",
  );
  const linkCodes = buildCodeMap(
    rows.links.map((l) => l.id),
    "test-seed:links",
  );
  const closed = buildClosedSet(snapshot);
  return { snapshot, itemCodes, linkCodes, closed, version: 1 };
}

let live: LiveSnapshot;

beforeAll(() => {
  live = buildFixture();
  setLiveSnapshotForTesting(live);
});

afterEach(() => {
  resetAllLimiters();
});

function makeReq(url: string, headers: Record<string, string> = {}) {
  // A fresh IP per request keeps rate limiters from interacting across tests.
  const ip = headers["cf-connecting-ip"] ?? "127.0.0.1";
  return new NextRequest(url, { headers: { "cf-connecting-ip": ip, ...headers } });
}

async function json(res: Response | unknown): Promise<unknown> {
  const r = res as Response;
  return JSON.parse(await r.text());
}

/* ========================================================================
 * Shape and anti-scraping invariants.
 * ====================================================================== */

describe("GET /api/items/:code", () => {
  it("returns one item's neighbourhood with opaque codes", async () => {
    const code = live.itemCodes.toCode("water")!;
    const res = (await getItem(
      makeReq(`http://localhost/api/items/${code}`),
      { params: Promise.resolve({ code }) },
    )) as Response;
    expect(res.status).toBe(200);
    const body = (await json(res)) as {
      slug: string;
      up: Array<{ item: string }>;
      down: Array<{ item: string }>;
    };
    expect(body.slug).toBe("water");
    // Response must be bounded — never the whole graph.
    const ids = new Set<string>([
      ...body.up.map((e) => e.item),
      ...body.down.map((e) => e.item),
    ]);
    expect(ids.size).toBeLessThan(live.snapshot.nodes.size / 2);
    // No raw slug leaks (every edge uses the opaque code form).
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-hjkmnp-tv-z]{8}$/);
    }
  });

  it("includes canary edges in API responses", async () => {
    const code = live.itemCodes.toCode("pencil")!;
    const res = (await getItem(
      makeReq(`http://localhost/api/items/${code}`),
      { params: Promise.resolve({ code }) },
    )) as Response;
    const body = (await json(res)) as {
      up: Array<{ item: string }>;
    };
    const copperCode = live.itemCodes.toCode("copper")!;
    const linkedCopper = body.up.some((e) => e.item === copperCode);
    expect(linkedCopper).toBe(true);
  });

  it("rejects malformed codes with 404", async () => {
    const res = (await getItem(makeReq("http://localhost/api/items/BADCODE"), {
      params: Promise.resolve({ code: "BADCODE" }),
    })) as Response;
    expect(res.status).toBe(404);
  });

  it("rejects unknown codes with 404", async () => {
    const res = (await getItem(
      makeReq("http://localhost/api/items/aaaaaaaa"),
      { params: Promise.resolve({ code: "aaaaaaaa" }) },
    )) as Response;
    expect(res.status).toBe(404);
  });

  it("rate-limits a crawler", async () => {
    const code = live.itemCodes.toCode("water")!;
    // The items limiter is 60/minute. 61st in the same minute, from the same
    // IP, must be rejected.
    let last: Response | undefined;
    for (let i = 0; i < 65; i++) {
      last = (await getItem(
        makeReq(`http://localhost/api/items/${code}`, {
          "cf-connecting-ip": "10.0.0.1",
        }),
        { params: Promise.resolve({ code }) },
      )) as Response;
    }
    expect(last!.status).toBe(429);
    expect(last!.headers.get("retry-after")).not.toBeNull();
  });
});

describe("GET /api/search", () => {
  it("returns at most ten codes and never raw slugs", async () => {
    const res = (await getSearch(
      makeReq("http://localhost/api/search?q=water"),
    )) as Response;
    expect(res.status).toBe(200);
    const body = (await json(res)) as {
      results: Array<{ code: string; name: string }>;
    };
    expect(body.results.length).toBeLessThanOrEqual(10);
    for (const r of body.results) {
      expect(r.code).toMatch(/^[0-9a-hjkmnp-tv-z]{8}$/);
    }
  });

  it("returns empty for short queries", async () => {
    const res = (await getSearch(
      makeReq("http://localhost/api/search?q=a"),
    )) as Response;
    const body = (await json(res)) as { results: unknown[] };
    expect(body.results).toEqual([]);
  });
});

describe("GET /api/path", () => {
  it("returns a path as codes only, never the raw graph", async () => {
    const from = live.itemCodes.toCode("big-bang")!;
    const to = live.itemCodes.toCode("water")!;
    const res = (await getPath(
      makeReq(`http://localhost/api/path?from=${from}&to=${to}`),
    )) as Response;
    expect(res.status).toBe(200);
    const body = (await json(res)) as {
      length: number;
      steps: Array<{ item: string }>;
    };
    expect(body.length).toBeGreaterThan(0);
    // The path's reach is way smaller than the whole graph.
    expect(body.steps.length).toBeLessThan(20);
    for (const s of body.steps)
      expect(s.item).toMatch(/^[0-9a-hjkmnp-tv-z]{8}$/);
  });

  it("rejects malformed codes", async () => {
    const res = (await getPath(
      makeReq("http://localhost/api/path?from=xx&to=yy"),
    )) as Response;
    expect(res.status).toBe(400);
  });
});

describe("GET /api/items/:code/everything", () => {
  it("returns 402 without the paid entitlement", async () => {
    const code = live.itemCodes.toCode("water")!;
    const res = (await getEverything(
      makeReq(`http://localhost/api/items/${code}/everything`),
      { params: Promise.resolve({ code }) },
    )) as Response;
    expect(res.status).toBe(402);
  });

  it("returns ancestors for a paid caller", async () => {
    const code = live.itemCodes.toCode("water")!;
    const res = (await getEverything(
      makeReq(`http://localhost/api/items/${code}/everything`, {
        "x-dev-entitlement": "family",
      }),
      { params: Promise.resolve({ code }) },
    )) as Response;
    expect(res.status).toBe(200);
    const body = (await json(res)) as { items: string[] };
    // Water's full ancestor set is a few items, nowhere near all 276.
    expect(body.items.length).toBeGreaterThan(1);
    expect(body.items.length).toBeLessThan(276);
    for (const c of body.items)
      expect(c).toMatch(/^[0-9a-hjkmnp-tv-z]{8}$/);
  });
});

/* ========================================================================
 * Global anti-scraping invariant: no single response ever ships the graph.
 * ====================================================================== */

describe("anti-scraping invariant", () => {
  it("no public response contains every item", async () => {
    // Walk every public GET and assert its item codes count stays < total.
    const total = live.snapshot.nodes.size;
    const code = live.itemCodes.toCode("humans")!;

    const r1 = (await getItem(
      makeReq(`http://localhost/api/items/${code}`, {
        "cf-connecting-ip": "9.9.9.1",
      }),
      { params: Promise.resolve({ code }) },
    )) as Response;
    const b1 = (await json(r1)) as {
      up: Array<{ item: string }>;
      down: Array<{ item: string }>;
    };
    expect(b1.up.length + b1.down.length).toBeLessThan(total);

    const r2 = (await getSearch(
      makeReq("http://localhost/api/search?q=an", {
        "cf-connecting-ip": "9.9.9.2",
      }),
    )) as Response;
    const b2 = (await json(r2)) as { results: unknown[] };
    expect(b2.results.length).toBeLessThanOrEqual(10);

    const r3 = (await getPath(
      makeReq(
        `http://localhost/api/path?from=${live.itemCodes.toCode("big-bang")!}&to=${code}`,
        { "cf-connecting-ip": "9.9.9.3" },
      ),
    )) as Response;
    const b3 = (await json(r3)) as { steps: Array<{ item: string }> };
    expect(b3.steps.length).toBeLessThan(total / 4);
  });
});

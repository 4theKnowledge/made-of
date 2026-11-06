/**
 * Mechanical content-shape guardrails.
 *
 * Delegates to `auditGraph` in `src/data/invariants.ts` so the admin
 * mutation seams can enforce the same two invariants at write time. The
 * message shape (`formatAudit`) is identical to what this test used to
 * emit directly, so CI output stays stable.
 */

import { describe, it, expect } from "vitest";
import { loadKnowledgeBase } from "../../data/load";
import { toRows } from "../../data/rows";
import { buildSnapshot } from "../../graph/snapshot";
import { auditGraph, formatAudit } from "../../data/invariants";

describe("combine content shape", () => {
  it("every item reaches big bang via upstream edges", () => {
    const kb = loadKnowledgeBase();
    const snap = buildSnapshot(toRows(kb));
    expect(snap.byName.get("big bang"), "`big bang` item not found in KB")
      .toBeDefined();

    const audit = auditGraph(snap);
    if (audit.orphans.length > 0) {
      throw new Error(formatAudit({ orphans: audit.orphans, deadEndRaws: [] }));
    }
    expect(audit.orphans).toEqual([]);
  });

  it("no dead-end raws in any Combine theme", () => {
    const kb = loadKnowledgeBase();
    const snap = buildSnapshot(toRows(kb));

    const audit = auditGraph(snap);
    if (audit.deadEndRaws.length > 0) {
      throw new Error(
        formatAudit({ orphans: [], deadEndRaws: audit.deadEndRaws }),
      );
    }
    expect(audit.deadEndRaws).toEqual([]);
  });
});

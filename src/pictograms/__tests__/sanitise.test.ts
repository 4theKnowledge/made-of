import { describe, expect, it } from "vitest";
import { sanitisePictogram } from "../sanitise";

describe("sanitisePictogram", () => {
  it("accepts a canonical pictogram", () => {
    const r = sanitisePictogram(
      `<circle class="b" cx="16" cy="16" r="6"/><path class="l" d="M3 3h26"/>`,
    );
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("accepts an empty value (fallback)", () => {
    const r = sanitisePictogram("");
    expect(r.ok).toBe(true);
    expect(r.value).toBe("");
  });

  it("rejects <script>", () => {
    const r = sanitisePictogram(`<script>alert(1)</script>`);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("script"))).toBe(true);
  });

  it("rejects event handlers", () => {
    const r = sanitisePictogram(`<circle class="b" cx="1" cy="1" r="1" onclick="x()"/>`);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("onclick"))).toBe(true);
  });

  it("rejects disallowed classes", () => {
    const r = sanitisePictogram(`<circle class="danger" cx="1" cy="1" r="1"/>`);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("danger"))).toBe(true);
  });

  it("rejects data: URLs", () => {
    const r = sanitisePictogram(
      `<circle class="b" cx="1" cy="1" r="1" transform="data:evil"/>`,
    );
    expect(r.ok).toBe(false);
  });

  it("rejects <foreignObject>", () => {
    const r = sanitisePictogram(`<foreignObject><div>hi</div></foreignObject>`);
    expect(r.ok).toBe(false);
  });

  it("normalises whitespace between tags", () => {
    const r = sanitisePictogram(
      `<circle class="b" cx="1" cy="1" r="1"/>\n  <path class="l" d="M0 0h32"/>`,
    );
    expect(r.ok).toBe(true);
    expect(r.value).toBe(
      `<circle class="b" cx="1" cy="1" r="1"/><path class="l" d="M0 0h32"/>`,
    );
  });

  it("accepts <g> grouping", () => {
    const r = sanitisePictogram(
      `<g transform="rotate(45 16 16)"><circle class="b" cx="1" cy="1" r="1"/></g>`,
    );
    expect(r.ok).toBe(true);
  });

  it("accepts every allowed element at least once", () => {
    const r = sanitisePictogram(
      [
        `<path class="l" d="M0 0h32"/>`,
        `<circle class="b" cx="1" cy="1" r="1"/>`,
        `<ellipse class="b" cx="1" cy="1" rx="1" ry="1"/>`,
        `<rect class="b" x="1" y="1" width="4" height="4"/>`,
        `<line class="l" x1="0" y1="0" x2="32" y2="32"/>`,
        `<polyline class="l" points="0,0 1,1"/>`,
        `<polygon class="k" points="0,0 1,0 1,1"/>`,
      ].join(""),
    );
    expect(r.ok).toBe(true);
  });
});

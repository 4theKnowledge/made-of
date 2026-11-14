import { describe, expect, it } from "vitest";
import { formatDuration } from "./duration";

describe("formatDuration", () => {
  it("renders seconds only below one minute", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(999)).toBe("0s");
    expect(formatDuration(1_000)).toBe("1s");
    expect(formatDuration(23_500)).toBe("23s");
    expect(formatDuration(59_999)).toBe("59s");
  });

  it("renders mm + ss between one minute and one hour", () => {
    expect(formatDuration(60_000)).toBe("1m 00s");
    expect(formatDuration(83_412)).toBe("1m 23s");
    expect(formatDuration(725_000)).toBe("12m 05s");
    expect(formatDuration(3_599_000)).toBe("59m 59s");
  });

  it("renders hh + mm + ss at one hour and above", () => {
    expect(formatDuration(3_600_000)).toBe("1h 00m 00s");
    expect(formatDuration(3_750_000)).toBe("1h 02m 30s");
    expect(formatDuration(86_400_000)).toBe("24h 00m 00s");
  });

  it("clamps negatives to zero", () => {
    expect(formatDuration(-1_000)).toBe("0s");
  });
});

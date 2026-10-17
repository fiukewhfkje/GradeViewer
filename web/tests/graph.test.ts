import { describe, expect, it } from "vitest";
import { gradeCurve, type GraphPoint } from "../src/core/progression";

const points = (values: number[]): GraphPoint[] =>
  values.map((percent, i) => ({
    id: String(i),
    date: 1000 + i,
    percent,
    calculated: true,
  }));

describe("native GradeCurve geometry and event selection", () => {
  it("keeps observations authoritative, stable same-date events and unique identities", () => {
    const curve = gradeCurve([
      { id: "calculated", date: 10, percent: 70, calculated: true },
      { id: "observed", date: 10, percent: 71, calculated: false },
      { id: "a", date: 20, percent: 80, calculated: true },
      { id: "b", date: 20, percent: 81, calculated: true },
      { id: "b", date: 20, percent: 81, calculated: true },
      { id: "bad", date: 30, percent: NaN, calculated: true },
    ]);
    expect(curve.points.map((p) => p.id)).toEqual(["observed", "a", "b"]);
    expect(curve.event(0.24)?.id).toBe("observed");
    expect(curve.event(0.26)?.id).toBe("a");
    expect(curve.event(1)?.id).toBe("b");
  });
  it("traces native cubic geometry while tooltips retain discrete grades and dates", () => {
    const curve = gradeCurve(points([80, 100, 90]));
    expect(curve.trace(0)).toBeCloseTo(129.4193548387);
    expect(curve.trace(0.25)).toBeCloseTo(63.8951612903);
    expect(curve.trace(0.5)).toBeCloseTo(24.5806451613);
    expect(curve.trace(0.75)).toBeCloseTo(44.2379032258);
    expect(curve.event(0.25)?.percent).toBe(100);
    expect(curve.event(0.25)?.date).toBe(1001);
    // Intermediate samples stay within their own segment's extrema.
    for (let i = 0; i <= 100; i++) {
      const y = curve.trace(i / 100)!;
      expect(y).toBeGreaterThanOrEqual(24.5806451612);
      expect(y).toBeLessThanOrEqual(i < 50 ? 129.4193548388 : 77.0000000001);
    }
  });
  it("handles empty and single-event series at the native vertical midpoint", () => {
    expect(gradeCurve([]).path).toBe("");
    expect(gradeCurve([]).trace(0.5)).toBeUndefined();
    const curve = gradeCurve(points([99]));
    expect(curve.path).toBe("M0,77 L1000,77");
    expect(curve.trace(0)).toBe(77);
    expect(curve.trace(1)).toBe(77);
    expect(curve.event(1)?.percent).toBe(99);
  });
});

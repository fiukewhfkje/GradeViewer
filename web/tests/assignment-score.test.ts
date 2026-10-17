import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AssignmentScore } from "../src/AssignmentScore";
import type { Score } from "../src/core/model";

const text = (score: Score, override?: number) =>
  renderToStaticMarkup(createElement(AssignmentScore, { score, override }))
    .replace(/<[^>]+>/g, " ")
    .trim()
    .replace(/\s+/g, " ");

describe("native assignment score presentation", () => {
  it("shows excused status even with numeric data or a local override", () => {
    expect(text({ earned: 8, possible: 10, excused: true }, 9)).toBe("Excused");
  });
  it("shows numeric points and percent ahead of an accompanying letter", () => {
    expect(text({ earned: 8, possible: 10, letter: "B", excused: false })).toBe(
      "8/10 80%",
    );
  });
  it("shows only the letter for letter-only work and a dash for ungraded work", () => {
    expect(text({ possible: 10, letter: "P", excused: false })).toBe("P");
    expect(text({ possible: 10, excused: false })).toBe("—");
  });
  it("displays a local numeric override of a letter-only score, including zero", () => {
    expect(text({ possible: 10, letter: "P", excused: false }, 0)).toBe(
      "0/10 0%",
    );
  });
  it("retains signed/extra-credit scores and withholds a zero-denominator percent", () => {
    expect(text({ earned: -1.25, possible: 10, excused: false })).toBe(
      "-1.25/10 -12.5%",
    );
    expect(text({ earned: 11, possible: 10, excused: false })).toBe(
      "11/10 110%",
    );
    expect(text({ earned: 2, possible: 0, excused: false })).toBe("2/0 —");
  });
});

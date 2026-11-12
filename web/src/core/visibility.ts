import type { SavedState, SourceCourse } from "./model";
import { physicalKey } from "./periods";

export function schoologyHidden(c: SourceCourse, keys: string[] = []) {
  return (
    (c.fields.provider ?? "schoology") === "schoology" &&
    keys.includes(physicalKey(c))
  );
}

// A section's quarters, semester and exam share visibility. Saved source data,
// history, scenarios and provider connections stay independent and untouched.
export function workspaceCourses(state: SavedState) {
  return state.courses.filter((c) =>
    state.primaryLms === "carmen"
      ? c.fields.provider === "carmen"
      : c.fields.provider !== "carmen" &&
        !schoologyHidden(c, state.hiddenSchoology),
  );
}

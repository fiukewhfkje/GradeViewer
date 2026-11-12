import type { SavedState, SourceCourse, SchoologyVisibility } from "./model";
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

export function parseVisibility(value: unknown): SchoologyVisibility {
  const v = value as SchoologyVisibility | undefined;
  if (
    !v ||
    typeof v.account !== "string" ||
    !v.account ||
    typeof v.scope !== "string" ||
    !v.scope ||
    !Number.isSafeInteger(v.revision) ||
    v.revision < 0 ||
    !Array.isArray(v.hidden) ||
    v.hidden.length > 512 ||
    v.hidden.some(
      (id) => typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(id),
    ) ||
    new Set(v.hidden).size !== v.hidden.length
  )
    throw new Error("malformed");
  return v;
}

export function withVisibility(
  state: SavedState,
  remote: SchoologyVisibility,
): SavedState {
  const previous = state.schoologyVisibility;
  if (previous?.scope === remote.scope && previous.revision > remote.revision)
    return state;
  if (
    previous?.scope === remote.scope &&
    previous.revision === remote.revision &&
    JSON.stringify(state.hiddenSchoology ?? []) ===
      JSON.stringify(remote.hidden)
  )
    return state;
  return {
    ...state,
    hiddenSchoology: remote.hidden,
    schoologyVisibility: {
      account: remote.account,
      scope: remote.scope,
      revision: remote.revision,
    },
  };
}

import { openDB } from "idb";
import { emptyState, type SavedState } from "./core/model";
export interface Pending {
  state: SavedState;
  account: string;
  previousRevision?: string;
  scan: string;
}
let connection: ReturnType<typeof openDB> | undefined;
const db = () =>
  (connection ??= openDB("gradeviewer", 1, {
    upgrade(db) {
      db.createObjectStore("state");
    },
    blocking() {
      void connection?.then((d) => d.close());
      connection = undefined;
    },
    terminated() {
      connection = undefined;
    },
  }).catch((error) => {
    connection = undefined;
    throw error;
  }));
function restoreCourseList(s: SavedState): SavedState {
  if (s.schema !== 1) throw new Error("unsupportedLocalSchema");
  // Retire the short-lived blank-enrollment/hide feature in cached snapshots
  // too. Keep real grades, history, scenarios and GPA preferences intact.
  return {
    ...s,
    courses: s.courses
      .filter(
        (c) =>
          !(
            (c.fields.provider ?? "schoology") === "schoology" &&
            c.fields.metadata_only === "true"
          ),
      )
      .map((c) => (c.hidden ? { ...c, hidden: false } : c)),
  };
}
export async function load(): Promise<SavedState> {
  const d = await db(),
    s = await d.get("state", "active");
  return restoreCourseList(s ?? emptyState());
}
export async function save(s: SavedState) {
  try {
    const d = await db();
    await d.put("state", s, "active");
  } catch {
    throw new Error("storageFailed");
  }
}
export async function prepare(p: Pending) {
  try {
    const d = await db();
    await d.put("state", p, "pending");
  } catch {
    throw new Error("storageFailed");
  }
}
export async function pending(): Promise<Pending | undefined> {
  const p: Pending | undefined = await (await db()).get("state", "pending");
  return p ? { ...p, state: restoreCourseList(p.state) } : undefined;
}
export async function activate(s: SavedState) {
  try {
    const d = await db(),
      tx = d.transaction("state", "readwrite");
    await tx.store.put(s, "active");
    await tx.store.delete("pending");
    await tx.done;
  } catch {
    throw new Error("storageFailed");
  }
}
export async function cancel() {
  await (await db()).delete("state", "pending");
}
export async function clear() {
  const d = await db();
  await d.clear("state");
}

// This receipt unlocks only this browser's existing local cache. Provider/API
// access still requires the live HttpOnly session. Explicit Lock always wins.
export interface BrowserAccess {
  locked: boolean;
  account?: string;
  expires?: number;
}
export async function access(): Promise<BrowserAccess | undefined> {
  return (await db()).get("state", "access");
}
export async function rememberAccess(account?: string, expires?: number) {
  if (!account || !expires || expires <= Date.now()) return;
  const d = await db(),
    tx = d.transaction("state", "readwrite");
  const previous: BrowserAccess | undefined = await tx.store.get("access");
  if (!previous?.locked)
    await tx.store.put({ locked: false, account, expires }, "access");
  await tx.done;
}
export async function lock() {
  await (await db()).put("state", { locked: true }, "access");
}
export async function unlock() {
  await (await db()).delete("state", "access");
}
export function canReadCache(
  state: SavedState,
  receipt?: BrowserAccess,
  now = Date.now(),
) {
  return (
    !!state.account &&
    state.courses.length > 0 &&
    !receipt?.locked &&
    receipt?.account === state.account &&
    (receipt.expires ?? 0) > now
  );
}

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
export async function load(): Promise<SavedState> {
  const d = await db(),
    s = await d.get("state", "active");
  if (s && s.schema !== 1) throw new Error("unsupportedLocalSchema");
  return s ?? emptyState();
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
  return (await db()).get("state", "pending");
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

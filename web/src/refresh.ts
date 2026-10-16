import { api, RequestError, type Status } from "./api";
import {
  type SourceCourse,
  type SavedState,
  hasTitle,
  graded,
} from "./core/model";
import {
  parseSection,
  collection,
  object,
  nonempty,
  assignmentMetadata,
  type Row,
  type SectionPayload,
} from "./core/parser";
import { reconcile } from "./core/reconcile";
import * as repository from "./repository";
export async function readSnapshot(
  previous: SavedState,
  status: Status,
  credentials?: { key: string; secret: string },
  refreshMetadata = false,
): Promise<SavedState> {
  const { scan, account } = await api<{ scan: string; account: string }>(
    "scan/start",
    credentials ?? {},
  );
  let committed = false;
  async function read(
    resource: string,
    key?: string,
    section?: string,
    extra?: string,
    optional = false,
  ): Promise<Row[]> {
    const values: Row[] = [];
    let next = false;
    do {
      let response: { data: Row; next: boolean };
      for (let attempt = 0; ; attempt++) {
        try {
          response = await api("scan/read", {
            scan,
            resource,
            section,
            extra,
            next,
          });
          break;
        } catch (e) {
          if (
            !optional &&
            e instanceof RequestError &&
            e.code === "rateLimited" &&
            (e.retryAfter ?? 999) <= 10 &&
            attempt === 0
          ) {
            await new Promise((r) => setTimeout(r, e.retryAfter! * 1000 + 50));
            continue;
          }
          throw e;
        }
      }
      values.push(
        ...(key ? collection(response.data[key]) : [object(response.data)]),
      );
      next = response.next;
    } while (next);
    return values;
  }
  try {
    const sections = await read("sections", "section"),
      bulk = await read("grades", "section").catch((e) => {
        if (e instanceof RequestError && [403, 502].includes(e.status ?? 0))
          return undefined;
        throw e;
      });
    const metadata: NonNullable<SavedState["metadata"]> = {},
      payloads: { p: SectionPayload; enrollment: string; cachedAt?: number }[] =
        [],
      seen = new Set<string>(),
      sources: SourceCourse[] = [];
    const batches: { id: string; match?: Row }[] = [],
      gradeFailures: { id: string; error: unknown }[] = [];
    for (const enrollment of sections) {
      const id = nonempty(enrollment.id);
      if (!id) throw new Error("malformed");
      try {
        let grades = bulk?.filter((r) => nonempty(r.section_id) === id);
        if (!grades?.length) grades = await read("grades", "section", id);
        const match =
          grades.find((r) => nonempty(r.section_id) === id) ??
          (grades.length === 1 ? grades[0] : undefined);
        if (!match && grades.length) throw new Error("malformed");
        batches.push({ id, match });
      } catch (error) {
        gradeFailures.push({ id, error });
      }
    }
    const owners = new Set(
      batches.map((b) => nonempty(b.match?.section_id)).filter(Boolean),
    );
    for (const failure of gradeFailures)
      if (!(
        failure.error instanceof RequestError &&
        failure.error.status === 403 &&
        owners.has(failure.id)
      ))
        throw failure.error;
    for (const { id, match } of batches) {
      if (!match) continue;
      const owner = nonempty(match.section_id);
      if (!owner) throw new Error("malformed");
      if (seen.has(owner)) continue;
      seen.add(owner);
      const fingerprint = btoa(
          String.fromCharCode(
            ...new Uint8Array(
              await crypto.subtle.digest(
                "SHA-256",
                new TextEncoder().encode(JSON.stringify(match)),
              ),
            ),
          ),
        ),
        cached = previous.metadata?.[id];
      if (
        !credentials &&
        !refreshMetadata &&
        cached?.account === account &&
        cached.fingerprint === fingerprint &&
        Date.now() - cached.fetched < 5 * 60000
      ) {
        try {
          await api("scan/reuse", { scan, section: id });
          metadata[id] = cached;
          payloads.push({
            p: {
              ...structuredClone(cached.payload),
              grades: { section: [match] },
              owner,
              fetched: Date.now(),
            },
            enrollment: id,
            cachedAt: cached.fetched,
          });
          continue;
        } catch {
          /* Renew metadata when the server receipt has expired. */
        }
      }
      const [section] = await read("section", undefined, id),
        items = await read("items", "assignment", id),
        categories = await read("categories", "grading_category", id),
        periods = await read("periods", "grading_period", id).catch((e) => {
          if (e instanceof RequestError && e.status === 403) return [];
          throw e;
        });
      const p = {
        section,
        grades: { section: [match] },
        items,
        categories,
        periods,
        owner,
        fetched: Date.now(),
      };
      metadata[id] = {
        account,
        fetched: p.fetched,
        fingerprint,
        payload: { section, items, categories, periods },
      };
      payloads.push({ p, enrollment: id });
    }
    // Required reads finish before optional scale/title recovery can encounter a cooldown.
    for (const { p, enrollment, cachedAt } of payloads) {
      let parsed = parseSection(p);
      if (p.scales && cachedAt) {
        for (const c of parsed)
          if (c.fields.overall_scale_verified_at)
            c.fields.overall_scale_verified_at = String(cachedAt);
      }
      if (!p.scales && parsed.some((c) => c.fields.reported_scale_id)) {
        try {
          p.scales = await read(
            "scales",
            "grading_scale",
            enrollment,
            undefined,
            true,
          );
          metadata[enrollment].payload.scales = p.scales;
          parsed = parseSection(p);
        } catch {
          for (const c of parsed) {
            const old = previous.courses.find(
                (x) =>
                  x.id === c.id &&
                  x.fields.user_id === account &&
                  x.fields.reported_scale_id === c.fields.reported_scale_id &&
                  x.fields.section_id === c.fields.section_id,
              ),
              stamp = Number(old?.fields.overall_scale_verified_at);
            if (
              old?.fields.overall_scale_type &&
              Date.now() - stamp < 3600000 &&
              c.fields.reported_numeric_total
            ) {
              c.grade.percent = Number(c.fields.reported_numeric_total);
              delete c.fields.unsupported_overall_scale;
              c.fields.overall_scale_type = old.fields.overall_scale_type;
              c.fields.overall_scale_verified_at = String(stamp);
            }
          }
        }
      }
      sources.push(...parsed);
    }
    let optionalCooldown = false;
    const attemptedTitles = new Set<string>();
    for (const { p, enrollment } of payloads) {
      const courses = sources.filter(
          (c) => c.fields.grade_section_id === p.owner,
        ),
        unresolved = courses.flatMap((c) =>
          c.assignments
            .filter(
              (a) =>
                !hasTitle(a) &&
                graded(a) &&
                !previous.courses
                  .find((x) => x.id === c.id)
                  ?.removed.includes(a.id) &&
                !previous.courses
                  .find((x) => x.id === c.id)
                  ?.assignments.some(
                    (old) => old.id === a.id && hasTitle(old),
                  ) &&
                (refreshMetadata ||
                  Number(
                    previous.courses
                      .find((x) => x.id === c.id)
                      ?.assignments.find((old) => old.id === a.id)?.fields
                      .title_lookup_retry_after ?? 0,
                  ) <= Date.now()),
            )
            .map((a) => ({ a, c })),
        );
      const apply = (items: Row[]) => {
        for (const { a, c } of unresolved) {
          const candidates = items.filter(
              (i) =>
                String(i.grade_item_id ?? i.id) === a.fields.assignment_id ||
                String(i.id) === a.fields.assignment_id,
            ),
            valid = candidates
              .map((i) => assignmentMetadata(i, a, c.term.id))
              .filter((x) => x !== undefined);
          if (valid.length === 1) Object.assign(a, valid[0]);
        }
      };
      if (unresolved.length && !optionalCooldown) {
        for (const { a } of unresolved) attemptedTitles.add(a.id);
        try {
          for (const { a, c } of unresolved.slice(0, 20)) {
            if (!hasTitle(a)) {
              try {
                apply(
                  await read(
                    "assignment",
                    undefined,
                    enrollment,
                    a.fields.assignment_id,
                    true,
                  ),
                );
              } catch (e) {
                if (e instanceof RequestError && e.code === "rateLimited")
                  throw e;
              }
            }
          }
          if (unresolved.some(({ a }) => !hasTitle(a)))
            apply(
              await read(
                "assignmentList",
                "assignment",
                enrollment,
                undefined,
                true,
              ),
            );
          if (unresolved.some(({ a }) => !hasTitle(a))) {
            const queue = ["0"],
              visited = new Set<string>();
            while (queue.length && visited.size < 40) {
              const folder = queue.shift()!;
              if (visited.has(folder)) continue;
              visited.add(folder);
              const items = await read(
                "folder",
                "folder-item",
                enrollment,
                folder,
                true,
              );
              apply(items);
              for (const item of items)
                if (
                  item.type === "folder" &&
                  nonempty(item.id) &&
                  !visited.has(String(item.id))
                )
                  queue.push(String(item.id));
            }
          }
        } catch (e) {
          if (e instanceof RequestError && e.code === "rateLimited")
            optionalCooldown = true;
        }
      }
    }
    for (const c of sources) {
      c.fields.user_id = account;
      for (const a of c.assignments)
        if (!hasTitle(a)) {
          const old = previous.courses
            .find((x) => x.id === c.id)
            ?.assignments.find((x) => x.id === a.id);
          if (attemptedTitles.has(a.id))
            a.fields.title_lookup_retry_after = String(Date.now() + 15 * 60000);
          else if (old?.fields.title_lookup_retry_after)
            a.fields.title_lookup_retry_after =
              old.fields.title_lookup_retry_after;
        }
    }
    const latest = await repository.load();
    const preserved = latest.account === account ? latest : previous;
    const next: SavedState = {
      schema: 1,
      account,
      metadata,
      courses: reconcile(
        sources,
        preserved.account === account ? preserved.courses : [],
      ),
      scenarios: preserved.account === account ? preserved.scenarios : {},
    };
    await repository.prepare({
      state: next,
      account,
      previousRevision: status.revision,
      scan,
    });
    await api("scan/commit", { scan });
    committed = true;
    await repository.activate(next);
    void navigator.storage?.persist?.().catch(() => {});
    return next;
  } catch (e) {
    if (!committed) {
      await repository.cancel();
      await api("scan/cancel", { scan }).catch(() => {});
    }
    throw e;
  }
}

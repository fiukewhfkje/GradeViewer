import { api, type PortalStatus } from "./api";
import type { SavedState, SourceCourse } from "./core/model";
import { reconcile } from "./core/reconcile";
import * as repository from "./repository";
export async function refreshCampus(
  previous: SavedState,
  status?: PortalStatus,
): Promise<SavedState> {
  let courses: SourceCourse[] = [];
  if (status?.connected)
    ({ courses } = await api<{ account: string; courses: SourceCourse[] }>(
      "campus/snapshot",
      {},
    ));
  const latest = await repository.load(),
    base = latest.account === previous.account ? latest : previous;
  const next = {
    ...base,
    ...(!status?.connected
      ? {
          scenarios: Object.fromEntries(
            Object.entries(base.scenarios).filter(
              ([id]) => !id.startsWith("campus:"),
            ),
          ),
          ...(base.gpa
            ? {
                gpa: {
                  ...base.gpa,
                  courses: Object.fromEntries(
                    Object.entries(base.gpa.courses).filter(([key]) => {
                      try {
                        return !String(JSON.parse(key)[1]).startsWith(
                          "campus:",
                        );
                      } catch {
                        return true;
                      }
                    }),
                  ),
                },
              }
            : {}),
        }
      : {}),
    courses: reconcile(
      [
        ...base.courses.filter((c) => c.fields.provider !== "campus"),
        ...courses,
      ],
      base.courses,
    ),
  };
  await repository.save(next);
  return next;
}

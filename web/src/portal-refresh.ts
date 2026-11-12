import { api, resultValue, type ApiResult, type PortalStatus } from "./api";
import type { SavedState, SourceCourse } from "./core/model";
import { reconcile } from "./core/reconcile";
import * as repository from "./repository";
export interface PortalSnapshot {
  account: string;
  courses: SourceCourse[];
}
export async function refreshCampus(
  previous: SavedState,
  status?: PortalStatus,
  provider: "campus" | "carmen" = "campus",
  prefetched?: ApiResult<PortalSnapshot>,
): Promise<SavedState> {
  let courses: SourceCourse[] = [];
  if (status?.connected)
    ({ courses } = prefetched
      ? resultValue(prefetched, provider)
      : await api<PortalSnapshot>(provider + "/snapshot", {}));
  const latest = await repository.load(),
    base = latest.account === previous.account ? latest : previous;
  const next = {
    ...base,
    ...(!status?.connected && provider === "carmen"
      ? { carmenGpa: undefined }
      : {}),
    ...(!status?.connected
      ? {
          scenarios: Object.fromEntries(
            Object.entries(base.scenarios).filter(
              ([id]) => !id.startsWith(provider + ":"),
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
                          provider + ":",
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
        ...base.courses.filter((c) => c.fields.provider !== provider),
        ...courses,
      ],
      base.courses,
    ),
  };
  await repository.save(next);
  return next;
}

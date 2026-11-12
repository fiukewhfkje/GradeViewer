import { api, type Status } from "./api";
import type { SavedState } from "./core/model";
import { parseVisibility, schoologyHidden } from "./core/visibility";
import { physicalKey } from "./core/periods";
import * as repository from "./repository";

export async function synchronizeVisibility(local: SavedState, status: Status) {
  if (
    !status.authenticated ||
    !status.schoologyVisibility ||
    local.account !== status.account
  )
    return local;
  let remote = parseVisibility(status.schoologyVisibility);
  if (
    local.schoologyVisibility?.scope === remote.scope &&
    local.schoologyVisibility.revision >= remote.revision
  )
    return local;
  // Import old browser-only choices once. The Worker imports only untouched
  // keys, so a late/stale browser cannot undo an explicit restore elsewhere.
  const legacy =
    !local.schoologyVisibility && local.hiddenSchoology?.length
      ? [
          ...new Set(
            local.courses
              .filter(
                (course) =>
                  schoologyHidden(course, local.hiddenSchoology) &&
                  (course.fields.user_id ?? local.account) === remote.account,
              )
              .map(physicalKey),
          ),
        ]
      : [];
  if (legacy.length) {
    remote = parseVisibility(
      await api("course-visibility", {
        account: remote.account,
        scope: remote.scope,
        import: legacy,
      }),
    );
  }
  return (
    (await repository.mergeVisibility(
      local.account!,
      remote,
      local.schoologyVisibility?.scope,
    )) ?? local
  );
}

import { execFileSync } from "node:child_process";
// update.mjs writes only verified managed files and its non-secret receipt.
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
if (git("status", "--porcelain", "--untracked-files=all")) {
  git("config", "user.name", "GradeViewer updates");
  git(
    "config",
    "user.email",
    "41898282+github-actions[bot]@users.noreply.github.com",
  );
  git("add", "--", ".");
  git("commit", "-m", "Update GradeViewer from verified release");
  try {
    git("push", "origin", "HEAD");
  } catch {
    throw new Error(
      "Could not push the verified update. Check branch protection and repository write permissions. The deployed app is unchanged.",
    );
  }
}

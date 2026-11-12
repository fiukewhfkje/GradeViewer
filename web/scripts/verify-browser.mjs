import { spawn } from "node:child_process";

// Separate origins, fixture Workers/storage, certificates, browser contexts and
// motion assets keep the stateful functional suite and its SW update isolated.
// Both processes must finish successfully; ordinary test:e2e stays sequential.
const results = await Promise.all(
  ["functional", "motion"].map(
    (group, index) =>
      new Promise((resolve) => {
        const child = spawn(process.execPath, ["tests/e2e.mjs"], {
          stdio: "inherit",
          env: {
            ...process.env,
            GRADEVIEWER_E2E_GROUP: group,
            GRADEVIEWER_E2E_PORT: String(8901 + index),
          },
        });
        child.once("error", () => resolve(false));
        child.once("exit", (code) => resolve(code === 0));
      }),
  ),
);
if (results.some((success) => !success)) process.exitCode = 1;

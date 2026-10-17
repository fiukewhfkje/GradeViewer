/** Wait for the new app shell to finish caching before offering a reload. */
export async function checkForAppUpdate(
  registration: ServiceWorkerRegistration,
) {
  if (registration.waiting) return registration.waiting;
  await registration.update();
  if (registration.waiting) return registration.waiting;
  const worker = registration.installing;
  if (!worker) return undefined;
  await new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timer);
      worker.removeEventListener("statechange", changed);
      error ? reject(error) : resolve();
    };
    const changed = () => {
      if (worker.state === "installed" || worker.state === "activated")
        finish();
      else if (worker.state === "redundant")
        finish(new Error("Update installation failed"));
    };
    const timer = setTimeout(
      () => finish(new Error("Update check timed out")),
      20000,
    );
    worker.addEventListener("statechange", changed);
    changed();
  });
  return registration.waiting ?? undefined;
}

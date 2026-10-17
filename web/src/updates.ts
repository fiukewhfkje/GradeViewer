import { compareVersions, releaseVersion } from "./release";
export interface Installation {
  version: string;
  automation: "installed" | "missing";
  repository?: string;
  channel?: "stable" | "preview";
}
export interface OfficialRelease {
  version: string;
  publishedAt?: string;
}
export function updateMessage(
  current: string,
  deployed: Installation,
  official: OfficialRelease,
  ready: boolean,
  now = Date.now(),
) {
  if (
    ![current, deployed.version, official.version].every((v) =>
      releaseVersion.test(v),
    )
  )
    throw new Error("Invalid update information.");
  if (ready)
    return "Update ready. Save any open changes, then choose Update now.";
  const setup =
    deployed.automation === "missing"
      ? " Automatic updates need a one-time setup repair. See the setup guide."
      : "";
  if (deployed.version !== current)
    return (
      "Your website has changed, but the app update could not finish caching. Retry when online." +
      setup
    );
  if (compareVersions(official.version, current) > 0) {
    const age = official.publishedAt
      ? now - Date.parse(official.publishedAt)
      : 0;
    if (age > 48 * 3600000)
      return (
        `Update stalled: ${official.version} has not reached your website. Automatic updates may be paused or the Cloudflare build may have failed. Your saved data is retained.` +
        setup
      );
    return (
      `Update available: ${official.version}.` +
      (setup ||
        " Your copy checks automatically at midnight Eastern; deployment can take a little longer.")
    );
  }
  return "You’re up to date." + setup;
}
export async function readInstallation(): Promise<Installation> {
  const response = await fetch("/installation.json", {
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("Deployment information unavailable.");
  const value = (await response.json()) as Installation;
  if (
    !value ||
    !releaseVersion.test(value.version) ||
    !["installed", "missing"].includes(value.automation)
  )
    throw new Error("Deployment information unavailable.");
  return value;
}
export async function activateAppUpdate(
  worker: ServiceWorker,
  reload: () => void,
) {
  if (worker.state === "activated") {
    reload();
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timer);
      worker.removeEventListener("statechange", changed);
      error ? reject(error) : resolve();
    };
    const changed = () => {
      if (worker.state === "activated") finish();
      if (worker.state === "redundant")
        finish(new Error("Update activation failed."));
    };
    const timer = setTimeout(
      () => finish(new Error("Update activation timed out.")),
      20000,
    );
    worker.addEventListener("statechange", changed);
    worker.postMessage({ type: "ACTIVATE" });
    changed();
  });
  reload();
}
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

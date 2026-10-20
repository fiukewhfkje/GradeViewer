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
  container = typeof navigator !== "undefined"
    ? navigator.serviceWorker
    : undefined,
) {
  if (worker.state !== "activated")
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
  // Activation can finish before clients.claim(). Reloading earlier can serve
  // the previous cached page and leave the user looking at the same update.
  if (container && container.controller !== worker)
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer);
        container.removeEventListener("controllerchange", changed);
        error ? reject(error) : resolve();
      };
      const changed = () => {
        if (container.controller === worker) finish();
      };
      const timer = setTimeout(
        () => finish(new Error("Update takeover timed out.")),
        20000,
      );
      container.addEventListener("controllerchange", changed);
      changed();
    });
  reload();
}
/** Compare content identity, including same-version deployments and rollbacks. */
export async function isNewAppShell(worker: ServiceWorker) {
  if (!["installed", "activating", "activated"].includes(worker.state))
    return false;
  const current = document.querySelector<HTMLMetaElement>(
    'meta[name="gradeviewer-build"]',
  )?.content;
  if (!current) return true;
  return new Promise<boolean>((resolve) => {
    const channel = new MessageChannel();
    const finish = (changed: boolean) => {
      clearTimeout(timer);
      channel.port1.close();
      channel.port2.close();
      resolve(changed);
    };
    const timer = setTimeout(() => finish(false), 3000);
    channel.port1.onmessage = (event) =>
      finish(
        typeof event.data?.build === "string" && event.data.build !== current,
      );
    worker.postMessage({ type: "SHELL_INFO" }, [channel.port2]);
  });
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

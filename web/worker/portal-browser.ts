import { observedCampusPortal } from "./campus-url";
import { ApiError } from "./provider";
import type {
  BrowserWorker,
  Browser,
  BrowserContext,
} from "@cloudflare/playwright";
export type PortalBinding = BrowserWorker &
  Pick<BrowserRun, "acquire" | "closeSession" | "getLiveView">;
export interface BrowserState {
  cookies: {
    name: string;
    value: string;
    domain: string;
    path: string;
    expires: number;
    httpOnly: boolean;
    secure: boolean;
    sameSite: "Strict" | "Lax" | "None";
  }[];
  origins: {
    origin: string;
    localStorage: { name: string; value: string }[];
  }[];
}
export interface PortalBrowser {
  id: string;
  state(): Promise<BrowserState>;
  live(): Promise<string>;
  navigate(
    url: string,
    waitUntil?: "commit" | "domcontentloaded",
  ): Promise<void>;
  url(): string;
  studentPortal?(): Promise<string | undefined>;
  close(): Promise<void>;
}
export async function portalBrowser(
  binding: PortalBinding,
  saved?: BrowserState,
  session?: string,
  onEntry?: (url: string) => void,
  onStudentPortal?: (url: string, sessionID: string) => void,
): Promise<PortalBrowser> {
  const sdk = await import("@cloudflare/playwright");
  let browser: Browser | undefined;
  let sessionID = session;
  let acquisitionExpired = false;
  async function bounded<T>(task: Promise<T>, ms = 15_000): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        task,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new ApiError(502, "browserUnavailable")),
            ms,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  try {
    if (!sessionID) {
      const acquisition = binding.acquire({ keepAlive: 240_000 });
      void acquisition.then(
        (result) => {
          if (acquisitionExpired)
            void binding.closeSession(result.sessionId).catch(() => {});
        },
        () => {},
      );
      try {
        sessionID = (await bounded(acquisition)).sessionId;
      } catch (error) {
        acquisitionExpired = true;
        throw error;
      }
    }
    // Cloudflare's default nonpersistent CDP connections isolate contexts. The
    // sign-in window and finish request must attach to the same default context.
    const endpoint = new URL(
      sdk.endpointURLString(binding, { sessionId: sessionID }),
    );
    endpoint.searchParams.set("persistent", "true");
    browser = await bounded(sdk.connect(endpoint));
    // Each connection owns a separate Chrome process. Use its default context so a
    // later CDP connection captures the exact context the human signed into.
    const context: BrowserContext =
      browser.contexts()[0] ??
      (await browser.newContext({ viewport: { width: 390, height: 844 } }));
    if (!session && saved) {
      await context.addCookies(saved.cookies);
      await context.addInitScript((origins) => {
        const own = origins.find((x) => x.origin === location.origin);
        for (const item of own?.localStorage ?? [])
          localStorage.setItem(item.name, item.value);
      }, saved.origins);
    }
    const page = context.pages()[0] ?? (await context.newPage());
    let selectedPortal: string | undefined;
    const observe = (url: string) => {
      const portal = observedCampusPortal(url);
      if (!portal) return;
      if (portal !== selectedPortal) {
        selectedPortal = portal;
        if (sessionID) onStudentPortal?.(portal, sessionID);
      }
      const u = new URL(url);
      if (!/^\/campus\/SSO\//.test(u.pathname)) return;
      const config = u.searchParams.get("configID");
      u.search = "";
      u.hash = "";
      if (config && /^\d+$/.test(config))
        u.searchParams.set("configID", config);
      onEntry?.(u.href);
    };
    const watch = (open: typeof page) => {
      open.on("framenavigated", (frame) => {
        if (!frame.parentFrame()) observe(frame.url());
      });
    };
    // Requests also see a Student link that redirects before it commits a document.
    context.on("request", (request) => {
      if (!request.isNavigationRequest()) return;
      try {
        if (!request.frame().parentFrame()) observe(request.url());
      } catch {
        /* Popup navigation can precede creation of its frame. */
      }
    });
    for (const open of context.pages()) watch(open);
    context.on("page", watch);
    return {
      id: browser.sessionId(),
      state: () => context.storageState(),
      live: async () => {
        const result = await bounded(
          binding.getLiveView(sessionID!, {
            mode: "full",
            expiresInMs: 300_000,
          }),
        );
        const u = new URL(result.devtoolsFrontendUrl);
        if (u.protocol !== "https:" || u.hostname !== "live.browser.run")
          throw new Error("browserUnavailable");
        return u.href;
      },
      navigate: async (url, waitUntil = "domcontentloaded") => {
        await page.goto(url, {
          waitUntil,
          timeout: 20_000,
        });
      },
      url: () => page.url(),
      studentPortal: async () =>
        [...context.pages()]
          .reverse()
          .map((p) => observedCampusPortal(p.url()))
          .find(Boolean) ?? selectedPortal,
      close: async () => {
        await bounded(binding.closeSession(sessionID!));
      },
    };
  } catch (error) {
    if (sessionID) await binding.closeSession(sessionID).catch(() => {});
    if (
      /429|rate limit|time limit exceeded/i.test(
        String(error instanceof Error ? error.message : ""),
      )
    )
      throw new ApiError(429, "portalBrowserBudget", 3600);
    throw new ApiError(502, "browserUnavailable");
  }
}

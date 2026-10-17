import { officialRelease, upstream } from "../src/release";

// This runs in the installation's own Worker. It has no credentials and never
// forwards the visitor's headers or Schoology session to GitHub.
export function releaseReader(
  upstreamFetch: typeof fetch = fetch,
  now = () => Date.now(),
) {
  let cached: { value: unknown; until: number } | undefined;
  let flight: Promise<unknown> | undefined;
  return async () => {
    if (cached && cached.until > now()) return cached.value;
    if (flight) return flight;
    flight = (async () => {
      const response = await upstreamFetch(
        `https://api.github.com/repos/${upstream}/releases/latest`,
        {
          headers: {
            Accept: "application/vnd.github+json",
            "User-Agent": "GradeViewer-update-check",
          },
          signal: AbortSignal.timeout(10000),
        },
      );
      if (!response.ok) throw new Error("Release check unavailable.");
      const text = await response.text();
      if (text.length > 1000000) throw new Error("Release response too large.");
      const value = officialRelease(JSON.parse(text));
      cached = { value, until: now() + 15 * 60000 };
      return value;
    })();
    try {
      return await flight;
    } finally {
      flight = undefined;
    }
  };
}
export const latestRelease = releaseReader();

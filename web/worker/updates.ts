import { releaseVersion, upstream } from "../src/release";

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
        `https://github.com/${upstream}/releases/latest/download/manifest.json`,
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
      const manifest = JSON.parse(text);
      if (
        manifest.schema !== 2 ||
        manifest.verification !== "github-attestation" ||
        manifest.localSchema !== 1 ||
        !releaseVersion.test(manifest.version) ||
        manifest.version.includes("-") ||
        !/^[a-f0-9]{40}$/.test(manifest.sourceCommit) ||
        !/^[a-f0-9]{64}$/.test(manifest.archiveSha256) ||
        manifest.archive !== "gradeviewer-source.json"
      )
        throw new Error("Invalid official release manifest.");
      const modified = response.headers.get("Last-Modified");
      const value = {
        version: manifest.version,
        publishedAt:
          modified && Number.isFinite(Date.parse(modified))
            ? new Date(modified).toISOString()
            : undefined,
      };
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

import { expect, it, vi } from "vitest";
import { releaseReader } from "../worker/updates";
import { compareVersions, officialRelease } from "../src/release";
it("compares stable and opt-in preview versions numerically", () => {
  expect(compareVersions("0.10.0", "0.9.9")).toBe(1);
  expect(compareVersions("0.2.0", "0.2.0-rc.9")).toBe(1);
  expect(compareVersions("0.2.0-beta.10", "0.2.0-beta.2")).toBe(1);
  expect(() =>
    officialRelease({
      tag_name: "v0.2.0-rc.1",
      draft: false,
      prerelease: true,
    }),
  ).toThrow();
  expect(
    officialRelease(
      { tag_name: "v0.2.0-rc.1", draft: false, prerelease: true },
      "preview",
    ).version,
  ).toBe("0.2.0-rc.1");
});
const manifest = {
  schema: 2,
  verification: "github-attestation",
  localSchema: 1,
  version: "0.1.3",
  sourceCommit: "a".repeat(40),
  archive: "gradeviewer-source.json",
  archiveSha256: "b".repeat(64),
};
it("coalesces and caches validated official metadata, using only a fixed credential-free request", async () => {
  let clock = 0;
  const fetcher = vi.fn(
    async (url: RequestInfo | URL, options?: RequestInit) => {
      expect(url).toBe(
        "https://github.com/fiukewhfkje/GradeViewer/releases/latest/download/manifest.json",
      );
      expect(new Headers(options?.headers).has("Authorization")).toBe(false);
      expect(new Headers(options?.headers).has("Cookie")).toBe(false);
      return Response.json(manifest, {
        headers: { "Last-Modified": "Sat, 17 Oct 2026 04:00:00 GMT" },
      });
    },
  );
  const read = releaseReader(fetcher as typeof fetch, () => clock);
  expect(await Promise.all([read(), read()])).toEqual([
    expect.objectContaining({ publishedAt: "2026-10-17T04:00:00.000Z" }),
    expect.anything(),
  ]);
  await read();
  expect(fetcher).toHaveBeenCalledOnce();
  clock = 16 * 60000;
  await read();
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it("never presents failed or malformed release checks as current", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({}, { status: 403 }))
    .mockResolvedValueOnce(Response.json({}))
    .mockResolvedValueOnce(Response.json(manifest));
  const read = releaseReader(fetcher);
  await expect(read()).rejects.toThrow();
  await expect(read()).rejects.toThrow();
  await expect(read()).resolves.toMatchObject({ version: "0.1.3" });
});
it("checks stable releases successfully when the public REST API is throttled", async () => {
  const fetcher = vi.fn(async (url: RequestInfo | URL) =>
    String(url).startsWith("https://api.github.com/")
      ? Response.json({}, { status: 429 })
      : Response.json(manifest),
  );
  await expect(releaseReader(fetcher as typeof fetch)()).resolves.toMatchObject(
    { version: "0.1.3" },
  );
  expect(fetcher).toHaveBeenCalledWith(
    "https://github.com/fiukewhfkje/GradeViewer/releases/latest/download/manifest.json",
    expect.anything(),
  );
});

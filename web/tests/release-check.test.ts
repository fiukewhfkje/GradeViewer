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
it("coalesces and caches validated official metadata, using only a fixed credential-free request", async () => {
  let clock = 0;
  const fetcher = vi.fn(
    async (url: RequestInfo | URL, options?: RequestInit) => {
      expect(url).toBe(
        "https://api.github.com/repos/fiukewhfkje/GradeViewer/releases/latest",
      );
      expect(new Headers(options?.headers).has("Authorization")).toBe(false);
      expect(new Headers(options?.headers).has("Cookie")).toBe(false);
      return Response.json({
        tag_name: "v0.1.3",
        draft: false,
        prerelease: false,
      });
    },
  );
  const read = releaseReader(fetcher as typeof fetch, () => clock);
  await Promise.all([read(), read()]);
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
    .mockResolvedValueOnce(
      Response.json({ tag_name: "v0.1.3", draft: false, prerelease: false }),
    );
  const read = releaseReader(fetcher);
  await expect(read()).rejects.toThrow();
  await expect(read()).rejects.toThrow();
  await expect(read()).resolves.toMatchObject({ version: "0.1.3" });
});

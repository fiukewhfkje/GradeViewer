export const upstream = "fiukewhfkje/GradeViewer";
export const releaseVersion =
  /^0\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(alpha|beta|rc)\.(0|[1-9]\d*))?$/;
export type ReleaseChannel = "stable" | "preview";
export function compareVersions(a: string, b: string): number {
  if (!releaseVersion.test(a) || !releaseVersion.test(b))
    throw new Error("Unsupported release version.");
  const parts = (v: string) => {
    const [main, pre] = v.split("-");
    const [label, number] = pre?.split(".") ?? [];
    return [
      ...main.split(".").map(Number),
      label ? ["alpha", "beta", "rc"].indexOf(label) : 3,
      Number(number ?? 0),
    ];
  };
  const x = parts(a),
    y = parts(b);
  for (let i = 0; i < x.length; i++)
    if (x[i] !== y[i]) return Math.sign(x[i] - y[i]);
  return 0;
}
export function officialRelease(
  value: unknown,
  channel: ReleaseChannel = "stable",
) {
  const r = value as Record<string, unknown> | null;
  if (!r || r.draft !== false || typeof r.tag_name !== "string")
    throw new Error("Invalid official release response.");
  const version = r.tag_name.replace(/^v/, "");
  if (
    r.tag_name !== "v" + version ||
    !releaseVersion.test(version) ||
    typeof r.prerelease !== "boolean" ||
    r.prerelease !== version.includes("-") ||
    (channel === "stable" && r.prerelease)
  )
    throw new Error("Unexpected release channel.");
  return {
    version,
    publishedAt:
      typeof r.published_at === "string" &&
      Number.isFinite(Date.parse(r.published_at))
        ? r.published_at
        : undefined,
  };
}

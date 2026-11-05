// Owner-only operator utility. The capability reads sanitized diagnostics only.
import { readFile, lstat, realpath } from "node:fs/promises";
import { resolve, relative, sep, isAbsolute } from "node:path";
const [url, file] = process.argv.slice(2);
try {
  const target = new URL(url);
  if (
    target.protocol !== "https:" ||
    !/^[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev$/.test(target.hostname) ||
    target.pathname !== "/" ||
    target.search ||
    target.hash ||
    target.username ||
    target.password
  )
    throw new Error();
  const info = await lstat(resolve(file));
  const project = await realpath(new URL("../", import.meta.url));
  const path = await realpath(resolve(file));
  const location = relative(project, path);
  if (
    !info.isFile() ||
    (info.mode & 0o077) !== 0 ||
    (process.getuid && info.uid !== process.getuid()) ||
    !(
      location === ".." ||
      location.startsWith(".." + sep) ||
      isAbsolute(location)
    )
  )
    throw new Error();
  const key = (await readFile(path, "utf8")).trim();
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error();
  const response = await fetch(new URL("api/carmen/diagnostics", target), {
    headers: { Authorization: "Bearer " + key },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error();
  const body = await response.json();
  if (!("diagnostics" in body)) throw new Error();
  console.log(JSON.stringify(body, null, 2));
} catch {
  console.error(
    "Could not read Carmen diagnostics. Check the Worker URL and private operator key; no provider request was made.",
  );
  process.exitCode = 1;
}

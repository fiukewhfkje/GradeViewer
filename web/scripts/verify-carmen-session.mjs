// Opt-in local diagnostic only. No application/vault changes and no provider writes.
// Keep credentials and responses in memory; print fixed labels/booleans/status only.
import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const origin = "https://osu.instructure.com";
const ownPath = fileURLToPath(import.meta.url);
const failure = (code, status) =>
  Object.assign(new Error(code), { code, status });
const validID = (value) =>
  typeof value === "number"
    ? Number.isSafeInteger(value) && value > 0
    : typeof value === "string" && /^[1-9]\d{0,19}$/.test(value);

export function outsideDirectory(root, actual) {
  const location = relative(root, actual);
  return (
    location === ".." || location.startsWith("../") || isAbsolute(location)
  );
}

export function parseCookieHeader(input) {
  const header = input.trim().replace(/^cookie:\s*/i, "");
  if (!header || header.length > 65536 || /[^\x20-\x7e]/.test(header))
    throw failure("invalidCookieFile");
  const seen = new Set();
  for (const part of header.split(";")) {
    const match = part.trim().match(/^([!#$%&'*+.^_`|~0-9A-Za-z-]+)=(.*)$/);
    if (
      !match ||
      /^(domain|path|expires|max-age|secure|httponly|samesite)$/i.test(
        match[1],
      ) ||
      seen.has(match[1])
    )
      throw failure("invalidCookieFile");
    const value = match[2].replace(/^"(.*)"$/, "$1");
    if (/[^\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]/.test(value))
      throw failure("invalidCookieFile");
    seen.add(match[1]);
  }
  return header;
}

export async function readPrivateCookieFile(path) {
  if (!isAbsolute(path)) throw failure("absolutePrivateFileRequired");
  const actual = await realpath(path);
  // Check the Git root when present; an isolated web template uses its own root.
  const appRoot = resolve(dirname(ownPath), "..");
  let protectedRoot = appRoot;
  for (
    let parent = appRoot;
    dirname(parent) !== parent;
    parent = dirname(parent)
  ) {
    try {
      await realpath(resolve(parent, ".git"));
      protectedRoot = parent;
      break;
    } catch {
      /* No Git metadata at this parent. */
    }
  }
  if (!outsideDirectory(await realpath(protectedRoot), actual))
    throw failure("cookieFileMustBeOutsideProject");
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (
      !info.isFile() ||
      info.size > 65536 ||
      (info.mode & 0o077) !== 0 ||
      (process.getuid && info.uid !== process.getuid())
    )
      throw failure("privateOwnerOnlyFileRequired");
    return parseCookieHeader(await file.readFile("utf8"));
  } finally {
    await file.close();
  }
}

export async function probeCarmen({
  cookie,
  consent = false,
  grades = false,
  timing = false,
  managedCookies = false,
  expectedIdentity,
  onIdentity,
  fetcher = fetch,
  now = () => performance.now(),
}) {
  const report = {
    authenticated: false,
    courseTotalsChecked: false,
    cookieRotationOffered: false,
  };
  if (!consent) return { ...report, error: "accountHolderPermissionRequired" };
  const started = timing ? now() : 0;
  if (timing) report.timingsMs = {};
  let stage = "setup";
  try {
    const header = managedCookies ? undefined : parseCookieHeader(cookie);
    async function read(path) {
      let response;
      try {
        response = await fetcher(origin + path, {
          method: "GET",
          headers: {
            ...(header ? { Cookie: header } : {}),
            Accept: "application/json",
          },
          redirect: "manual",
          signal: AbortSignal.timeout(15000),
        });
      } catch (error) {
        if (error?.code === "responseTooLarge") throw error;
        if (
          [
            "contextClosed",
            "timeout",
            "tls",
            "dns",
            "connection",
            "unclassified",
          ].includes(error?.networkReason)
        )
          report.networkFailure = error.networkReason;
        throw failure("networkUnavailable");
      }
      report.cookieRotationOffered ||= response.headers.has("set-cookie");
      if (!response.ok) {
        if (
          managedCookies &&
          [301, 302, 303, 307, 308].includes(response.status)
        ) {
          try {
            const target = new URL(response.headers.get("location"), origin);
            report.signInRedirect =
              target.protocol === "https:" &&
              !target.username &&
              !target.password &&
              !target.port &&
              (target.hostname === "webauth.service.ohio-state.edu" ||
                (target.origin === origin &&
                  /^\/login(?:\/|$)/.test(target.pathname)));
          } catch {
            report.signInRedirect = false;
          }
        }
        await response.body?.cancel();
        throw failure(
          response.status === 401
            ? "authenticationRejected"
            : response.status === 403
              ? "permissionDenied"
              : response.status >= 300 && response.status < 400
                ? "redirectRequiresReview"
                : response.status === 429
                  ? "rateLimited"
                  : "providerUnavailable",
          response.status,
        );
      }
      if (
        !/\bapplication\/(?:[\w.-]+\+)?json\b/i.test(
          response.headers.get("content-type") ?? "",
        )
      ) {
        await response.body?.cancel();
        throw failure("nonJSONResponse", response.status);
      }
      const reader = response.body?.getReader();
      if (!reader) throw failure("missingBody");
      const chunks = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 2_000_000) {
          await reader.cancel();
          throw failure("responseTooLarge");
        }
        chunks.push(value);
      }
      let data;
      try {
        data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        throw failure("invalidJSON");
      }
      return {
        data,
        morePages: /rel\s*=\s*"?next\b/i.test(
          response.headers.get("link") ?? "",
        ),
      };
    }
    async function get(path) {
      const requestedAt = timing ? now() : 0;
      try {
        return await read(path);
      } finally {
        if (timing)
          report.timingsMs[stage] = Math.max(
            0,
            Math.round(now() - requestedAt),
          );
      }
    }
    stage = "identity";
    const profile = (await get("/api/v1/users/self/profile")).data;
    if (!profile || Array.isArray(profile) || !validID(profile.id))
      throw failure("unverifiedIdentity");
    if (
      expectedIdentity !== undefined &&
      String(profile.id) !== expectedIdentity
    )
      throw failure("accountChanged");
    onIdentity?.(String(profile.id));
    report.authenticated = true;
    if (grades) {
      stage = "courseTotals";
      const { data, morePages } = await get(
        "/api/v1/courses?enrollment_type=student&include[]=total_scores&per_page=100",
      );
      if (
        !Array.isArray(data) ||
        data.some(
          (c) =>
            !c ||
            !validID(c.id) ||
            (c.enrollments != null &&
              (!Array.isArray(c.enrollments) ||
                c.enrollments.some(
                  (e) =>
                    !e ||
                    typeof e !== "object" ||
                    Array.isArray(e) ||
                    ["computed_current_score", "computed_final_score"].some(
                      (name) =>
                        e[name] != null &&
                        (typeof e[name] !== "number" ||
                          !Number.isFinite(e[name])),
                    ) ||
                    ["computed_current_grade", "computed_final_grade"].some(
                      (name) => e[name] != null && typeof e[name] !== "string",
                    ),
                ))),
        )
      )
        throw failure("invalidCourseList");
      report.courseTotalsChecked = true;
      report.courseCount = data.length; // First-page count only; never names/grades.
      report.courseListEmpty = data.length === 0;
      report.courseListHasMorePages = morePages;
      report.scoreFieldsPresent = data.some((c) =>
        c.enrollments?.some((e) =>
          [
            "computed_current_score",
            "computed_final_score",
            "computed_current_grade",
            "computed_final_grade",
          ].some((name) => Object.hasOwn(e, name)),
        ),
      );
      report.visibleTotalsPresent = data.some((c) =>
        c.enrollments?.some(
          (e) =>
            e.type === "student" &&
            [e.computed_current_score, e.computed_current_grade].some(
              (v) => v !== null && v !== undefined && v !== "",
            ),
        ),
      );
    }
    return report;
  } catch (error) {
    const known = new Set([
      "invalidCookieFile",
      "networkUnavailable",
      "authenticationRejected",
      "permissionDenied",
      "redirectRequiresReview",
      "rateLimited",
      "providerUnavailable",
      "nonJSONResponse",
      "missingBody",
      "responseTooLarge",
      "invalidJSON",
      "unverifiedIdentity",
      "accountChanged",
      "invalidCourseList",
    ]);
    return {
      ...report,
      stage,
      error: known.has(error.code) ? error.code : "probeFailed",
      ...(error.status ? { status: error.status } : {}),
    };
  } finally {
    if (timing)
      report.timingsMs.total = Math.max(0, Math.round(now() - started));
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.includes("--consent")) {
    console.log(JSON.stringify({ error: "accountHolderPermissionRequired" }));
    process.exitCode = 1;
    return;
  }
  const paths = args.filter((a) => !a.startsWith("--"));
  if (
    paths.length !== 1 ||
    args.some(
      (a) =>
        a.startsWith("--") &&
        !["--consent", "--grades", "--timing"].includes(a),
    )
  ) {
    console.log(
      JSON.stringify({ error: "useAbsoluteCookieFileWithConsentFlag" }),
    );
    process.exitCode = 1;
    return;
  }
  try {
    const cookie = await readPrivateCookieFile(paths[0]);
    const report = await probeCarmen({
      cookie,
      consent: true,
      grades: args.includes("--grades"),
      timing: args.includes("--timing"),
    });
    console.log(JSON.stringify(report));
    if (report.error) process.exitCode = 1;
  } catch (error) {
    const known = new Set([
      "absolutePrivateFileRequired",
      "cookieFileMustBeOutsideProject",
      "privateOwnerOnlyFileRequired",
      "invalidCookieFile",
    ]);
    console.log(
      JSON.stringify({
        error: known.has(error.code)
          ? error.code
          : "privateCookieFileUnavailable",
      }),
    );
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  (await realpath(resolve(process.argv[1])).catch(() => "")) === ownPath
)
  await main();

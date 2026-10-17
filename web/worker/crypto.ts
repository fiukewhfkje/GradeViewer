const encoder = new TextEncoder();
export const bytes = (s: string) => encoder.encode(s);
export const base64 = (b: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(b)));
const unbase64 = (s: string) =>
  Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const random = () =>
  base64(crypto.getRandomValues(new Uint8Array(32)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
export async function hash(value: string) {
  return base64(await crypto.subtle.digest("SHA-256", bytes(value)));
}
export async function equal(a: string, b: string) {
  const x = await hash(a),
    y = await hash(b);
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return d === 0;
}
export interface Envelope {
  version: 1;
  data: string;
  nonce: string;
  wrapped: string;
  wrapNonce: string;
}
async function root(password: string) {
  return crypto.subtle.importKey(
    "raw",
    await crypto.subtle.digest(
      "SHA-256",
      bytes("GradeViewer vault v1\0" + password),
    ),
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
}
export async function seal(
  value: unknown,
  password: string,
): Promise<Envelope> {
  const dataKey = crypto.getRandomValues(new Uint8Array(32)),
    nonce = crypto.getRandomValues(new Uint8Array(12)),
    wrapNonce = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey("raw", dataKey, "AES-GCM", false, [
    "encrypt",
  ]);
  return {
    version: 1,
    data: base64(
      await crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv: nonce,
          additionalData: bytes("GradeViewer credentials v1"),
        },
        key,
        bytes(JSON.stringify(value)),
      ),
    ),
    nonce: base64(nonce),
    wrapped: base64(
      await crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv: wrapNonce,
          additionalData: bytes("GradeViewer key v1"),
        },
        await root(password),
        dataKey,
      ),
    ),
    wrapNonce: base64(wrapNonce),
  };
}
export async function unseal<T>(e: Envelope, password: string): Promise<T> {
  const keyBytes = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: unbase64(e.wrapNonce),
      additionalData: bytes("GradeViewer key v1"),
    },
    await root(password),
    unbase64(e.wrapped),
  );
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, [
    "decrypt",
  ]);
  return JSON.parse(
    new TextDecoder().decode(
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: unbase64(e.nonce),
          additionalData: bytes("GradeViewer credentials v1"),
        },
        key,
        unbase64(e.data),
      ),
    ),
  );
}
export const encode = (v: string) =>
  encodeURIComponent(v).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
export interface Credentials {
  key: string;
  secret: string;
  account: string;
}
export async function authorization(
  url: URL,
  c: Pick<Credentials, "key" | "secret">,
  nonce = random(),
  timestamp = String(Math.floor(Date.now() / 1000)),
) {
  const params: Record<string, string> = {
    oauth_consumer_key: c.key,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: timestamp,
    oauth_token: "",
    oauth_version: "1.0",
  };
  const pairs = [...url.searchParams.entries(), ...Object.entries(params)]
    .map(([k, v]) => [encode(k), encode(v)])
    .sort(
      (a, b) =>
        a[0].localeCompare(b[0], "en", { sensitivity: "variant" }) ||
        a[1].localeCompare(b[1], "en", { sensitivity: "variant" }),
    );
  // OAuth sorts encoded bytes, independently of the machine's locale.
  pairs.sort((a, b) =>
    a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0,
  );
  const normalized = pairs.map((p) => p.join("=")).join("&"),
    base = ["GET", encode(url.origin + url.pathname), encode(normalized)].join(
      "&",
    );
  const key = await crypto.subtle.importKey(
    "raw",
    bytes(encode(c.secret) + "&"),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  params.oauth_signature = base64(
    await crypto.subtle.sign("HMAC", key, bytes(base)),
  );
  return (
    "OAuth " +
    Object.entries(params)
      .sort()
      .map(([k, v]) => `${encode(k)}="${encode(v)}"`)
      .join(", ")
  );
}

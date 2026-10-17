import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { installationInfo } from "./installation.mjs";
const pkg = JSON.parse(await readFile("package.json", "utf8"));
await writeFile(
  "dist/installation.json",
  JSON.stringify({ version: pkg.version, ...(await installationInfo()) }),
);
const assets = [
  "/",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
  ...(await readdir("dist/assets")).map((x) => "/assets/" + x),
];
const version = createHash("sha256");
for (const asset of assets)
  version.update(
    await readFile(asset === "/" ? "dist/index.html" : "dist" + asset),
  );
await writeFile(
  "dist/sw.js",
  `const CACHE='gradeviewer-${version.digest("hex").slice(0, 16)}';
const ASSETS=${JSON.stringify(assets)};
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS))));
self.addEventListener('message',event=>{if(event.data?.type==='ACTIVATE')self.skipWaiting();});
self.addEventListener('activate',event=>event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(clients=>clients.length>1?undefined:caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('gradeviewer-')&&key!==CACHE).map(key=>caches.delete(key))))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{const url=new URL(event.request.url);if(event.request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/')||url.search)return;
 if(event.request.mode==='navigate'){event.respondWith(caches.open(CACHE).then(cache=>cache.match('/')).then(saved=>saved||fetch(event.request)));return;}
 if(url.pathname.startsWith('/assets/')||ASSETS.includes(url.pathname))event.respondWith(caches.open(CACHE).then(cache=>cache.match(event.request)).then(saved=>saved||caches.match(event.request)).then(saved=>saved||fetch(event.request)));
});\n`,
);

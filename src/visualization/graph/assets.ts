import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Only the view model and UI modules are servable; nothing else under src/ or dist/. */
const ASSET_PATTERN = /^(model|ui\/[a-z][a-z0-9-]*)\.js$/;

const cache = new Map<string, { mtimeMs: number; code: string }>();

/**
 * Browser modules for the graph page. From a build, the compiled `.js` next
 * to this file is served; from source (tsx), the `.ts` is transpiled with the
 * TypeScript compiler Fehm already depends on. No bundler, no CDN: the page
 * works fully offline.
 */
export function graphAsset(name: string): string | undefined {
  if (!ASSET_PATTERN.test(name)) return undefined;
  return browserModule(join(HERE, name.slice(0, -3)));
}

/**
 * Browser modules of other visualization pages (Feature 3.2+), addressed
 * relative to `src/visualization/`. Only `<page>/ui/*` and the shared DOM
 * helper are servable.
 */
const PAGE_ASSET_PATTERN = /^([a-z][a-z0-9-]*\/ui\/[a-z][a-z0-9-]*|graph\/ui\/dom)\.js$/;

export function pageAsset(name: string): string | undefined {
  if (!PAGE_ASSET_PATTERN.test(name) || name.startsWith("graph/ui/") && name !== "graph/ui/dom.js") return undefined;
  return browserModule(join(dirname(HERE), name.slice(0, -3)));
}

function browserModule(base: string): string | undefined {
  const source = `${base}.ts`;
  if (existsSync(source)) {
    const mtimeMs = statSync(source).mtimeMs;
    const hit = cache.get(source);
    if (hit && hit.mtimeMs === mtimeMs) return hit.code;
    const code = ts.transpileModule(readFileSync(source, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, sourceMap: false },
      fileName: source,
    }).outputText;
    cache.set(source, { mtimeMs, code });
    return code;
  }
  const built = `${base}.js`;
  return existsSync(built) ? readFileSync(built, "utf8") : undefined;
}

/** three.js (MIT), served from the local install — the graph page never reaches a CDN. */
const THREE_ROOT = dirname(dirname(createRequire(import.meta.url).resolve("three")));
const THREE_PATTERN = /^(build\/three\.(module|core)\.js|examples\/jsm\/(postprocessing|shaders)\/[A-Za-z0-9]+\.js)$/;

export function vendorAsset(path: string): string | undefined {
  if (!path.startsWith("three/")) return undefined;
  const rel = path.slice("three/".length);
  if (!THREE_PATTERN.test(rel)) return undefined;
  const file = join(THREE_ROOT, rel);
  return existsSync(file) ? readFileSync(file, "utf8") : undefined;
}

/** Import map letting the browser modules use the `three` / `three/addons/*` specifiers. */
export const IMPORT_MAP = JSON.stringify({
  imports: { three: "/graph/vendor/three/build/three.module.js", "three/addons/": "/graph/vendor/three/examples/jsm/" },
});

/** CSP hash of the inline import map, so `script-src` can stay 'self' otherwise. */
export const IMPORT_MAP_HASH = `sha256-${createHash("sha256").update(IMPORT_MAP).digest("base64")}`;

import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const target = path.join(root, "build/fehm-runtime");
const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const lock = JSON.parse(await readFile(path.join(root, "package-lock.json"), "utf8"));
const pythonMetadata = await readFile(path.join(root, "pyproject.toml"), "utf8");
if (!pythonMetadata.includes(`version = "${pkg.version}"`)) throw new Error("Synchronize package.json and pyproject.toml versions first.");
// Fail on new runtime dependencies until their complete production tree is
// explicitly included; do not silently ship a wheel that works only in checkout.
if (Object.keys(pkg.dependencies).join() !== "typescript") throw new Error("Update Python runtime bundling for changed npm dependencies.");
const ts = JSON.parse(await readFile(path.join(root, "node_modules/typescript/package.json"), "utf8"));
if (ts.version !== lock.packages["node_modules/typescript"].version) throw new Error("Run npm ci to synchronize runtime dependencies.");
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
for (const name of ["dist", "public", "docs", "integrations", "examples", "README.md", "LICENSE", "SECURITY.md"]) {
  await cp(path.join(root, name), path.join(target, name), { recursive: true });
}
for (const name of ["ecc", "gstack", "agency", "memory", "graft"]) {
  await cp(path.join(root, "third_party", name), path.join(target, "third_party", name), { recursive: true });
}
const vendor = "third_party/open-code-review";
const vendorTarget = path.join(target, vendor);
await mkdir(vendorTarget, { recursive: true });
for (const name of ["manifest.json", "LICENSE", "VIEWER_NOTICE", "README.md", "licenses"]) {
  await cp(path.join(root, vendor, name), path.join(vendorTarget, name), { recursive: true });
}
const platform = `${process.platform}-${process.arch}`;
await cp(path.join(root, vendor, "bin", platform), path.join(vendorTarget, "bin", platform), { recursive: true });
await writeFile(path.join(vendorTarget, "platform.json"), JSON.stringify({ platform }));
await cp(path.join(root, "node_modules/typescript"), path.join(target, "node_modules/typescript"), { recursive: true });
await writeFile(path.join(target, "package.json"), JSON.stringify({ name: pkg.name, version: pkg.version, type: "module", dependencies: pkg.dependencies }, null, 2) + "\n");
await writeFile(path.join(target, "THIRD_PARTY_NOTICES.md"), `# Bundled runtime notices\n\nTypeScript ${ts.version}: Apache-2.0. See node_modules/typescript/LICENSE.txt and ThirdPartyNoticeText.txt.\n\nOpen Code Review 1.12.7 is bundled for the wheel platform under Apache-2.0. See third_party/open-code-review/LICENSE, VIEWER_NOTICE and manifest.json.\n\nSelected MIT adaptations from Everything Claude Code, gstack, Agency Agents, Codebase Memory and Graft are included. Original sources, licenses and commit manifests are under third_party/{ecc,gstack,agency,memory,graft}/.\n\nNode.js is supplied separately by the pinned nodejs-wheel-binaries dependency (unofficial distribution); its wheel includes Node's license and third-party notices.\n`);
console.log(`Prepared Fehm ${pkg.version} for uv build. Users need no npm installation.`);

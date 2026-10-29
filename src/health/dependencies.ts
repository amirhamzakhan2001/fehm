import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, posix } from "node:path";
import type { BriefingFacts, Manifest } from "../codebase-briefing/facts.js";
import type { Finding, FindingEvidence } from "../findings/model.js";
import { licensePolicy, type HealthConfig } from "./config.js";
import { makeFinding } from "./rules.js";
import type { Component, DependencyReport, Ecosystem } from "./types.js";

/**
 * Dependency health from manifests and lockfiles: what is installed (direct,
 * transitive, dev), how reproducible installs are, licenses, and duplicate
 * versions. Licenses come only from what a lockfile or an installed
 * package's own manifest declares; anything else is `NOASSERTION`, as in
 * Skylos' SBOM output. Nothing is guessed from a package name.
 *
 * Vulnerabilities need an advisory database; see advisories.ts (opt-in,
 * network).
 */

const ECOSYSTEM: Record<Manifest["kind"], Ecosystem> = { npm: "npm", python: "pypi", cargo: "cargo", go: "golang", maven: "maven", gradle: "maven" };
const NPM_LOCKS = ["package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml", "bun.lock", "bun.lockb"];
const PY_LOCKS = ["poetry.lock", "uv.lock", "Pipfile.lock", "pdm.lock"];

const read = (abs: string): string | undefined => {
  try {
    return statSync(abs).size < 64 * 1024 * 1024 ? readFileSync(abs, "utf8") : undefined;
  } catch {
    return undefined;
  }
};

export function purl(ecosystem: Ecosystem, name: string, version: string): string {
  const v = version ? `@${encodeURIComponent(version)}` : "";
  if (ecosystem === "npm") return `pkg:npm/${name.startsWith("@") ? `%40${name.slice(1)}` : name}${v}`;
  if (ecosystem === "pypi") return `pkg:pypi/${name.toLowerCase().replace(/[_.]+/g, "-")}${v}`;
  if (ecosystem === "maven") {
    const [g, a] = name.includes(":") ? name.split(":") : ["", name];
    return `pkg:maven/${g ? `${g}/` : ""}${a}${v}`;
  }
  return `pkg:${ecosystem}/${name}${v}`;
}

const normPy = (n: string): string => n.toLowerCase().replace(/[_.]+/g, "-");

interface Lock {
  path: string;
  components: Component[];
}

export function analyzeDependencies(root: string, facts: BriefingFacts, config: HealthConfig, unusedDeps: string[]): { report: DependencyReport; findings: Finding[] } {
  const components = new Map<string, Component>();
  const manifests: DependencyReport["manifests"] = [];
  const findings: Finding[] = [];
  const noLock: FindingEvidence[] = [];
  const unpinned: FindingEvidence[] = [];

  for (const m of facts.manifests) {
    const dir = posix.dirname(m.path) === "." ? "" : posix.dirname(m.path);
    const eco = ECOSYSTEM[m.kind];
    const direct = new Map(m.dependencies.map((d) => [eco === "pypi" ? normPy(d.name) : d.name, d]));
    let lock: Lock | undefined;
    const locks = m.kind === "npm" ? NPM_LOCKS : m.kind === "python" ? PY_LOCKS : m.kind === "cargo" ? ["Cargo.lock"] : m.kind === "go" ? ["go.sum"] : [];
    // Workspaces keep one lockfile at the root.
    const lockPath = locks.map((l) => posix.join(dir, l)).find((p) => existsSync(join(root, p))) ?? (dir ? locks.find((l) => existsSync(join(root, l))) : undefined);
    if (lockPath) lock = parseLock(root, lockPath, eco, direct);
    manifests.push({ path: m.path, kind: m.kind, direct: m.dependencies.filter((d) => !d.dev).length, dev: m.dependencies.filter((d) => d.dev).length, ...(lockPath ? { lockfile: lockPath } : {}) });

    const lines = facts.lines(m.path);
    if (m.dependencies.length && !lockPath && locks.length) {
      const app = m.kind !== "cargo" || existsSync(join(root, dir, "src/main.rs"));
      if (app) noLock.push({ type: "config", path: m.path, detail: `${m.kind} manifest with ${m.dependencies.length} dependencies and no ${locks.slice(0, 3).join(" / ")}`, confidence: "verified" });
    }
    for (const d of m.dependencies) {
      const spec = specOf(m.kind, lines[d.line - 1] ?? "", d.name);
      if (spec !== undefined && isUnpinned(m.kind, spec, Boolean(lockPath))) unpinned.push({ type: "dependency", path: m.path, line: d.line, detail: `${d.name}: ${spec === "" ? "no version constraint" : `"${spec}"`}`, confidence: "verified" });
    }
    if (lock) for (const c of lock.components) components.set(`${c.ecosystem}:${c.name}@${c.version}`, c);
    else {
      for (const d of m.dependencies) {
        const version = exactVersion(specOf(m.kind, lines[d.line - 1] ?? "", d.name) ?? "");
        const c: Component = { name: d.name, version, ecosystem: eco, direct: true, dev: d.dev, license: "NOASSERTION", licenseSource: "none", depth: 1, purl: purl(eco, d.name, version) };
        if (eco === "npm") installedLicense(root, dir, c);
        components.set(`${eco}:${d.name}@${version}`, c);
      }
    }
  }

  // Importers of direct dependencies (graph `imports` edges), for "is it actually used".
  const importers = new Map(facts.packages.map((p) => [p.name, facts.runtimeImporters(p).length]));
  for (const c of components.values()) if (c.direct) c.importers = importers.get(c.name) ?? 0;

  const list = [...components.values()].sort((a, b) => Number(b.direct) - Number(a.direct) || a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
  const versions = new Map<string, Set<string>>();
  for (const c of list) versions.set(`${c.ecosystem}:${c.name}`, (versions.get(`${c.ecosystem}:${c.name}`) ?? new Set()).add(c.version));
  const duplicates = [...versions].filter(([, v]) => v.size > 1);
  const licenseCounts = new Map<string, number>();
  for (const c of list) licenseCounts.set(c.license, (licenseCounts.get(c.license) ?? 0) + 1);
  const depths = list.map((c) => c.depth).filter((d): d is number => d !== undefined);

  const report: DependencyReport = {
    manifests,
    components: list,
    counts: { total: list.length, direct: list.filter((c) => c.direct).length, transitive: list.filter((c) => !c.direct).length, dev: list.filter((c) => c.dev).length, duplicates: duplicates.length },
    ...(depths.length ? { maxDepth: Math.max(...depths) } : {}),
    licenses: [...licenseCounts].map(([license, count]) => ({ license, count, policy: licensePolicy(license, config) })).sort((a, b) => b.count - a.count || a.license.localeCompare(b.license)),
    advisories: { status: "not-checked", reason: "Known-vulnerability data needs an advisory database. Run `fehm health --advisories` (queries OSV.dev) to check.", items: [] },
    unused: unusedDeps,
  };

  if (noLock.length) findings.push(makeFinding("dependency/no-lockfile", { id: "dependency:no-lockfile", title: `${noLock.length} ${noLock.length === 1 ? "manifest has" : "manifests have"} no lockfile`, message: "Installs resolve version ranges afresh each time, so two installs of the same commit can differ.", why: "Without a lockfile, builds are not reproducible and a compromised or broken release is picked up silently.", action: "Commit the lockfile your package manager writes (package-lock.json, poetry.lock, Cargo.lock, go.sum …).", confidence: "verified", evidence: noLock }));
  if (unpinned.length) findings.push(makeFinding("dependency/unpinned-version", { id: "dependency:unpinned", title: `${unpinned.length} ${unpinned.length === 1 ? "dependency accepts" : "dependencies accept"} any version`, message: "Wildcard, `latest`, git/URL or missing version constraints.", why: "Any future release, including a breaking or malicious one, is accepted.", action: "Constrain to a version range, and rely on a lockfile for exact versions.", confidence: "verified", evidence: unpinned }));
  const byPolicy = (p: "denied" | "review"): Component[] => list.filter((c) => !c.dev && licensePolicy(c.license, config) === p);
  const denied = byPolicy("denied");
  const review = byPolicy("review");
  const licenseEv = (cs: Component[]): FindingEvidence[] => cs.map((c) => ({ type: "dependency", detail: `${c.name}@${c.version}: ${c.license} (${c.licenseSource === "lockfile" ? "declared in the lockfile" : "declared by the installed package"})${c.direct ? "" : ", transitive"}`, confidence: "verified" }));
  if (denied.length) findings.push(makeFinding("dependency/license-denied", { id: "dependency:license-denied", title: `${denied.length} runtime ${denied.length === 1 ? "dependency has" : "dependencies have"} a denied license`, message: "Denied by the license policy in .fehm/health.json.", why: "The policy says these licenses must not ship with this project.", action: "Replace the dependency, or record an exception with whoever owns license policy.", confidence: "verified", evidence: licenseEv(denied) }));
  if (review.length) findings.push(makeFinding("dependency/license-review", { id: "dependency:license-review", title: `${review.length} runtime ${review.length === 1 ? "dependency has" : "dependencies have"} a license that needs review`, message: `Matches the review list (${config.licenses.review.slice(0, 4).join(", ")}…). This is not a legal finding: whether it matters depends on how the project is distributed.`, why: "Copyleft and source-available licenses can put obligations on how the project is distributed.", action: "Check the obligations with whoever owns license policy; set .fehm/health.json licenses to record the decision.", confidence: "verified", evidence: licenseEv(review) }));
  const unknown = list.filter((c) => !c.dev && c.license === "NOASSERTION");
  if (unknown.length && list.some((c) => c.license !== "NOASSERTION")) findings.push(makeFinding("dependency/license-unknown", { id: "dependency:license-unknown", title: `${unknown.length} runtime ${unknown.length === 1 ? "dependency declares" : "dependencies declare"} no license Fehm could read`, message: "Neither the lockfile nor an installed package manifest states a license (NOASSERTION).", why: "An undeclared license cannot be checked against policy.", action: "Look the license up at the source; install dependencies so their manifests can be read.", confidence: "verified", evidence: unknown.map((c) => ({ type: "dependency" as const, detail: `${c.name}@${c.version}` })) }));
  if (duplicates.length) findings.push(makeFinding("dependency/duplicate-versions", { id: "dependency:duplicates", title: `${duplicates.length} ${duplicates.length === 1 ? "package is" : "packages are"} installed in several versions`, message: duplicates.slice(0, 6).map(([k, v]) => `${k.split(":")[1]} (${[...v].join(", ")})`).join("; ") + (duplicates.length > 6 ? "; …" : ""), why: "Duplicate versions enlarge installs and can mean the same library behaves differently in two places.", action: "Deduplicate (npm dedupe) or align the ranges that pull in the old version.", confidence: "verified", evidence: duplicates.map(([k, v]) => ({ type: "dependency" as const, detail: `${k.split(":")[1]}: ${[...v].join(", ")}` })) }));
  return { report, findings };
}

function specOf(kind: Manifest["kind"], line: string, name: string): string | undefined {
  if (kind === "npm") {
    const m = new RegExp(`"${name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}"\\s*:\\s*"([^"]*)"`).exec(line);
    return m?.[1];
  }
  if (kind === "python") {
    const m = /^[\s"']*([A-Za-z0-9_.\-[\],]+)\s*([^"';#]*)/.exec(line.replace(/^\s*-\s*/, ""));
    if (!m) return undefined;
    return m[2]!.trim().replace(/[",]$/, "").trim();
  }
  return undefined;
}

function isUnpinned(kind: Manifest["kind"], spec: string, hasLock: boolean): boolean {
  if (kind === "npm") return /^(?:\*|x|latest|)$/i.test(spec.trim()) || /^(?:git\+|git:|github:|https?:)/.test(spec);
  if (kind === "python") return !hasLock && spec === "";
  return false;
}

function exactVersion(spec: string): string {
  const m = /(\d+\.\d+(?:\.\d+)?(?:[-+.][\w.]+)?)/.exec(spec);
  return m && /^(?:==|=)?\s*\d/.test(spec.trim()) ? m[1]! : "";
}

function installedLicense(root: string, dir: string, c: Component): void {
  for (const base of [join(root, dir, "node_modules", c.name), join(root, "node_modules", c.name)]) {
    const text = read(join(base, "package.json"));
    if (!text) continue;
    try {
      const pkg = JSON.parse(text) as { license?: unknown; licenses?: { type?: string }[]; version?: string };
      const lic = typeof pkg.license === "string" ? pkg.license : typeof (pkg.license as { type?: unknown })?.type === "string" ? (pkg.license as { type: string }).type : Array.isArray(pkg.licenses) && pkg.licenses[0]?.type ? pkg.licenses.map((l) => l.type).join(" OR ") : undefined;
      if (lic) {
        c.license = lic;
        c.licenseSource = "installed-package";
      }
      if (!c.version && typeof pkg.version === "string") {
        c.version = pkg.version;
        c.purl = purl(c.ecosystem, c.name, c.version);
      }
    } catch {
      /* unreadable manifest: leave NOASSERTION */
    }
    return;
  }
}

type Direct = Map<string, { dev: boolean }>;

function parseLock(root: string, path: string, eco: Ecosystem, direct: Direct): Lock | undefined {
  const text = read(join(root, path));
  if (text === undefined) return undefined;
  const base = posix.basename(path);
  const out: Component[] = [];
  const add = (name: string, version: string, extra: Partial<Component> = {}): void => {
    const key = eco === "pypi" ? normPy(name) : name;
    const d = direct.get(key);
    out.push({ name, version, ecosystem: eco, direct: Boolean(d), dev: extra.dev ?? d?.dev ?? false, license: extra.license ?? "NOASSERTION", licenseSource: extra.license ? "lockfile" : "none", ...(extra.depth !== undefined ? { depth: extra.depth } : d ? { depth: 1 } : {}), purl: purl(eco, name, version) });
  };
  try {
    if (base === "package-lock.json" || base === "npm-shrinkwrap.json") {
      const lock = JSON.parse(text) as { packages?: Record<string, { name?: string; version?: string; license?: string; dev?: boolean; devOptional?: boolean; link?: boolean; dependencies?: Record<string, string>; optionalDependencies?: Record<string, string> }>; dependencies?: Record<string, unknown> };
      if (lock.packages) {
        const pkgs = lock.packages;
        const depth = npmDepths(pkgs);
        for (const [key, p] of Object.entries(pkgs)) {
          if (!key || p.link || !key.includes("node_modules/")) continue;
          const name = p.name ?? key.slice(key.lastIndexOf("node_modules/") + "node_modules/".length);
          const top = key === `node_modules/${name}`;
          const c: Partial<Component> = { dev: Boolean(p.dev || p.devOptional), ...(typeof p.license === "string" ? { license: p.license } : {}), ...(depth.has(key) ? { depth: depth.get(key)! } : {}) };
          add(name, p.version ?? "", c);
          if (!top) out.at(-1)!.direct = false;
        }
      } else if (lock.dependencies) {
        const walk = (deps: Record<string, unknown>, d: number): void => {
          for (const [name, v] of Object.entries(deps)) {
            const dep = v as { version?: string; dev?: boolean; dependencies?: Record<string, unknown> };
            add(name, dep.version ?? "", { dev: Boolean(dep.dev), depth: d });
            if (d > 1) out.at(-1)!.direct = false;
            if (dep.dependencies) walk(dep.dependencies, d + 1);
          }
        };
        walk(lock.dependencies, 1);
      }
    } else if (base === "yarn.lock") {
      let names: string[] = [];
      for (const l of text.split(/\r?\n/)) {
        if (/^\S.*:\s*$/.test(l) && !l.startsWith("#")) names = l.replace(/:\s*$/, "").split(",").map((s) => s.trim().replace(/^"|"$/g, "").replace(/@(?:npm:)?[^@]*$/, ""));
        const v = /^\s+version:?\s+"?([^"\s]+)"?/.exec(l);
        if (v && names[0]) {
          add(names[0], v[1]!);
          names = [];
        }
      }
    } else if (base === "pnpm-lock.yaml") {
      let inPackages = false;
      for (const l of text.split(/\r?\n/)) {
        if (/^packages:\s*$/.test(l)) inPackages = true;
        else if (/^\S/.test(l)) inPackages = false;
        const m = inPackages ? /^ {2}'?\/?((?:@[^/@\s]+\/)?[^@\s/']+)[@/]([^(:'\s]+)/.exec(l) : null;
        if (m) add(m[1]!, m[2]!);
      }
    } else if (base === "Pipfile.lock") {
      const lock = JSON.parse(text) as Record<string, Record<string, { version?: string }>>;
      for (const [section, dev] of [["default", false], ["develop", true]] as const) for (const [name, v] of Object.entries(lock[section] ?? {})) add(name, (v.version ?? "").replace(/^==/, ""), { dev });
    } else if (base === "go.sum") {
      const seen = new Set<string>();
      for (const l of text.split(/\r?\n/)) {
        const m = /^(\S+)\s+(v[^\s/]+)(?:\/go\.mod)?\s/.exec(l);
        if (m && !seen.has(`${m[1]}@${m[2]}`)) {
          seen.add(`${m[1]}@${m[2]}`);
          add(m[1]!, m[2]!);
        }
      }
    } else if (base.endsWith(".lock")) {
      // TOML [[package]] tables: poetry.lock, uv.lock, Cargo.lock, pdm.lock.
      for (const block of text.split(/^\[\[package\]\]\s*$/m).slice(1)) {
        const name = /^name\s*=\s*"([^"]+)"/m.exec(block)?.[1];
        const version = /^version\s*=\s*"([^"]+)"/m.exec(block)?.[1];
        const category = /^category\s*=\s*"([^"]+)"/m.exec(block)?.[1];
        if (name && !/^source\s*=\s*\{\s*(?:editable|virtual)\b/m.test(block)) add(name, version ?? "", category === "dev" ? { dev: true } : {});
      }
    } else return undefined;
  } catch {
    return undefined;
  }
  return { path, components: out };
}

/** Dependency depth per package-lock v2/v3 entry: 1 for the root's own dependencies. */
function npmDepths(pkgs: Record<string, { dependencies?: Record<string, string>; optionalDependencies?: Record<string, string>; devDependencies?: Record<string, string>; peerDependencies?: Record<string, string> }>): Map<string, number> {
  const depth = new Map<string, number>();
  const resolveFrom = (from: string, name: string): string | undefined => {
    let base = from;
    for (;;) {
      const candidate = `${base ? `${base}/` : ""}node_modules/${name}`;
      if (pkgs[candidate]) return candidate;
      if (!base) return undefined;
      const i = base.lastIndexOf("/node_modules/");
      base = i < 0 ? "" : base.slice(0, i);
    }
  };
  const root = pkgs[""] ?? {};
  let frontier: string[] = [];
  for (const name of Object.keys({ ...root.dependencies, ...root.devDependencies, ...root.optionalDependencies })) {
    const k = resolveFrom("", name);
    if (k && !depth.has(k)) {
      depth.set(k, 1);
      frontier.push(k);
    }
  }
  for (let d = 2; frontier.length && d < 100; d += 1) {
    const next: string[] = [];
    for (const from of frontier) {
      const p = pkgs[from] ?? {};
      for (const name of Object.keys({ ...p.dependencies, ...p.optionalDependencies, ...p.peerDependencies })) {
        const k = resolveFrom(from, name);
        if (k && !depth.has(k)) {
          depth.set(k, d);
          next.push(k);
        }
      }
    }
    frontier = next;
  }
  return depth;
}

// ─── SBOM ───────────────────────────────────────────────────────────

export interface SbomSubject {
  name: string;
  version?: string;
  components: Component[];
  toolVersion: string;
  generatedAt: string;
}

/** CycloneDX 1.5 JSON. Licenses Fehm could not read are omitted (CycloneDX has no NOASSERTION). */
export function cycloneDx(s: SbomSubject): unknown {
  return {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    serialNumber: `urn:uuid:${randomUUID()}`,
    version: 1,
    metadata: {
      timestamp: s.generatedAt,
      tools: { components: [{ type: "application", name: "fehm", version: s.toolVersion }] },
      component: { type: "application", "bom-ref": "root", name: s.name, ...(s.version ? { version: s.version } : {}) },
    },
    components: s.components.map((c) => ({
      type: "library",
      "bom-ref": c.purl,
      name: c.name,
      ...(c.version ? { version: c.version } : {}),
      purl: c.purl,
      scope: c.dev ? "optional" : "required",
      ...(c.license !== "NOASSERTION" ? { licenses: /\s(?:AND|OR|WITH)\s/.test(c.license) ? [{ expression: c.license }] : [{ license: { id: c.license } }] } : {}),
    })),
    dependencies: [{ ref: "root", dependsOn: s.components.filter((c) => c.direct).map((c) => c.purl) }],
  };
}

/** SPDX 2.3 JSON. Unknown licenses are NOASSERTION, as the spec intends. */
export function spdx(s: SbomSubject): unknown {
  const id = (i: number): string => `SPDXRef-Package-${i}`;
  return {
    spdxVersion: "SPDX-2.3",
    dataLicense: "CC0-1.0",
    SPDXID: "SPDXRef-DOCUMENT",
    name: `${s.name}-sbom`,
    documentNamespace: `https://spdx.org/spdxdocs/${encodeURIComponent(s.name)}-${randomUUID()}`,
    creationInfo: { created: s.generatedAt.replace(/\.\d+Z$/, "Z"), creators: [`Tool: fehm-${s.toolVersion}`] },
    packages: [
      { SPDXID: "SPDXRef-Package-root", name: s.name, ...(s.version ? { versionInfo: s.version } : {}), downloadLocation: "NOASSERTION", filesAnalyzed: false, licenseConcluded: "NOASSERTION", licenseDeclared: "NOASSERTION" },
      ...s.components.map((c, i) => ({
        SPDXID: id(i + 1),
        name: c.name,
        ...(c.version ? { versionInfo: c.version } : {}),
        downloadLocation: "NOASSERTION",
        filesAnalyzed: false,
        licenseConcluded: "NOASSERTION",
        licenseDeclared: c.license,
        externalRefs: [{ referenceCategory: "PACKAGE-MANAGER", referenceType: "purl", referenceLocator: c.purl }],
      })),
    ],
    relationships: [
      { spdxElementId: "SPDXRef-DOCUMENT", relationshipType: "DESCRIBES", relatedSpdxElement: "SPDXRef-Package-root" },
      ...s.components.flatMap((c, i) => (c.direct ? [{ spdxElementId: "SPDXRef-Package-root", relationshipType: c.dev ? "DEV_DEPENDENCY_OF" : "DEPENDS_ON", relatedSpdxElement: id(i + 1) }] : [])).map((r) => (r.relationshipType === "DEV_DEPENDENCY_OF" ? { spdxElementId: r.relatedSpdxElement, relationshipType: r.relationshipType, relatedSpdxElement: r.spdxElementId } : r)),
    ],
  };
}

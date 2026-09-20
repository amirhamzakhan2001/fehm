import path from "node:path";
import type {
  CodeGraph,
  DeadCodeFinding,
  DeadCodeReport,
  DependencyRiskRecord,
  DependencyRiskReport,
  HistoricalBugCommit,
  HistoricalBugHotspot,
  HistoricalBugReport,
  RiskLevel,
} from "./model.js";
import { collectGitHistory } from "./intelligence.js";
import { readRepositoryArtifacts } from "./repository-artifacts.js";
import { detectEntryPoints } from "./system-map.js";

interface PackageManifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  main?: string;
  module?: string;
  bin?: string | Record<string, string>;
  exports?: unknown;
}

interface LockMetadata {
  version?: string;
  deprecated?: string;
  hasInstallScript?: boolean;
}

function severity(score: number): RiskLevel {
  if (score >= 80) return "critical";
  if (score >= 50) return "high";
  if (score >= 25) return "medium";
  return "low";
}

function packageName(specifier: string): string {
  if (specifier.startsWith("@")) return specifier.split("/").slice(0, 2).join("/");
  return specifier.split("/")[0] ?? specifier;
}

function packageLockMetadata(contents: string[]): Map<string, LockMetadata> {
  const result = new Map<string, LockMetadata>();
  for (const content of contents) {
    try {
      const parsed = JSON.parse(content) as { packages?: Record<string, LockMetadata>; dependencies?: Record<string, LockMetadata> };
      for (const [location, metadata] of Object.entries(parsed.packages ?? {})) {
        const marker = "node_modules/";
        const offset = location.lastIndexOf(marker);
        if (offset < 0) continue;
        const name = location.slice(offset + marker.length);
        if (name && !name.includes("node_modules/")) result.set(name, metadata);
      }
      for (const [name, metadata] of Object.entries(parsed.dependencies ?? {})) if (!result.has(name)) result.set(name, metadata);
    } catch { /* non-JSON lockfile */ }
  }
  return result;
}

function lockMentions(name: string, lockContents: string[]): boolean {
  return lockContents.some((content) => content.includes(`node_modules/${name}`)
    || content.includes(`"${name}"`)
    || content.includes(`${name}@`)
    || content.includes(`/${name}/`));
}

function dependencyRisk(
  base: Omit<DependencyRiskRecord, "riskScore" | "severity" | "reasons" | "evidence" | "locked" | "resolvedVersion">,
  lockfiles: string[],
  lockContents: string[],
  lockMetadata: Map<string, LockMetadata>,
): DependencyRiskRecord {
  const metadata = lockMetadata.get(base.name);
  const locked = lockfiles.length > 0 && (Boolean(metadata) || lockMentions(base.name, lockContents));
  const reasons: string[] = [];
  const evidence = [`${base.manifest}: ${base.kind} dependency ${base.name}@${base.requestedVersion}`, ...base.usedBy.slice(0, 10).map((file) => `imported by ${file}`)];
  let score = 0;
  if (base.kind === "undeclared") { score += 70; reasons.push("imported package is not declared in a discovered manifest"); }
  if (/^(?:\*|latest|next|x)$/i.test(base.requestedVersion)) { score += 45; reasons.push("version is floating or unconstrained"); }
  else if (/^(?:git(?:\+|:)|https?:)/i.test(base.requestedVersion)) { score += 50; reasons.push("dependency resolves directly from a remote source"); }
  else if (/^(?:file:|link:)/i.test(base.requestedVersion)) { score += 20; reasons.push("local path dependency may not reproduce outside this workspace"); }
  else if (/^[~^><=]|\s\|\||\s-\s/.test(base.requestedVersion)) { score += 12; reasons.push("version range permits resolution drift"); }
  if (!locked && base.kind !== "peer" && base.kind !== "undeclared") { score += 30; reasons.push(lockfiles.length ? "dependency is absent from discovered lockfiles" : "repository has no discovered lockfile"); }
  if (metadata?.deprecated) { score += 45; reasons.push(`locked package is deprecated: ${metadata.deprecated}`); evidence.push(`lockfile deprecated metadata: ${metadata.deprecated}`); }
  if (metadata?.hasInstallScript) { score += 15; reasons.push("locked package declares an install script"); evidence.push("lockfile hasInstallScript=true"); }
  if (!base.usedBy.length && base.kind === "runtime") { score += 18; reasons.push("runtime dependency has no indexed import"); }
  if (!base.usedBy.length && base.kind === "development") reasons.push("development dependency has no indexed import; it may be command-only tooling");
  if (base.usedBy.length && base.kind === "development" && base.usedBy.some((file) => !/(?:^|\/)(?:test|tests|__tests__)(?:\/|$)|\.(?:test|spec)\./.test(file))) {
    score += 25; reasons.push("development dependency is imported by production code");
  }
  score = Math.min(100, score);
  return { ...base, locked, ...(metadata?.version ? { resolvedVersion: metadata.version } : {}), riskScore: score, severity: severity(score), reasons, evidence };
}

export async function buildDependencyRiskIntelligence(graph: CodeGraph): Promise<DependencyRiskReport> {
  const [manifests, locks] = await Promise.all([
    readRepositoryArtifacts(graph.repository.root, (_relative, basename) => basename === "package.json"),
    readRepositoryArtifacts(graph.repository.root, (_relative, basename) => ["package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock"].includes(basename), 8 * 1024 * 1024),
  ]);
  const usedBy = new Map<string, Set<string>>();
  for (const edge of graph.edges) {
    if (edge.kind !== "imports" || !edge.target.startsWith("package:")) continue;
    const source = graph.nodes.find((node) => node.id === edge.source);
    const name = packageName(edge.target.slice("package:".length));
    if (!usedBy.has(name)) usedBy.set(name, new Set());
    if (source?.path) usedBy.get(name)?.add(source.path);
  }
  const lockfiles = locks.map((item) => item.path).sort();
  const lockContents = locks.map((item) => item.content);
  const metadata = packageLockMetadata(lockContents);
  const dependencies: DependencyRiskRecord[] = [];
  const declared = new Set<string>();
  const sections: Array<[keyof PackageManifest, DependencyRiskRecord["kind"]]> = [
    ["dependencies", "runtime"], ["devDependencies", "development"], ["peerDependencies", "peer"], ["optionalDependencies", "optional"],
  ];
  for (const artifact of manifests) {
    let manifest: PackageManifest;
    try { manifest = JSON.parse(artifact.content) as PackageManifest; } catch { continue; }
    for (const [section, kind] of sections) for (const [name, requestedVersion] of Object.entries(manifest[section] as Record<string, string> | undefined ?? {})) {
      declared.add(name);
      dependencies.push(dependencyRisk({ name, requestedVersion, manifest: artifact.path, kind, usedBy: [...(usedBy.get(name) ?? [])].sort() }, lockfiles, lockContents, metadata));
    }
  }
  for (const [name, files] of usedBy) if (!declared.has(name) && !name.startsWith("node:")) {
    dependencies.push(dependencyRisk({ name, requestedVersion: "undeclared", manifest: "<none>", kind: "undeclared", usedBy: [...files].sort() }, lockfiles, lockContents, metadata));
  }
  dependencies.sort((left, right) => right.riskScore - left.riskScore || left.name.localeCompare(right.name) || left.manifest.localeCompare(right.manifest));
  return {
    generatedAt: new Date().toISOString(), repositoryFingerprint: graph.repository.fingerprint, lockfiles, dependencies,
    summary: {
      total: dependencies.length,
      used: dependencies.filter((item) => item.usedBy.length > 0).length,
      unused: dependencies.filter((item) => item.usedBy.length === 0 && item.kind !== "undeclared").length,
      undeclared: dependencies.filter((item) => item.kind === "undeclared").length,
      highRisk: dependencies.filter((item) => item.severity === "high").length,
      criticalRisk: dependencies.filter((item) => item.severity === "critical").length,
    },
  };
}

function exportedPaths(value: unknown, paths: string[]): void {
  if (typeof value === "string") { paths.push(value); return; }
  if (!value || typeof value !== "object") return;
  for (const nested of Object.values(value as Record<string, unknown>)) exportedPaths(nested, paths);
}

function matchesSourcePath(configured: string, sourcePath: string): boolean {
  const clean = configured.replace(/^\.\//, "").replace(/\\/g, "/");
  if (clean === sourcePath) return true;
  const configuredStem = clean.replace(/^(?:dist|build|lib)\//, "").replace(/\.[^.]+$/, "");
  const sourceStem = sourcePath.replace(/^src\//, "").replace(/\.[^.]+$/, "");
  return configuredStem === sourceStem;
}

export async function buildDeadCodeIntelligence(graph: CodeGraph): Promise<DeadCodeReport> {
  const [entryPoints, manifests] = await Promise.all([
    detectEntryPoints(graph),
    readRepositoryArtifacts(graph.repository.root, (_relative, basename) => basename === "package.json"),
  ]);
  const configuredEntries: string[] = [];
  for (const artifact of manifests) {
    try {
      const manifest = JSON.parse(artifact.content) as PackageManifest;
      if (manifest.main) configuredEntries.push(manifest.main);
      if (manifest.module) configuredEntries.push(manifest.module);
      if (typeof manifest.bin === "string") configuredEntries.push(manifest.bin);
      else if (manifest.bin) configuredEntries.push(...Object.values(manifest.bin));
      exportedPaths(manifest.exports, configuredEntries);
    } catch { /* malformed optional manifest */ }
  }
  const entryPaths = new Set(entryPoints.map((entry) => entry.path));
  for (const file of graph.nodes.filter((node) => node.kind === "file" && node.path)) {
    if (configuredEntries.some((configured) => matchesSourcePath(configured, file.path as string))) entryPaths.add(file.path as string);
    if (/(?:^|\/)src\/index\.[cm]?[jt]sx?$/.test(file.path as string)) entryPaths.add(file.path as string);
  }
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const incoming = new Map<string, typeof graph.edges>();
  for (const edge of graph.edges) {
    if (!["imports", "calls", "references", "uses", "extends", "implements"].includes(edge.kind)) continue;
    if (!incoming.has(edge.target)) incoming.set(edge.target, []);
    incoming.get(edge.target)?.push(edge);
  }
  const findings: DeadCodeFinding[] = [];
  for (const file of graph.nodes.filter((node) => node.kind === "file" && node.path && !node.test)) {
    const edges = (incoming.get(file.id) ?? []).filter((edge) => edge.kind === "imports");
    const isEntry = entryPaths.has(file.path as string) || /(?:^|\/)(?:vite|webpack|rollup|eslint|jest|vitest|playwright|next)\.config\./.test(file.path as string);
    if (!edges.length && !isEntry && !/\.d\.[cm]?ts$/.test(file.path as string)) findings.push({
      kind: "unreachable-file", node: file, confidence: 0.86, severity: "medium", incomingReferences: 0,
      reasons: ["no indexed file imports this module", "module is not a detected runtime, route, CLI, package, or framework entry point"],
      evidence: [`${file.path}: zero incoming import edges`, `${entryPaths.size} repository entry point(s) evaluated`],
      recommendation: "Confirm dynamic or external consumers, then remove the file or expose it through a declared entry point.",
    });
  }
  const candidateKinds = new Set(["function", "class", "variable", "interface", "type"]);
  for (const node of graph.nodes) {
    if (!candidateKinds.has(node.kind) || !node.path || node.test || entryPaths.has(node.path)) continue;
    if (/^(?:default|constructor|handler|main)$/i.test(node.name)) continue;
    const edges = incoming.get(node.id) ?? [];
    const meaningful = edges.filter((edge) => edge.source !== node.id);
    const production = meaningful.filter((edge) => !nodes.get(edge.source)?.test && !nodes.get(edge.source)?.path?.match(/(?:^|\/)(?:test|tests|__tests__)(?:\/|$)|\.(?:test|spec)\./));
    if (meaningful.length > 0 && production.length === 0) findings.push({
      kind: "test-only-code", node, confidence: 0.88, severity: "low", incomingReferences: meaningful.length,
      reasons: ["all indexed consumers are test code"], evidence: meaningful.slice(0, 10).map((edge) => `${nodes.get(edge.source)?.qualifiedName ?? edge.source} ${edge.kind} ${node.qualifiedName}`),
      recommendation: "Verify whether this is intentional test support; otherwise connect it to production behavior or remove it.",
    });
    else if (meaningful.length === 0) findings.push({
      kind: node.exported ? "unused-export" : "unused-private", node, confidence: node.exported ? 0.82 : 0.96, severity: node.exported ? "medium" : "low", incomingReferences: 0,
      reasons: [node.exported ? "exported symbol has no indexed callers, references, type uses, or inheritance consumers" : "non-exported symbol has no indexed consumers"],
      evidence: [`${node.path}:${node.location?.line ?? 1}`, "zero incoming semantic edges"],
      recommendation: node.exported ? "Confirm external consumers before removing or narrowing this export." : "Remove the symbol or connect it to its intended caller.",
    });
  }
  findings.sort((left, right) => right.confidence - left.confidence || left.node.qualifiedName.localeCompare(right.node.qualifiedName));
  return {
    generatedAt: new Date().toISOString(), repositoryFingerprint: graph.repository.fingerprint, entryPoints: [...entryPaths].sort(), findings,
    summary: {
      unreachableFiles: findings.filter((item) => item.kind === "unreachable-file").length,
      unusedExports: findings.filter((item) => item.kind === "unused-export").length,
      unusedPrivateSymbols: findings.filter((item) => item.kind === "unused-private").length,
      testOnlySymbols: findings.filter((item) => item.kind === "test-only-code").length,
      highConfidence: findings.filter((item) => item.confidence >= 0.9).length,
    },
  };
}

function bugClassification(subject: string): HistoricalBugCommit["classification"] | undefined {
  if (/\b(?:cve-\d{4}-\d+|security|vulnerab(?:ility|le)|xss|csrf|injection)\b/i.test(subject)) return "security-fix";
  if (/\b(?:regression|revert|rollback)\b/i.test(subject)) return "regression-fix";
  if (/^(?:fix|hotfix)(?:\([^)]*\))?[!:]|\b(?:fix(?:es|ed)?|bug|defect|patch)\b/i.test(subject)) return "bug-fix";
  return undefined;
}

export async function buildHistoricalBugIntelligence(graph: CodeGraph, limit = 500): Promise<HistoricalBugReport> {
  const history = await collectGitHistory(graph.repository.root, limit);
  const commits: HistoricalBugCommit[] = [];
  for (const commit of history.recentCommits) {
    const classification = bugClassification(commit.subject);
    if (!classification) continue;
    commits.push({ ...commit, classification, issueReferences: [...new Set(commit.subject.match(/(?:CVE-\d{4}-\d+|[A-Z][A-Z0-9]+-\d+|#\d+)/g) ?? [])] });
  }
  const byPath = new Map<string, HistoricalBugCommit[]>();
  for (const commit of commits) for (const file of new Set(commit.files)) {
    if (!byPath.has(file)) byPath.set(file, []);
    byPath.get(file)?.push(commit);
  }
  const cutoff = Date.now() - 180 * 24 * 60 * 60 * 1_000;
  const hotspots: HistoricalBugHotspot[] = [];
  for (const [file, fixes] of byPath) {
    const recentFixes = fixes.filter((commit) => Date.parse(commit.date) >= cutoff).length;
    const securityFixes = fixes.filter((commit) => commit.classification === "security-fix").length;
    const regressionFixes = fixes.filter((commit) => commit.classification === "regression-fix").length;
    const score = Math.min(100, fixes.length * 16 + recentFixes * 8 + securityFixes * 16 + regressionFixes * 12);
    const reasons = [`${fixes.length} bug-fix commit(s) touched this file`];
    if (recentFixes) reasons.push(`${recentFixes} fix(es) occurred in the last 180 days`);
    if (securityFixes) reasons.push(`${securityFixes} security fix(es)`);
    if (regressionFixes) reasons.push(`${regressionFixes} regression/revert fix(es)`);
    hotspots.push({ path: file, fixes: fixes.length, recentFixes, score, severity: severity(score), commits: fixes.map((commit) => commit.hash), nodeIds: graph.nodes.filter((node) => node.path === file).map((node) => node.id), reasons });
  }
  hotspots.sort((left, right) => right.score - left.score || left.path.localeCompare(right.path));
  return {
    generatedAt: new Date().toISOString(), repositoryFingerprint: graph.repository.fingerprint, historyAvailable: history.available, commits, hotspots,
    summary: {
      bugFixCommits: commits.length,
      securityFixes: commits.filter((item) => item.classification === "security-fix").length,
      regressionFixes: commits.filter((item) => item.classification === "regression-fix").length,
      affectedFiles: hotspots.length,
      highRiskHotspots: hotspots.filter((item) => item.severity === "high" || item.severity === "critical").length,
    },
    ...(history.error ? { error: history.error } : {}),
  };
}

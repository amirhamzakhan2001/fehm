import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import type {
  ArchitectureConfig,
  ArchitectureViolation,
  CodeGraph,
  GraphEdge,
  SecurityFinding,
  SecuritySeverity,
  VerificationCommandResult,
  VerificationObservation,
  VerificationReport,
  VerificationStatus,
} from "./model.js";

const VERIFICATION_SCHEMA_VERSION = "0.1.0";
const MAX_COMMAND_OUTPUT = 6_000;

export interface VerificationOptions {
  runCommands?: boolean;
  architectureConfigPath?: string;
  commandTimeoutMs?: number;
}

interface CommandSpec {
  category: VerificationCommandResult["category"];
  script: string;
  executable: string;
  args: string[];
}

interface SecurityRule {
  id: string;
  rule: string;
  severity: SecuritySeverity;
  title: string;
  detail: string;
  confidence: number;
  pattern: RegExp;
  condition?: (content: string) => boolean;
  redact?: boolean;
}

const SECURITY_RULES: SecurityRule[] = [
  {
    id: "dynamic-eval",
    rule: "CWE-95",
    severity: "high",
    title: "Dynamic eval execution",
    detail: "Review whether untrusted data can reach dynamic code execution.",
    confidence: 0.98,
    pattern: /\beval\s*\(/g,
  },
  {
    id: "dynamic-function",
    rule: "CWE-95",
    severity: "high",
    title: "Dynamic Function construction",
    detail: "Dynamic function construction executes generated code.",
    confidence: 0.96,
    pattern: /\bnew\s+Function\s*\(/g,
  },
  {
    id: "command-execution",
    rule: "CWE-78",
    severity: "medium",
    title: "Command execution API",
    detail: "Verify that command arguments cannot be controlled by untrusted input.",
    confidence: 0.76,
    pattern: /(?<![\w.$])(?:exec|execSync)\s*\(/g,
    condition: (content) => /(?:node:)?child_process/.test(content),
  },
  {
    id: "hardcoded-secret",
    rule: "CWE-798",
    severity: "high",
    title: "Potential hardcoded credential",
    detail: "Move credentials to a secret manager or protected environment variable.",
    confidence: 0.86,
    pattern: /\b(?:api[_-]?key|secret|password|access[_-]?token)\b\s*[:=]\s*["'][^"'\n]{8,}["']/gi,
    redact: true,
  },
  {
    id: "sql-template-interpolation",
    rule: "CWE-89",
    severity: "high",
    title: "SQL template interpolation",
    detail: "Use a parameterized query instead of interpolating values into SQL.",
    confidence: 0.83,
    pattern: /\b(?:query|execute)\s*\(\s*`[^`]*\$\{/g,
  },
  {
    id: "tls-verification-disabled",
    rule: "CWE-295",
    severity: "medium",
    title: "TLS certificate verification disabled",
    detail: "Do not disable TLS certificate verification in production connections.",
    confidence: 0.97,
    pattern: /rejectUnauthorized\s*:\s*false/g,
  },
];

function statusFromObservations(observations: VerificationObservation[]): VerificationStatus {
  if (observations.some((item) => item.status === "failed")) return "failed";
  if (observations.some((item) => item.status === "warning")) return "warning";
  if (observations.length === 0 || observations.every((item) => item.status === "skipped")) return "skipped";
  return "passed";
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function importCycles(graph: CodeGraph): string[][] {
  const fileIds = new Set(graph.nodes.filter((node) => node.kind === "file").map((node) => node.id));
  const adjacency = new Map<string, string[]>();
  for (const id of fileIds) adjacency.set(id, []);
  for (const edge of graph.edges) {
    if (edge.kind === "imports" && fileIds.has(edge.source) && fileIds.has(edge.target)) adjacency.get(edge.source)?.push(edge.target);
  }
  let nextIndex = 0;
  const indices = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const cycles: string[][] = [];
  const connect = (node: string): void => {
    indices.set(node, nextIndex);
    lowLinks.set(node, nextIndex);
    nextIndex += 1;
    stack.push(node);
    onStack.add(node);
    for (const target of adjacency.get(node) ?? []) {
      if (!indices.has(target)) {
        connect(target);
        lowLinks.set(node, Math.min(lowLinks.get(node) ?? 0, lowLinks.get(target) ?? 0));
      } else if (onStack.has(target)) {
        lowLinks.set(node, Math.min(lowLinks.get(node) ?? 0, indices.get(target) ?? 0));
      }
    }
    if (lowLinks.get(node) !== indices.get(node)) return;
    const component: string[] = [];
    let current: string | undefined;
    do {
      current = stack.pop();
      if (!current) break;
      onStack.delete(current);
      component.push(current);
    } while (current !== node);
    if (component.length > 1 || (component[0] && adjacency.get(component[0])?.includes(component[0]))) {
      cycles.push(component.sort());
    }
  };
  for (const id of fileIds) if (!indices.has(id)) connect(id);
  return cycles;
}

export async function runBuiltInStaticAnalysis(graph: CodeGraph): Promise<VerificationObservation[]> {
  const observations: VerificationObservation[] = [];
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const dangling = graph.edges.filter((edge) => !nodeIds.has(edge.source) || !nodeIds.has(edge.target));
  observations.push({
    name: "graph integrity",
    status: dangling.length === 0 ? "passed" : "failed",
    detail: dangling.length === 0 ? "all edge endpoints exist" : `${dangling.length} dangling edge(s)`,
  });
  const identities = new Set<string>();
  let duplicates = 0;
  for (const edge of graph.edges) {
    const identity = `${edge.kind}:${edge.source}->${edge.target}`;
    if (identities.has(identity)) duplicates += 1;
    identities.add(identity);
  }
  observations.push({
    name: "edge uniqueness",
    status: duplicates === 0 ? "passed" : "failed",
    detail: duplicates === 0 ? "no duplicate relationships" : `${duplicates} duplicate relationship(s)`,
  });
  const cycles = importCycles(graph);
  observations.push({
    name: "import cycles",
    status: cycles.length === 0 ? "passed" : "warning",
    detail: cycles.length === 0 ? "no file import cycles" : `${cycles.length} import cycle(s): ${cycles[0]?.join(" → ") ?? ""}`,
  });
  observations.push({
    name: "call resolution",
    status: graph.stats.unresolvedCalls === 0 ? "passed" : "warning",
    detail: `${graph.stats.calls} resolved and ${graph.stats.unresolvedCalls} unresolved call expression(s)`,
  });

  const root = path.resolve(graph.repository.root);
  let stale = 0;
  let missing = 0;
  for (const [relativePath, expectedHash] of Object.entries(graph.fileHashes)) {
    const absolute = path.resolve(root, relativePath);
    if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) continue;
    try {
      const currentHash = createHash("sha256").update(await readFile(absolute)).digest("hex");
      if (currentHash !== expectedHash) stale += 1;
    } catch {
      missing += 1;
    }
  }
  observations.push({
    name: "index freshness",
    status: stale === 0 && missing === 0 ? "passed" : "warning",
    detail: stale === 0 && missing === 0 ? "graph matches indexed files" : `${stale} stale and ${missing} missing indexed file(s)`,
  });
  return observations;
}

async function packageManager(root: string): Promise<string> {
  if (await exists(path.join(root, "pnpm-lock.yaml"))) return "pnpm";
  if (await exists(path.join(root, "yarn.lock"))) return "yarn";
  if (await exists(path.join(root, "bun.lockb")) || await exists(path.join(root, "bun.lock"))) return "bun";
  return "npm";
}

export async function detectVerificationCommands(root: string): Promise<CommandSpec[]> {
  let manifest: { scripts?: Record<string, string> };
  try {
    manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as { scripts?: Record<string, string> };
  } catch {
    return [];
  }
  const scripts = manifest.scripts ?? {};
  const manager = await packageManager(root);
  const result: CommandSpec[] = [];
  const select = (category: CommandSpec["category"], candidates: string[]): void => {
    const script = candidates.find((name) => typeof scripts[name] === "string");
    if (!script) return;
    result.push({ category, script, executable: manager, args: ["run", script] });
  };
  select("types", ["typecheck", "type-check", "check:types", "check"]);
  select("lint", ["lint"]);
  select("build", ["build"]);
  select("test", ["test", "test:unit"]);
  return result;
}

function runCommand(spec: CommandSpec, root: string, timeoutMs: number): Promise<VerificationCommandResult> {
  return new Promise((resolve) => {
    const started = Date.now();
    execFile(
      spec.executable,
      spec.args,
      { cwd: root, timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const candidate = error as NodeJS.ErrnoException & { code?: string | number; killed?: boolean } | null;
        const timedOut = Boolean(candidate?.killed || candidate?.code === "ETIMEDOUT");
        const rawOutput = `${stdout ?? ""}${stderr ?? ""}`.trim();
        const output = rawOutput.length > MAX_COMMAND_OUTPUT
          ? `${rawOutput.slice(0, MAX_COMMAND_OUTPUT)}\n… output truncated …`
          : rawOutput;
        const exitCode = error
          ? typeof candidate?.code === "number" ? candidate.code : null
          : 0;
        resolve({
          category: spec.category,
          script: spec.script,
          command: [spec.executable, ...spec.args],
          status: error ? "failed" : "passed",
          exitCode,
          durationMs: Date.now() - started,
          output,
          timedOut,
        });
      },
    );
  });
}

export async function runDetectedCommands(
  root: string,
  timeoutMs = 120_000,
): Promise<VerificationCommandResult[]> {
  const specs = await detectVerificationCommands(root);
  const results: VerificationCommandResult[] = [];
  for (const spec of specs) results.push(await runCommand(spec, root, timeoutMs));
  return results;
}

function locationFor(content: string, offset: number): { line: number; column: number } {
  const prefix = content.slice(0, offset);
  const lines = prefix.split(/\r?\n/);
  return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 };
}

function snippetFor(content: string, offset: number, redact: boolean): string {
  const line = content.slice(content.lastIndexOf("\n", offset) + 1, content.indexOf("\n", offset) === -1 ? content.length : content.indexOf("\n", offset)).trim();
  if (!redact) return line.slice(0, 240);
  return line.replace(/([:=]\s*)["'][^"']+["']/, '$1"***REDACTED***"').slice(0, 240);
}

export async function scanSecurity(graph: CodeGraph): Promise<{ filesScanned: number; findings: SecurityFinding[] }> {
  const findings: SecurityFinding[] = [];
  const root = path.resolve(graph.repository.root);
  let filesScanned = 0;
  for (const node of graph.nodes) {
    if (node.kind !== "file" || !node.path || node.test) continue;
    const absolute = path.resolve(root, node.path);
    if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) continue;
    let content: string;
    try {
      content = await readFile(absolute, "utf8");
    } catch {
      continue;
    }
    filesScanned += 1;
    for (const rule of SECURITY_RULES) {
      if (rule.condition && !rule.condition(content)) continue;
      const pattern = new RegExp(rule.pattern.source, rule.pattern.flags);
      for (const match of content.matchAll(pattern)) {
        const offset = match.index ?? 0;
        const location = locationFor(content, offset);
        findings.push({
          id: `${rule.id}:${node.path}:${location.line}:${location.column}`,
          rule: rule.rule,
          severity: rule.severity,
          title: rule.title,
          detail: rule.detail,
          path: node.path,
          line: location.line,
          column: location.column,
          confidence: rule.confidence,
          snippet: snippetFor(content, offset, rule.redact ?? false),
        });
      }
    }
  }
  return { filesScanned, findings };
}

function globRegex(pattern: string): RegExp {
  const placeholder = "__DOUBLE_STAR__";
  const escaped = pattern
    .split(path.sep).join("/")
    .replace(/\*\*/g, placeholder)
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, "[^/]*")
    .replace(new RegExp(placeholder, "g"), ".*");
  return new RegExp(`^${escaped}$`);
}

function matchesGlob(value: string, pattern: string): boolean {
  return globRegex(pattern).test(value.split(path.sep).join("/"));
}

function layerFor(filePath: string, config: ArchitectureConfig): string | undefined {
  return config.layers.find((layer) => layer.patterns.some((pattern) => matchesGlob(filePath, pattern)))?.name;
}

function validateArchitectureConfig(value: unknown): ArchitectureConfig {
  if (!value || typeof value !== "object") throw new Error("architecture config must be an object");
  const candidate = value as Partial<ArchitectureConfig>;
  if (candidate.version !== 1) throw new Error("architecture config version must be 1");
  if (!Array.isArray(candidate.layers) || candidate.layers.some((layer) =>
    typeof layer.name !== "string"
    || !Array.isArray(layer.patterns)
    || layer.patterns.some((pattern) => typeof pattern !== "string"))) {
    throw new Error("architecture config requires layers with names and pattern arrays");
  }
  if (candidate.allowedDependencies && Object.values(candidate.allowedDependencies).some((targets) =>
    !Array.isArray(targets) || targets.some((target) => typeof target !== "string"))) {
    throw new Error("allowedDependencies values must be arrays of layer names");
  }
  if (candidate.forbiddenDependencies && (!Array.isArray(candidate.forbiddenDependencies)
    || candidate.forbiddenDependencies.some((rule) => typeof rule.from !== "string" || typeof rule.to !== "string"))) {
    throw new Error("forbiddenDependencies requires from and to glob patterns");
  }
  return candidate as ArchitectureConfig;
}

export async function checkArchitecture(
  graph: CodeGraph,
  configPath?: string,
): Promise<{ status: VerificationStatus; configPath?: string; violations: ArchitectureViolation[]; error?: string }> {
  const candidatePath = configPath
    ? path.resolve(graph.repository.root, configPath)
    : path.join(path.resolve(graph.repository.root), ".fehm", "architecture.json");
  if (!await exists(candidatePath)) return { status: "skipped", violations: [] };
  let config: ArchitectureConfig;
  try {
    config = validateArchitectureConfig(JSON.parse(await readFile(candidatePath, "utf8")) as unknown);
  } catch (error) {
    return { status: "failed", configPath: candidatePath, violations: [], error: error instanceof Error ? error.message : String(error) };
  }
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const violations: ArchitectureViolation[] = [];
  for (const edge of graph.edges) {
    if (edge.kind !== "imports") continue;
    const source = nodes.get(edge.source);
    const target = nodes.get(edge.target);
    if (source?.kind !== "file" || target?.kind !== "file" || !source.path || !target.path) continue;
    const sourceLayer = layerFor(source.path, config);
    const targetLayer = layerFor(target.path, config);
    const allowed = sourceLayer ? config.allowedDependencies?.[sourceLayer] : undefined;
    if (sourceLayer && targetLayer && sourceLayer !== targetLayer && allowed && !allowed.includes(targetLayer)) {
      violations.push({
        rule: "allowed-dependencies",
        source: source.path,
        target: target.path,
        sourceLayer,
        targetLayer,
        reason: `${sourceLayer} may only depend on: ${allowed.join(", ") || "no other layers"}`,
        evidence: edge.evidence,
      });
    }
    for (const rule of config.forbiddenDependencies ?? []) {
      if (!matchesGlob(source.path, rule.from) || !matchesGlob(target.path, rule.to)) continue;
      const violation: ArchitectureViolation = {
        rule: "forbidden-dependency",
        source: source.path,
        target: target.path,
        reason: rule.reason ?? `${rule.from} must not depend on ${rule.to}`,
        evidence: edge.evidence,
      };
      if (sourceLayer) violation.sourceLayer = sourceLayer;
      if (targetLayer) violation.targetLayer = targetLayer;
      violations.push(violation);
    }
  }
  return { status: violations.length ? "failed" : "passed", configPath: candidatePath, violations };
}

function commandGroupStatus(results: VerificationCommandResult[]): VerificationStatus {
  if (results.length === 0) return "skipped";
  if (results.some((result) => result.status === "failed")) return "failed";
  return "passed";
}

function securityStatus(findings: SecurityFinding[]): VerificationStatus {
  if (findings.some((finding) => finding.severity === "critical" || finding.severity === "high")) return "failed";
  if (findings.length > 0) return "warning";
  return "passed";
}

export async function runVerification(
  graph: CodeGraph,
  options: VerificationOptions = {},
): Promise<VerificationReport> {
  const staticObservations = await runBuiltInStaticAnalysis(graph);
  const allCommands = options.runCommands === false
    ? []
    : await runDetectedCommands(graph.repository.root, Math.max(1_000, options.commandTimeoutMs ?? 120_000));
  const projectResults = allCommands.filter((result) => result.category !== "test");
  const testResult = allCommands.find((result) => result.category === "test");
  const security = await scanSecurity(graph);
  const architecture = await checkArchitecture(graph, options.architectureConfigPath);
  const sectionStatuses: VerificationStatus[] = [
    statusFromObservations(staticObservations),
    commandGroupStatus(projectResults),
    testResult?.status ?? "skipped",
    securityStatus(security.findings),
    architecture.status,
  ];
  const failures = sectionStatuses.filter((status) => status === "failed").length;
  const warnings = sectionStatuses.filter((status) => status === "warning").length;
  const skipped = sectionStatuses.filter((status) => status === "skipped").length;
  const confidence = Math.max(0, 100 - failures * 25 - warnings * 8 - skipped * 3);
  return {
    schemaVersion: VERIFICATION_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    repositoryFingerprint: graph.repository.fingerprint,
    staticAnalysis: { status: sectionStatuses[0] ?? "skipped", observations: staticObservations },
    projectCommands: { status: sectionStatuses[1] ?? "skipped", results: projectResults },
    tests: testResult ? { status: testResult.status, result: testResult } : { status: "skipped" },
    security: { status: sectionStatuses[3] ?? "skipped", filesScanned: security.filesScanned, findings: security.findings },
    architecture,
    summary: { passed: failures === 0, confidence, failures, warnings, skipped },
  };
}

export function formatVerification(report: VerificationReport): string {
  const lines = [
    "# Codebase Verification",
    "",
    `Result: ${report.summary.passed ? "PASSED" : "FAILED"}`,
    `Confidence: ${report.summary.confidence}%`,
    `Failures: ${report.summary.failures}; warnings: ${report.summary.warnings}; skipped: ${report.summary.skipped}`,
    "",
    `## Static analysis — ${report.staticAnalysis.status.toUpperCase()}`,
    ...report.staticAnalysis.observations.map((item) => `- ${item.status.toUpperCase()}: ${item.name} — ${item.detail}`),
    "",
    `## Project commands — ${report.projectCommands.status.toUpperCase()}`,
    ...(report.projectCommands.results.length
      ? report.projectCommands.results.map((result) => `- ${result.status.toUpperCase()}: ${result.command.join(" ")} (${result.durationMs}ms)`)
      : ["- No supported project commands detected or command execution disabled"]),
    "",
    `## Tests — ${report.tests.status.toUpperCase()}`,
    report.tests.result
      ? `- ${report.tests.result.command.join(" ")} (${report.tests.result.durationMs}ms)`
      : "- No supported test command detected or command execution disabled",
    "",
    `## Security — ${report.security.status.toUpperCase()}`,
    `- ${report.security.filesScanned} file(s) scanned; ${report.security.findings.length} finding(s)`,
    ...report.security.findings.slice(0, 30).map((finding) => `- ${finding.severity.toUpperCase()}: ${finding.path}:${finding.line} ${finding.title} (${finding.rule}, confidence ${finding.confidence})`),
    "",
    `## Architecture — ${report.architecture.status.toUpperCase()}`,
    ...(report.architecture.error
      ? [`- ${report.architecture.error}`]
      : report.architecture.violations.length
        ? report.architecture.violations.map((violation) => `- ${violation.source} --imports--> ${violation.target}: ${violation.reason}`)
        : [report.architecture.configPath ? "- No architecture violations" : "- No architecture contract configured"]),
  ];
  return `${lines.join("\n")}\n`;
}

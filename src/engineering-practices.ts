import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { CodeGraph } from "./model.js";
import { atomicWriteJson } from "./persistence.js";
import { readRepositoryArtifacts, type RepositoryArtifact } from "./repository-artifacts.js";

export type PracticeProfile = "auto" | "library" | "service" | "ai-service";
export type PracticeMode = "warn" | "require" | "off";
export interface PracticesPolicy {
  version: 1;
  profile: PracticeProfile;
  rules: Record<string, { mode: PracticeMode; reason?: string }>;
  approval?: { approvedBy: string; approvedAt: string; policyHash: string };
}
export interface PracticeFinding {
  id: string;
  domain: string;
  title: string;
  status: "detected" | "review" | "not-applicable" | "exempt";
  mode: PracticeMode;
  evidence: Array<{ path: string; line: number; check: string }>;
  missing: string[];
  recommendation: string;
  reference: string;
  exception?: string;
}
export interface PracticesReport {
  version: 1;
  catalogVersion: "1";
  generatedAt: string;
  repositoryRoot: string;
  repositoryFingerprint: string;
  evidenceFingerprint: string;
  policyHash: string;
  policySource: "advisory" | "approved";
  profile: PracticeProfile;
  contexts: string[];
  passed: boolean;
  blockers: string[];
  summary: { detected: number; review: number; notApplicable: number; exempt: number };
  findings: PracticeFinding[];
  drift: { status: "no-baseline" | "incompatible-baseline" | "stable" | "improved" | "degraded"; regressed: string[]; improved: string[]; detail: string };
  note: string;
}

type Context = "all" | "service" | "ai" | "data" | "web";
type Check = { label: string; paths: RegExp; content?: RegExp };
type Rule = { id: string; domain: string; title: string; context: Context; checks: Check[]; recommendation: string; reference: string };
const refs = {
  ssdf: "https://www.nist.gov/publications/secure-software-development-framework-ssdf-version-11-recommendations-mitigating-risk",
  asvs: "https://owasp.org/projects/asvs",
  ai: "https://www.nist.gov/itl/ai-risk-management-framework",
  sre: "https://sre.google/workbook/engagement-model/",
  accessibility: "https://www.w3.org/WAI/standards-guidelines/wcag/",
};
const source = /\.(?:[cm]?[jt]sx?|py|go|rs|java|cs|rb|php)$/i;
const docs = /(?:^|\/)(?:README|ARCHITECTURE|CONTRIBUTING|SECURITY|RUNBOOK|DEPLOYMENT|OPERATIONS|DATA|PRIVACY)[^/]*\.md$|(?:^|\/)docs\/.*\.md$/i;
const tests = /(?:^|\/)(?:tests?|__tests__|evals?)(?:\/|$)|\.(?:test|spec)\.|(?:^|\/)test_[^/]+\.py$|_test\.go$/i;
const ci = /(?:^|\/)(?:\.github\/workflows\/[^/]+\.ya?ml|\.gitlab-ci\.ya?ml|Jenkinsfile|azure-pipelines\.ya?ml|\.circleci\/config\.yml)$/i;
const check = (label: string, paths: RegExp, content?: RegExp): Check => ({ label, paths, ...(content ? { content } : {}) });
const rule = (id: string, domain: string, title: string, context: Context, checks: Check[], recommendation: string, reference = refs.ssdf): Rule => ({ id, domain, title, context, checks, recommendation, reference });

// These are review signals, not certifications. Every content match is scoped to
// the relevant artifact type; prose cannot stand in for executable controls.
export const PRACTICE_RULES: readonly Rule[] = [
  rule("architecture-intent", "Architecture", "Document boundaries and rationale", "all", [check("architecture decisions", docs, /\b(?:architecture|boundary|boundaries|trade-off|rationale)\b/i)], "Describe responsibilities, dependency direction, invariants, and the reasons for the chosen design."),
  rule("ownership", "Architecture", "Assign review ownership", "all", [check("ownership rules", /(?:^|\/)CODEOWNERS$/i, /\S+\s+@\S+/)], "Define accountable owners and review boundaries in CODEOWNERS."),
  rule("development-workflow", "Development", "Make development reproducible", "all", [check("setup instructions", docs, /\b(?:npm ci|pnpm install|pip install|cargo build|go build|setup|installation)\b/i), check("contribution procedure", docs, /\b(?:contribut|code review|pull request|preflight)/i)], "Document setup, local checks, review expectations, and how to make a safe change."),
  rule("static-analysis", "Development", "Configure static analysis", "all", [check("analysis configuration", /(?:^|\/)(?:tsconfig[^/]*\.json|eslint\.config\.[cm]?js|\.eslintrc[^/]*|pyproject\.toml|mypy\.ini|\.golangci\.ya?ml|rust-toolchain(?:\.toml)?)$/i)], "Configure language-appropriate type checking and linting, then execute them in CI."),
  rule("automated-tests", "Testing", "Keep executable regression tests", "all", [check("test cases", tests, /\b(?:test\s*\(|it\s*\(|def test_|func Test|#\[test\]|@Test|describe\s*\()/)], "Test critical behavior, boundary cases, and regressions; file presence alone does not establish adequate coverage."),
  rule("failure-tests", "Testing", "Exercise failure and denied paths", "all", [check("failure assertions", tests, /\b(?:rejects|throws|toThrow|raises|unauthorized|forbidden|timeout|invalid)\b/i)], "Add assertions for invalid input, authorization failures, dependency failure, and timeouts."),
  rule("ci-verification", "Delivery", "Run verification in CI", "all", [check("CI verification command", ci, /\b(?:npm (?:test|run (?:check|test|release:check))|pnpm (?:test|check)|pytest|cargo test|go test|mvn test|dotnet test)\b/)], "Run reproducible build, static checks, and tests on every reviewed change."),
  rule("dependency-lock", "Supply chain", "Pin resolved dependency versions", "all", [check("dependency lock", /(?:^|\/)(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|uv\.lock|poetry\.lock|Cargo\.lock|go\.sum|packages\.lock\.json)$/)], "Commit an appropriate lockfile when your dependency ecosystem and release model support one; exempt dependency-free projects with a reason."),
  rule("dependency-review", "Supply chain", "Review dependency risk", "all", [check("automated dependency review", /(?:^|\/)(?:\.github\/(?:dependabot\.ya?ml|workflows\/[^/]+\.ya?ml)|renovate\.json|\.renovaterc\.json)$/, /(?:dependabot|dependency-review|npm audit|pnpm audit|pip-audit|cargo audit|renovate|package-ecosystem)/i)], "Configure dependency update review and vulnerability checks with a remediation owner."),
  rule("security-policy", "Security", "Document security response", "all", [check("vulnerability reporting policy", /(?:^|\/)SECURITY\.md$/i, /\b(?:report|contact|vulnerabilit)/i)], "Document private vulnerability reporting, supported versions, and remediation responsibility."),
  rule("threat-model", "Security", "Record trust boundaries", "service", [check("threat model", docs, /\b(?:threat model|trust boundar|attack surface)\b/i)], "Document assets, actors, trust boundaries, abuse cases, and mitigations.", refs.asvs),
  rule("input-validation", "Security", "Validate untrusted inputs", "service", [check("runtime validation", source, /\b(?:safeParse|validate|validation|isObject|JSONSchema|z\.object|Ajv|pydantic)\b/)], "Validate shape, type, size, and allowed values at every external boundary and test rejection paths.", refs.asvs),
  rule("authorization", "Security", "Enforce server-side authorization", "service", [check("authorization control", source, /\b(?:timingSafeEqual|authorize|authenticated|checkPermission|requireAuth|verifyToken|hasPermission)\b/)], "Enforce identity and permissions server-side; a login screen or policy document is insufficient.", refs.asvs),
  rule("secret-handling", "Security", "Externalize secrets", "all", [check("secret exclusions", /(?:^|\/)\.gitignore$/, /^\s*\/?\.env(?:\.\*|\*)?\s*$/m)], "Keep credentials out of source and use an environment or secret manager; run secret scanning as a separate check.", refs.asvs),
  rule("api-contracts", "API and data", "Version interface contracts", "service", [check("API schema or contract", /(?:openapi|swagger|schema|contract).*\.(?:json|ya?ml|graphql|ts|py)$/i, /\b(?:openapi|swagger|schema|interface|type|contract)\b/i)], "Define request/response schemas, compatibility expectations, and contract tests."),
  rule("data-migrations", "API and data", "Version data migrations", "data", [check("migration artifacts", /(?:^|\/)(?:migrations?|prisma\/migrations)\/.*\.(?:sql|ts|js|py|go)$/i)], "Version schema migrations and test forward migration, compatibility, and rollback or recovery."),
  rule("data-recovery", "API and data", "Plan data recovery and privacy", "data", [check("backup and restore procedure", docs, /\b(?:backup|restore|recovery)\b/i), check("retention and deletion policy", docs, /\b(?:retention|deletion|privacy|personal data)\b/i)], "Specify data ownership, retention, access controls, backups, and tested restoration."),
  rule("timeouts", "Reliability", "Bound external operations", "service", [check("timeouts or cancellation", source, /\b(?:AbortSignal|AbortController|timeout|Timeout|context\.WithTimeout|CancellationToken)\b/)], "Set timeouts and cancellation for external calls; bound concurrency and retry budgets.", refs.sre),
  rule("idempotency", "Reliability", "Handle repeated side effects", "service", [check("idempotency or retry design", docs, /\b(?:idempotenc|idempotent|retry budget|deduplicat)/i)], "Define retry, duplicate delivery, ordering, and idempotency behavior for side effects.", refs.sre),
  rule("health-checks", "Operations", "Expose health and readiness", "service", [check("health handlers", source, /(?:\/health|\/ready|\/live|readiness|liveness)/i)], "Separate process liveness from dependency readiness and test unhealthy states.", refs.sre),
  rule("observability", "Operations", "Correlate runtime diagnostics", "service", [check("diagnostic instrumentation", source, /\b(?:requestId|traceId|opentelemetry|startSpan|logger\.|logging\.|metrics\.)/)], "Use structured logs, metrics, traces, request IDs, actionable alerts, and an owner.", refs.sre),
  rule("incident-runbook", "Operations", "Document incident response", "service", [check("incident procedure", docs, /\b(?:incident|on-call|on call|runbook)\b/i)], "Write diagnosis, escalation, recovery, and incident follow-up procedures.", refs.sre),
  rule("deployment-rollback", "Deployment", "Plan rollout and rollback", "service", [check("rollout instructions", docs, /\b(?:deploy|rollout|release)\b/i), check("rollback instructions", docs, /\brollback\b/i)], "Document environment configuration, staged rollout, smoke checks, rollback, and ownership.", refs.sre),
  rule("container-hardening", "Deployment", "Use a non-root container user", "service", [check("non-root container directive", /(?:^|\/)Dockerfile(?:\.[^/]+)?$/i, /^\s*USER\s+(?!root\b|0\b|\$)\S+/m)], "If containerized, run as a non-root user, restrict writable paths, and set resource limits; exempt non-container deployments."),
  rule("infrastructure-review", "Deployment", "Review infrastructure changes", "service", [check("infrastructure definitions", /\.tf$|(?:^|\/)(?:k8s|kubernetes|helm|infra|infrastructure)\/.*\.(?:ya?ml|json|ts)$/i)], "Version infrastructure and review plans, permissions, environment differences, and drift; exempt local-only tools."),
  rule("accessibility", "User experience", "Provide accessible controls", "web", [check("semantic controls", /\.(?:html?|jsx|tsx|vue|svelte)$/i, /(?:<label\b|aria-label=|aria-labelledby=)/i)], "Test keyboard operation, names, focus, contrast, error messages, and assistive technology; syntax signals do not prove WCAG conformance.", refs.accessibility),
  rule("ai-prompt-versioning", "AI engineering", "Version prompts and model configuration", "ai", [check("prompt artifacts", /(?:\.prompt\.(?:txt|md)|(?:^|\/)prompts?\/[^/]+\.(?:md|txt|json|ya?ml))$/i), check("model configuration", source, /\b(?:model|modelId|model_name)\b/)], "Version prompts, model settings, datasets, and tool schemas with change rationale.", refs.ai),
  rule("ai-evaluations", "AI engineering", "Gate AI changes on evaluations", "ai", [check("behavioral evaluation tests", tests, /\b(?:evaluation|evaluator|eval|prompt|hallucination)\b/i)], "Run representative and adversarial evaluations with held-out cases, recorded responses, and regression gates.", refs.ai),
  rule("ai-tool-boundaries", "AI engineering", "Constrain agent tools and authorization", "ai", [check("tool authorization evidence", source, /\b(?:authorization|approvalRequired|requiresApproval|allowedTools|toolPolicy|readOnlyHint)\b/)], "Validate tool arguments and outputs, restrict capabilities, and require explicit authorization for consequential actions.", refs.ai),
  rule("ai-data-safety", "AI engineering", "Specify model-data and injection safeguards", "ai", [check("untrusted-content boundary", docs, /\b(?:prompt injection|untrusted (?:content|data)|instruction hierarchy)\b/i), check("provider data policy", docs, /\b(?:retention|redact|personal data|sensitive data|source stays local)\b/i)], "Document injection boundaries, sensitive-data handling, provider retention, and permitted source transmission.", refs.ai),
  rule("ai-runtime-budgets", "AI engineering", "Bound model execution cost and latency", "ai", [check("model execution timeout", source, /\b(?:AbortSignal\.timeout|timeoutMs|max_tokens|max_output_tokens|tokenBudget)\b/)], "Set model call timeouts, token/cost limits, retry limits, and human fallback; one signal does not establish every budget.", refs.ai),
];

function policyHash(policy: PracticesPolicy): string {
  return createHash("sha256").update(JSON.stringify({ version: policy.version, profile: policy.profile, rules: Object.entries(policy.rules).sort(([a], [b]) => a.localeCompare(b)).map(([id, value]) => [id, value.mode, value.reason ?? ""]) })).digest("hex");
}
function object(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
export function validatePracticesPolicy(value: unknown): PracticesPolicy {
  if (!object(value) || value.version !== 1 || typeof value.profile !== "string" || !["auto", "library", "service", "ai-service"].includes(value.profile) || !object(value.rules)) throw new Error("invalid engineering practices policy");
  for (const [id, setting] of Object.entries(value.rules)) {
    if (!PRACTICE_RULES.some((item) => item.id === id) || !object(setting) || typeof setting.mode !== "string" || !["warn", "require", "off"].includes(setting.mode) || (setting.reason !== undefined && typeof setting.reason !== "string") || (setting.mode === "off" && (typeof setting.reason !== "string" || !setting.reason.trim()))) throw new Error(`invalid engineering practice rule: ${id}; exemptions require a reason`);
  }
  if (value.approval !== undefined && (!object(value.approval) || typeof value.approval.approvedBy !== "string" || !value.approval.approvedBy.trim() || typeof value.approval.approvedAt !== "string" || !Number.isFinite(Date.parse(value.approval.approvedAt)) || typeof value.approval.policyHash !== "string")) throw new Error("invalid engineering policy approval");
  return value as unknown as PracticesPolicy;
}
async function readJsonIfPresent(file: string): Promise<unknown | undefined> {
  try { return JSON.parse(await readFile(file, "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}
const statePath = (graph: CodeGraph, name: string): string => path.join(graph.repository.root, ".fehm", name);
export async function proposePracticesPolicy(graph: CodeGraph, profile: PracticeProfile = "auto"): Promise<{ path: string; policy: PracticesPolicy }> {
  const policy = validatePracticesPolicy({ version: 1, profile, rules: Object.fromEntries(PRACTICE_RULES.map((item) => [item.id, { mode: ["architecture-intent", "automated-tests", "ci-verification"].includes(item.id) ? "require" : "warn" }])) });
  const destination = statePath(graph, "practices.proposed.json");
  await atomicWriteJson(destination, policy);
  return { path: destination, policy };
}
export async function approvePracticesPolicy(graph: CodeGraph): Promise<{ path: string; policy: PracticesPolicy }> {
  const policy = validatePracticesPolicy(await readJsonIfPresent(statePath(graph, "practices.proposed.json")));
  policy.approval = { approvedBy: "developer", approvedAt: new Date().toISOString(), policyHash: policyHash(policy) };
  const destination = statePath(graph, "practices.json");
  await atomicWriteJson(destination, policy);
  return { path: destination, policy };
}

function evidenceFor(files: RepositoryArtifact[], requirement: Check): PracticeFinding["evidence"] {
  return files.filter((file) => requirement.paths.test(file.path) && (!requirement.content || requirement.content.test(file.content))).slice(0, 5).map((file) => {
    const offset = requirement.content ? file.content.search(requirement.content) : 0;
    return { path: file.path, line: file.content.slice(0, Math.max(0, offset)).split("\n").length, check: requirement.label };
  });
}

export async function auditEngineeringPractices(graph: CodeGraph): Promise<PracticesReport> {
  try {
    if (!(await stat(graph.repository.root)).isDirectory()) throw new Error("not a directory");
  } catch {
    throw new Error("cannot audit engineering practices: repository root is unavailable; rescan the repository at its current location");
  }
  const saved = await readJsonIfPresent(statePath(graph, "practices.json"));
  const policy: PracticesPolicy = saved === undefined ? { version: 1, profile: "auto", rules: {} } : validatePracticesPolicy(saved);
  const hash = policyHash(policy);
  if (saved !== undefined && policy.approval?.policyHash !== hash) throw new Error("engineering policy is unapproved or changed after approval; propose, review, and approve it again");
  const files = await readRepositoryArtifacts(graph.repository.root, (relative, basename) => /\.(?:[cm]?[jt]sx?|py|go|rs|java|cs|rb|php|md|txt|json|ya?ml|toml|ini|sql|tf|graphql|vue|svelte|html?)$/i.test(relative) || /^(?:\.gitignore|CODEOWNERS|Jenkinsfile|Dockerfile.*|.*\.lockb?|go\.sum)$/.test(basename));
  // Test fixtures and prose do not establish that a runtime capability exists.
  const implementation = files.filter((file) => source.test(file.path) && !tests.test(file.path));
  const runtimeText = implementation.map((file) => file.content).join("\n");
  const dependencies = new Set(graph.nodes.filter((node) => node.kind === "package").map((node) => node.name));
  for (const file of files.filter((item) => /(?:^|\/)package\.json$/.test(item.path))) {
    try {
      const manifest: unknown = JSON.parse(file.content);
      if (object(manifest) && object(manifest.dependencies)) for (const name of Object.keys(manifest.dependencies)) dependencies.add(name);
    } catch { /* an invalid manifest is not positive capability evidence */ }
  }
  const contexts = new Set<string>(["all"]);
  if (policy.profile === "service" || policy.profile === "ai-service" || (policy.profile === "auto" && /\b(?:createServer|FastAPI|express|Fastify|Flask|ListenAndServe)\s*\(/.test(runtimeText))) contexts.add("service");
  if (policy.profile === "ai-service" || (policy.profile === "auto" && ([...dependencies].some((name) => /^(?:openai|anthropic|@anthropic-ai\/sdk|ai)$/.test(name)) || /\b(?:generateText|chat\.completions\.create|callPromptModel|executePromptSuite)\s*\(/.test(runtimeText)))) contexts.add("ai");
  if ([...dependencies].some((name) => /^(?:pg|mysql2?|sqlite3|better-sqlite3|@prisma\/client|prisma|sequelize|mongoose|psycopg|sqlalchemy)$/.test(name)) || files.some((file) => /(?:^|\/)migrations?\/.*\.sql$/.test(file.path))) contexts.add("data");
  if (files.some((file) => /\.(?:html?|jsx|tsx|vue|svelte)$/.test(file.path) && !tests.test(file.path))) contexts.add("web");
  const findings: PracticeFinding[] = PRACTICE_RULES.map((item) => {
    const setting = policy.rules[item.id] ?? { mode: "warn" as const };
    const applicable = setting.mode === "require" || contexts.has(item.context);
    const evidence: PracticeFinding["evidence"] = [];
    const missing: string[] = [];
    if (applicable && setting.mode !== "off") for (const requirement of item.checks) {
      const found = evidenceFor(requirement.paths === source ? implementation : requirement.paths === tests ? files.filter((file) => source.test(file.path)) : files, requirement);
      if (found.length) evidence.push(...found); else missing.push(requirement.label);
    }
    return { id: item.id, domain: item.domain, title: item.title, mode: setting.mode,
      status: setting.mode === "off" ? "exempt" : !applicable ? "not-applicable" : missing.length ? "review" : "detected",
      evidence, missing, recommendation: item.recommendation, reference: item.reference,
      ...(setting.reason ? { exception: setting.reason } : {}),
    };
  });
  const blockers = saved === undefined ? [] : findings.filter((item) => item.mode === "require" && item.status === "review").map((item) => item.id);
  const evidenceFingerprint = createHash("sha256").update(files.map((file) => `${file.path}:${createHash("sha256").update(file.content).digest("hex")}`).join("\n")).digest("hex");
  const report: PracticesReport = { version: 1, catalogVersion: "1", generatedAt: new Date().toISOString(), repositoryRoot: path.resolve(graph.repository.root), repositoryFingerprint: graph.repository.fingerprint, evidenceFingerprint, policyHash: hash, policySource: saved === undefined ? "advisory" : "approved", profile: policy.profile, contexts: [...contexts].sort(), passed: blockers.length === 0, blockers,
    summary: { detected: findings.filter((item) => item.status === "detected").length, review: findings.filter((item) => item.status === "review").length, notApplicable: findings.filter((item) => item.status === "not-applicable").length, exempt: findings.filter((item) => item.status === "exempt").length }, findings,
    drift: { status: "no-baseline", regressed: [], improved: [], detail: "Save a reviewed baseline to compare engineering-practice evidence over time." },
    note: "Detected means a static evidence signal exists, not proof of correctness or standards compliance. Review means evidence is missing or incomplete. Only explicitly approved required rules block preflight. Architecture dependency violations are checked separately against the project's architecture contract.",
  };
  const baseline = await readJsonIfPresent(statePath(graph, "practices-baseline.json"));
  if (baseline !== undefined) {
    if (!object(baseline) || baseline.version !== 1 || !Array.isArray(baseline.findings) || !baseline.findings.every((item) => object(item) && typeof item.id === "string" && ["detected", "review", "not-applicable", "exempt"].includes(String(item.status)))) throw new Error("invalid engineering practices baseline");
    if (baseline.catalogVersion !== report.catalogVersion || baseline.repositoryRoot !== report.repositoryRoot || baseline.policyHash !== hash) report.drift = { status: "incompatible-baseline", regressed: [], improved: [], detail: "Repository, catalog, or policy changed; review the new results and save a new baseline." };
    else {
      const previous = new Map((baseline.findings as PracticeFinding[]).map((item) => [item.id, item.status]));
      const regressed = findings.filter((item) => previous.get(item.id) === "detected" && item.status === "review").map((item) => item.id);
      const improved = findings.filter((item) => previous.get(item.id) === "review" && item.status === "detected").map((item) => item.id);
      report.drift = { status: regressed.length ? "degraded" : improved.length ? "improved" : "stable", regressed, improved, detail: "Compared practice evidence under the same policy. Newly applicable controls appear as review findings; loss of previously detected evidence is a regression." };
    }
  }
  return report;
}
export async function savePracticesBaseline(graph: CodeGraph): Promise<{ path: string; report: PracticesReport }> {
  const report = await auditEngineeringPractices(graph);
  const destination = statePath(graph, "practices-baseline.json");
  await atomicWriteJson(destination, report);
  return { path: destination, report };
}
export function formatPracticesReport(report: PracticesReport): string {
  return ["# Engineering Practices", "", `Policy: ${report.policySource}; profile: ${report.profile}; drift: ${report.drift.status}`, `Signals: ${report.summary.detected}; review: ${report.summary.review}; exempt: ${report.summary.exempt}; not applicable: ${report.summary.notApplicable}`, `Required gaps: ${report.blockers.join(", ") || "none"}`, "", report.note, "", ...report.findings.map((item) => `- [${item.status}] ${item.domain} / ${item.title} (${item.mode})\n  ${item.evidence.map((evidence) => `${evidence.path}:${evidence.line}`).join(", ") || item.exception || item.missing.join(", ")}\n  ${item.recommendation}`), ""].join("\n");
}

import { createHash } from "node:crypto";
import path from "node:path";
import type { ArchitectureConfig, CodeGraph, GraphNode } from "./model.js";
import { inferArchitecture, readArchitectureState } from "./architecture.js";
import { atomicWriteFile } from "./persistence.js";
import { readRepositoryArtifacts, type RepositoryArtifact } from "./repository-artifacts.js";
import { buildSystemMap, detectEntryPoints } from "./system-map.js";

export type ReadinessStatus = "present" | "partial" | "missing" | "not-applicable";

export interface EvidenceAssessment {
  id: string;
  name: string;
  status: ReadinessStatus;
  summary: string;
  evidence: string[];
  recommendation?: string;
}

export interface ArchitectureIntentReport {
  generatedAt: string;
  score: number;
  status: "ready" | "needs-review" | "incomplete";
  contractSource: "approved" | "proposed" | "inferred";
  questions: EvidenceAssessment[];
  stopAndAskRule: string;
}

export interface EngineeringCapabilityReport {
  generatedAt: string;
  detected: number;
  partial: number;
  notDetected: number;
  note: string;
  capabilities: EvidenceAssessment[];
}

export interface ProductionReadinessReport {
  generatedAt: string;
  score: number;
  risk: "low" | "moderate" | "high";
  conclusion: string;
  findings: EvidenceAssessment[];
}

export interface GraphConnectivityReport {
  generatedAt: string;
  components: number;
  largestComponentNodes: number;
  largestComponentPercent: number;
  isolatedNodes: number;
  isolated: Array<{ id: string; kind: string; name: string; path?: string }>;
  note: string;
}

export interface OnboardingDocument {
  generatedAt: string;
  markdown: string;
  architecture: ArchitectureIntentReport;
  capabilities: EngineeringCapabilityReport;
  connectivity: GraphConnectivityReport;
}

const TEXT_FILE = /(?:^|\/)(?:Dockerfile(?:\..+)?|Makefile|Procfile|robots\.txt|sitemap\.xml|package\.json|tsconfig\.json|README(?:\.[^.]+)?|ARCHITECTURE\.md|CODEOWNERS)$|\.(?:[cm]?[jt]sx?|py|go|rs|java|kt|cs|rb|php|swift|scala|sql|graphql|gql|html?|css|scss|vue|svelte|ya?ml|toml|tf|tfvars|md|json|xml)$/i;

function uniq(values: string[], limit = 12): string[] {
  return [...new Set(values)].slice(0, limit);
}

function pathsMatching(artifacts: RepositoryArtifact[], pattern: RegExp, contentPattern?: RegExp): string[] {
  return uniq(artifacts.filter((item) => pattern.test(item.path) || (contentPattern?.test(item.content) ?? false)).map((item) => item.path));
}

async function artifacts(graph: CodeGraph): Promise<RepositoryArtifact[]> {
  return readRepositoryArtifacts(graph.repository.root, (relativePath) => TEXT_FILE.test(relativePath));
}

function assessment(
  id: string,
  name: string,
  evidence: string[],
  summary: string,
  recommendation: string,
  partial = false,
  applicable = true,
): EvidenceAssessment {
  if (!applicable) return { id, name, status: "not-applicable", summary, evidence: [] };
  if (evidence.length) return { id, name, status: partial ? "partial" : "present", summary, evidence: uniq(evidence), ...(partial ? { recommendation } : {}) };
  return { id, name, status: "missing", summary, evidence: [], recommendation };
}

function architectureEvidence(config: ArchitectureConfig | undefined): string[] {
  if (!config) return [];
  return config.layers.flatMap((layer) => layer.patterns.map((pattern) => `${layer.name}: ${pattern}`));
}

export async function auditArchitectureIntent(graph: CodeGraph): Promise<ArchitectureIntentReport> {
  const [files, state, entryPoints, inferred] = await Promise.all([
    artifacts(graph),
    readArchitectureState(graph),
    detectEntryPoints(graph),
    inferArchitecture(graph),
  ]);
  const config = state.contract ?? state.proposal?.config ?? inferred.config;
  const contractSource: ArchitectureIntentReport["contractSource"] = state.contract ? "approved" : state.proposal ? "proposed" : "inferred";
  const docs = files.filter((item) => /(?:^|\/)(?:ARCHITECTURE|README|CONTRIBUTING|CODEOWNERS|adr[^/]*)/i.test(item.path));
  const docText = docs.map((item) => item.content).join("\n");
  const docPaths = docs.map((item) => item.path);
  const ownership = pathsMatching(files, /(?:^|\/)CODEOWNERS$|(?:^|\/)(?:owners?|maintainers?)\.(?:md|ya?ml)$/i, /\b(?:owns?|owner|responsib(?:le|ility))\b/i);
  const decisions = pathsMatching(files, /(?:^|\/)(?:adr|decision|rfcs?)(?:\/|[-_.])/i, /\b(?:decision|trade-?off|rationale|because we|why)\b/i);
  const boundaries = Object.entries(config.allowedDependencies ?? {}).flatMap(([source, targets]) => [`${source} may depend on ${targets.join(", ") || "no other layer"}`]);
  const bans = /\b(?:must not|must never|forbidden|prohibited|do not depend|never import)\b/i.test(docText) ? docPaths : [];
  const flowEvidence = entryPoints.slice(0, 8).map((item) => `${item.label} at ${item.path}:${item.line}`);
  const invariants = pathsMatching(docs, /.*/, /\b(?:invariant|non-?negotiable|must never|must always|cannot|security boundary)\b/i);
  const extensions = pathsMatching(docs, /.*/, /\b(?:extension point|new code|add (?:a |an )?(?:route|command|analyzer|feature)|belongs|place new)\b/i);
  const stopRule = pathsMatching(docs, /.*/, /\bSTOP\b[\s\S]{0,240}\b(?:ask|conflict|architecture|boundary)\b/i);
  const questions: EvidenceAssessment[] = [
    assessment("system-shape", "What is in the system?", architectureEvidence(config), `${config.layers.length} layer(s) describe the system shape.`, "Document the major layers and their responsibility.", contractSource !== "approved"),
    assessment("ownership", "Who owns what?", ownership, "Responsibility and ownership should be explicit, not guessed from filenames.", "Add CODEOWNERS or an ownership section with one accountable owner per responsibility."),
    assessment("rationale", "Why is it built this way?", decisions, "Architecture decisions should record reasons and trade-offs.", "Record ADRs with decision, rationale, rejected alternatives, and consequences."),
    assessment("dependency-rules", "What may touch what?", [...boundaries, ...bans], "Dependency direction needs both allowed paths and explicit bans.", "Approve an architecture contract and document forbidden dependencies.", bans.length === 0 || contractSource !== "approved"),
    assessment("critical-flows", "How does data move?", flowEvidence, `${entryPoints.length} executable entry point(s) were detected.`, "Document at least one end-to-end critical flow including side effects and failure paths.", entryPoints.length < 1),
    assessment("invariants", "What can never break?", invariants, "Non-negotiable correctness and security rules must be written down.", "Add a short invariants section covering trust, data, and compatibility guarantees."),
    assessment("extension-points", "Where does new code belong?", extensions, "Contributors need supported extension points.", "Document where new routes, services, analyzers, adapters, tests, and persistence code belong."),
    assessment("stop-and-ask", "When must an agent stop and ask?", stopRule, "Agents need an explicit escalation rule for architectural conflicts.", "Add a mandatory stop-and-ask rule that names the conflict, affected boundary, owner, and smallest compliant fix."),
  ];
  const weights = questions.filter((item) => item.status !== "not-applicable");
  const score = Math.round(weights.reduce((sum, item) => sum + (item.status === "present" ? 100 : item.status === "partial" ? 55 : 0), 0) / Math.max(1, weights.length));
  return {
    generatedAt: new Date().toISOString(),
    score,
    status: score >= 85 ? "ready" : score >= 55 ? "needs-review" : "incomplete",
    contractSource,
    questions,
    stopAndAskRule: "If a requested change violates an approved boundary or invariant: STOP, name the conflict, list affected files and owner, and propose the smallest compliant alternative before editing.",
  };
}

interface CapabilityRule {
  id: string;
  name: string;
  path: RegExp;
  content: RegExp;
  summary: string;
  recommendation: string;
}

const CAPABILITY_RULES: CapabilityRule[] = [
  { id: "api-design", name: "API design", path: /(?:api|routes?|controllers?|openapi|swagger|graphql)/i, content: /\b(?:openapi|swagger|router\.|app\.(?:get|post|put|patch|delete)|GraphQL|endpoint)\b/i, summary: "HTTP/RPC contracts and transport boundaries.", recommendation: "Add explicit request/response contracts, versioning, validation, and compatibility checks." },
  { id: "auth", name: "Authentication and authorization", path: /(?:auth|rbac|permissions?|sessions?)/i, content: /\b(?:oauth|oidc|jwt|session|bearer|authorization|permission|rbac)\b/i, summary: "Identity, sessions, and policy enforcement.", recommendation: "Enforce authentication and authorization server-side and test denied paths." },
  { id: "databases", name: "Databases", path: /(?:database|db|schema|migrations?|prisma|sql)/i, content: /\b(?:postgres|mysql|sqlite|mongodb|database|transaction|migration|SELECT\s|INSERT\s)\b/i, summary: "Persistent data models, migrations, and transactions.", recommendation: "Document data ownership, migrations, transactions, backup, and recovery." },
  { id: "caching", name: "Caching", path: /(?:cache|redis|memcached)/i, content: /\b(?:cache-control|redis|memcached|cache hit|cache miss|ttl|memoiz)\b/i, summary: "Latency and load reduction with explicit invalidation.", recommendation: "Define cache keys, TTLs, invalidation, consistency, and failure behavior." },
  { id: "event-driven", name: "Event-driven systems", path: /(?:events?|queues?|kafka|rabbit|sqs|pubsub)/i, content: /\b(?:publish|subscribe|producer|consumer|event bus|kafka|rabbitmq|SQS|pubsub|queue)\b/i, summary: "Events, queues, consumers, retries, and delivery semantics.", recommendation: "Document schemas, idempotency, ordering, retries, and dead-letter handling." },
  { id: "concurrency-async", name: "Concurrency and async", path: /(?:workers?|jobs?|concurr|async)/i, content: /\b(?:async|await|Promise\.all|worker|mutex|semaphore|goroutine|channel|race condition)\b/i, summary: "Asynchronous work, coordination, cancellation, and backpressure.", recommendation: "Document concurrency limits, cancellation, timeouts, races, and backpressure." },
  { id: "distributed-systems", name: "Distributed systems", path: /(?:services?|grpc|kubernetes|k8s|distributed)/i, content: /\b(?:grpc|service discovery|circuit breaker|distributed|eventual consistency|consensus|retry budget)\b/i, summary: "Cross-service failure, consistency, and resiliency behavior.", recommendation: "Define service boundaries, failure modes, consistency, retries, and idempotency." },
  { id: "security", name: "Security", path: /(?:security|auth|permissions?|secrets?)/i, content: /\b(?:CSP|HSTS|csrf|xss|sanitize|authorization|timingSafeEqual|secret|threat model)\b/i, summary: "Trust boundaries, secure defaults, and vulnerability controls.", recommendation: "Add a threat model, secret scanning, secure headers, least privilege, and security tests." },
  { id: "observability", name: "Observability", path: /(?:observability|telemetry|metrics?|logging|tracing|health)/i, content: /\b(?:opentelemetry|trace|metric|structured log|health endpoint|readiness|liveness|sentry)\b/i, summary: "Logs, metrics, traces, health, and alerting.", recommendation: "Add structured logs, health/readiness, metrics, tracing, dashboards, and alert ownership." },
  { id: "cloud-deployment", name: "Cloud and deployment", path: /(?:Dockerfile|deploy|kubernetes|k8s|helm|serverless|cloud)/i, content: /\b(?:docker|kubernetes|aws|azure|gcp|serverless|deployment|container)\b/i, summary: "Repeatable build and runtime deployment.", recommendation: "Document environments, rollout, rollback, configuration, and runtime limits." },
  { id: "infrastructure-as-code", name: "Infrastructure as code", path: /(?:\.tf$|terraform|pulumi|cloudformation|cdk|k8s|helm)/i, content: /\b(?:terraform|pulumi|cloudformation|AWS::|apiVersion:\s|kind:\s*(?:Deployment|Service))\b/i, summary: "Versioned, reviewable infrastructure definitions.", recommendation: "Represent production infrastructure as reviewed code with plan and drift checks." },
  { id: "ci-cd", name: "CI/CD", path: /(?:\.github\/workflows|\.gitlab-ci|Jenkinsfile|azure-pipelines|circleci)/i, content: /\b(?:npm test|npm run check|build|deploy|release|workflow_dispatch)\b/i, summary: "Automated verification and delivery gates.", recommendation: "Add CI gates for type checks, tests, security, packaging, and deployment approval." },
  { id: "api-gateways", name: "API gateways", path: /(?:nginx|kong|traefik|envoy|gateway)/i, content: /\b(?:nginx|kong|traefik|envoy|API Gateway|rate limit|reverse proxy)\b/i, summary: "Edge routing, policy, rate limits, and termination.", recommendation: "If the system has multiple public services, define gateway routing, auth, limits, and observability." },
  { id: "testing", name: "Testing", path: /(?:^|\/)(?:test|tests|__tests__)(?:\/|$)|\.(?:test|spec)\./i, content: /\b(?:describe\(|it\(|test\(|node:test|pytest|junit|assert)\b/i, summary: "Automated unit, integration, contract, and end-to-end confidence.", recommendation: "Add tests for critical flows, failure paths, boundaries, and deployment smoke checks." },
  { id: "ai-integration", name: "AI integration", path: /(?:ai|llm|prompts?|mcp|agents?|openai|anthropic)/i, content: /\b(?:OpenAI|Anthropic|LLM|prompt|model|MCP|tool call|embedding|agent)\b/i, summary: "Model, prompt, tool, evaluation, and safety integration.", recommendation: "Version prompts, validate tool contracts, evaluate regressions, and verify model claims against evidence." },
];

export async function assessEngineeringCapabilities(graph: CodeGraph): Promise<EngineeringCapabilityReport> {
  const files = await artifacts(graph);
  const implementationFiles = files.filter((item) => !/\.(?:md|txt)$/i.test(item.path) && !/(?:^|\/)project-readiness\.ts$/i.test(item.path));
  const capabilities = CAPABILITY_RULES.map((rule) => {
    const pathEvidence = implementationFiles.filter((item) => rule.path.test(item.path)).map((item) => item.path);
    const contentEvidence = implementationFiles.filter((item) => rule.content.test(item.content)).map((item) => item.path);
    const evidence = uniq([...pathEvidence, ...contentEvidence]);
    const strong = pathEvidence.length > 0 && contentEvidence.length > 0;
    return assessment(rule.id, rule.name, evidence, rule.summary, rule.recommendation, evidence.length > 0 && !strong);
  });
  return {
    generatedAt: new Date().toISOString(),
    detected: capabilities.filter((item) => item.status === "present").length,
    partial: capabilities.filter((item) => item.status === "partial").length,
    notDetected: capabilities.filter((item) => item.status === "missing").length,
    note: "A missing signal is not automatically a defect: capabilities should be required only when the project architecture and risks need them.",
    capabilities,
  };
}

function frontendProject(files: RepositoryArtifact[]): boolean {
  return files.some((item) => /(?:^|\/)(?:index\.html|src\/.*\.(?:jsx|tsx|vue|svelte)|pages\/|app\/.*page\.)/i.test(item.path));
}

function scoreFindings(findings: EvidenceAssessment[]): number {
  const applicable = findings.filter((item) => item.status !== "not-applicable");
  return Math.round(applicable.reduce((sum, item) => sum + (item.status === "present" ? 100 : item.status === "partial" ? 50 : 0), 0) / Math.max(1, applicable.length));
}

export async function auditProductionReadiness(graph: CodeGraph): Promise<ProductionReadinessReport> {
  const files = await artifacts(graph);
  const web = frontendProject(files);
  const localOnly = files.some((item) => /(?:^|\/)(?:package\.json|README(?:\.md)?)$/i.test(item.path) && /\blocal-first\b/i.test(item.content));
  const publicWeb = web && !localOnly;
  const find = (pathPattern: RegExp, contentPattern?: RegExp): string[] => pathsMatching(files, pathPattern, contentPattern);
  const html = files.filter((item) => /\.html?$/i.test(item.path));
  const htmlText = html.map((item) => item.content).join("\n");
  const implementationFiles = files.filter((item) => !/\.(?:md|txt)$/i.test(item.path) && !/(?:^|\/)project-readiness\.ts$/i.test(item.path));
  const sourceText = implementationFiles.map((item) => item.content).join("\n");
  const hasTypeBypass = implementationFiles.some((item) => item.content.split(/\r?\n/).some((line) => /^\s*\/\/\s*@ts-(?:ignore|nocheck)\b/.test(line) || (/\bas\s+any\b/.test(line) && !/["'`]as\s+any["'`]/.test(line))));
  const hasDevelopmentMarker = implementationFiles.some((item) => /\b(?:Vite \+ React|Lorem ipsum)\b/i.test(item.content) || item.content.split(/\r?\n/).some((line) => /^\s*(?:\/\/|\/\*+|\*)\s*(?:TODO|FIXME|HACK|DUMMY|PLACEHOLDER)\b/i.test(line)));
  const findings: EvidenceAssessment[] = [
    assessment("release-pipeline", "Release pipeline", find(/\.github\/workflows|\.gitlab-ci|Jenkinsfile|Dockerfile/i), "Build, test, and packaging are automated.", "Add CI with type, test, security, package, and smoke gates."),
    assessment("tests", "Automated tests", find(/(?:^|\/)(?:test|tests|__tests__)(?:\/|$)|\.(?:test|spec)\./i), "Automated tests cover important behavior.", "Add unit and integration tests for critical and failure paths."),
    assessment("type-safety", "Type and static safety", find(/tsconfig\.json|pyproject\.toml|mypy|eslint/i), "Static analysis catches defects before runtime.", "Configure strict type checking and linting."),
    assessment("no-bypass-markers", "No type-check bypasses", hasTypeBypass ? [] : ["No executable @ts-ignore, @ts-nocheck, or 'as any' pattern found"], "Type-check bypasses are absent from scanned implementation text.", "Remove or justify type-check bypasses and add runtime validation."),
    assessment("error-states", "Loading, empty, and error states", find(/\.(?:jsx|tsx|vue|svelte)$/i, /\b(?:loading|empty|error|retry|fallback|ErrorBoundary)\b/i), "User-facing async states are represented.", "Implement loading, empty, error, and retry states.", false, web),
    assessment("document-metadata", "HTML metadata and language", html.length && /<!doctype html>/i.test(htmlText) && /<html[^>]+lang=/i.test(htmlText) && /<title>[^<]+/i.test(htmlText) && /name=["']description["']/i.test(htmlText) ? html.map((item) => item.path) : [], "Documents declare doctype, language, title, and description.", "Add route-appropriate title, description, language, canonical, social cards, and icons.", false, web),
    assessment("seo-assets", "SEO crawler assets", find(/(?:^|\/)(?:robots\.txt|sitemap\.xml)$/i), localOnly ? "Crawler assets are unnecessary for a localhost-only application." : "Crawler policy and discoverable routes are explicit.", "Add correct robots.txt and sitemap.xml when public indexing is intended.", false, publicWeb),
    assessment("not-found", "404 and error handling", find(/(?:404|not-found|error-boundary|error\.tsx)/i, /\b(?:statusCode\s*[:=]\s*404|not found|ErrorBoundary)\b/i), "Unknown routes and runtime failures have explicit handling.", "Add a custom 404 with a real 404 status and a top-level error boundary.", false, web),
    assessment("accessibility", "Accessibility semantics", web && /<img\b/i.test(htmlText + sourceText) && !/<img\b[^>]*\balt=/i.test(htmlText + sourceText) ? [] : find(/\.(?:html?|jsx|tsx|vue|svelte)$/i, /(?:aria-[\w-]+|<button\b|<label\b|\balt=|\blang=)/i), "Semantic controls, labels, image alternatives, and keyboard behavior are present.", "Audit semantic headings, labels, alt text, focus, keyboard navigation, and dialogs.", false, web),
    assessment("security", "Security controls", find(/SECURITY\.md|security|auth/i, /\b(?:CSP|HSTS|csrf|authorization|timingSafeEqual|secret scan|threat)\b/i), "Security policy or controls are present.", "Add threat modeling, secret scanning, server-side authorization, and secure headers."),
    assessment("observability", "Operational observability", find(/health|observability|telemetry|metrics|logging/i, /\b(?:readiness|liveness|structured log|trace|metric|requestId)\b/i), "Health and diagnostic signals support production operation.", "Add readiness/liveness, structured logs, metrics, alerting, and error tracking."),
    assessment("documentation", "Architecture and operations documentation", find(/(?:^|\/)(?:README|ARCHITECTURE|SECURITY|RUNBOOK)(?:\.|$)/i), "Architecture, setup, security, and operations are documented.", "Add architecture, setup, deployment, rollback, and incident documentation."),
    assessment("no-development-leftovers", "No obvious development leftovers", hasDevelopmentMarker ? [] : ["No default-branding, placeholder text, or marker comments found"], "Obvious default branding and placeholder markers are absent.", "Remove default framework branding, placeholders, debug endpoints, and unfinished markers."),
  ];
  const score = scoreFindings(findings);
  return {
    generatedAt: new Date().toISOString(),
    score,
    risk: score >= 80 ? "low" : score >= 55 ? "moderate" : "high",
    conclusion: "This is a production-readiness assessment, not proof that AI generated the project. Clusters of missing controls indicate insufficient production hardening.",
    findings,
  };
}

export function analyzeGraphConnectivity(graph: CodeGraph): GraphConnectivityReport {
  const adjacency = new Map(graph.nodes.map((node) => [node.id, new Set<string>()]));
  for (const edge of graph.edges) {
    adjacency.get(edge.source)?.add(edge.target);
    adjacency.get(edge.target)?.add(edge.source);
  }
  const visited = new Set<string>();
  const sizes: number[] = [];
  for (const node of graph.nodes) {
    if (visited.has(node.id)) continue;
    let size = 0;
    const queue = [node.id];
    while (queue.length) {
      const id = queue.pop();
      if (!id || visited.has(id)) continue;
      visited.add(id);
      size += 1;
      for (const next of adjacency.get(id) ?? []) if (!visited.has(next)) queue.push(next);
    }
    sizes.push(size);
  }
  const isolatedNodes = graph.nodes.filter((node) => (adjacency.get(node.id)?.size ?? 0) === 0);
  const largestComponentNodes = Math.max(0, ...sizes);
  return {
    generatedAt: new Date().toISOString(),
    components: sizes.length,
    largestComponentNodes,
    largestComponentPercent: graph.nodes.length ? Math.round(largestComponentNodes / graph.nodes.length * 100) : 0,
    isolatedNodes: isolatedNodes.length,
    isolated: isolatedNodes.slice(0, 100).map((node) => ({ id: node.id, kind: node.kind, name: node.qualifiedName, ...(node.path ? { path: node.path } : {}) })),
    note: "fehm never invents edges to make a graph look connected. Separate components can be valid entry points, assets, generated boundaries, or evidence of an unresolved relationship.",
  };
}

function markdownTable(rows: string[][]): string {
  if (!rows.length) return "";
  const width = rows[0]?.length ?? 0;
  return [rows[0], Array.from({ length: width }, () => "---"), ...rows.slice(1)].map((row) => `| ${row?.map((cell) => cell.replace(/\|/g, "\\|").replace(/\n/g, " ")).join(" | ")} |`).join("\n");
}

export async function buildOnboardingDocument(graph: CodeGraph): Promise<OnboardingDocument> {
  const [systemMap, architecture, capabilities] = await Promise.all([
    buildSystemMap(graph),
    auditArchitectureIntent(graph),
    assessEngineeringCapabilities(graph),
  ]);
  const connectivity = analyzeGraphConnectivity(graph);
  const componentGroups = new Map<string, string[]>();
  for (const node of graph.nodes.filter((item) => item.kind === "file" && item.path)) {
    const filePath = node.path as string;
    const parts = filePath.split("/");
    const name = parts.length > 2 && parts[0] === "src" ? `src/${parts[1]}` : parts[0] ?? "root";
    const values = componentGroups.get(name) ?? [];
    values.push(filePath);
    componentGroups.set(name, values);
  }
  const components = [...componentGroups].sort(([left], [right]) => left.localeCompare(right)).slice(0, 20);
  const entryPoints = systemMap.entryPoints.slice(0, 30);
  const risks = systemMap.prophecies.slice(0, 12);
  const markdown = [
    `# ${graph.repository.name}: Codebase Onboarding`,
    "",
    `Generated by fehm from indexed evidence on ${new Date().toISOString()}. This document distinguishes verified facts, inferred structure, and unknowns; it does not replace developer decisions.`,
    "",
    "## Start here",
    "",
    systemMap.onboarding.summary,
    "",
    `- Repository: \`${graph.repository.root}\``,
    `- Graph: ${graph.stats.nodes} nodes, ${graph.stats.edges} edges, ${graph.stats.files} files, ${graph.stats.symbols} symbols`,
    `- Architecture intent readiness: ${architecture.score}% (${architecture.status}; ${architecture.contractSource})`,
    `- Graph connectivity: ${connectivity.components} component(s); ${connectivity.largestComponentPercent}% in the largest`,
    "",
    "## System shape and ownership",
    "",
    markdownTable([["Component", "Purpose", "Evidence"], ...components.map(([name, paths]) => [name, `Source area containing ${paths.length} indexed file(s).`, paths.slice(0, 4).join(", ")])]),
    "",
    "## Executable entry points",
    "",
    markdownTable([["Kind", "Entry point", "Location", "Confidence"], ...entryPoints.map((item) => [item.kind, item.label, `${item.path}:${item.line}`, `${Math.round(item.confidence * 100)}%`])]),
    "",
    "## The eight architecture answers",
    "",
    markdownTable([["Question", "Status", "Evidence / next action"], ...architecture.questions.map((item) => [item.name, item.status, item.evidence.join("; ") || item.recommendation || item.summary])]),
    "",
    "## Engineering capability fingerprint",
    "",
    capabilities.note,
    "",
    markdownTable([["Capability", "Signal", "What it covers"], ...capabilities.capabilities.map((item) => [item.name, item.status, item.summary])]),
    "",
    "## Likely change and failure hotspots",
    "",
    ...(risks.length ? risks.map((item) => `- **${item.node.qualifiedName}** — ${item.prediction}; ${item.factors.map((factor) => factor.evidence).join("; ")} (${Math.round(item.confidence * 100)}% confidence)`) : ["- No hotspots were inferred from the current graph."]),
    "",
    "## Known unknowns",
    "",
    ...systemMap.unknowns.map((item) => `- **${item.kind}** — ${item.detail}${item.paths.length ? ` Evidence: ${item.paths.slice(0, 5).join(", ")}.` : ""}`),
    "",
    "## Working safely with an AI coding agent",
    "",
    "1. Query fehm for the task, relevant symbols, callers, dependencies, tests, and architecture boundary before editing.",
    "2. Treat AST/type-checker evidence as fact, heuristics as a lead, and undocumented intent as unknown.",
    "3. Run impact/preflight before a change and verification after it.",
    `4. ${architecture.stopAndAskRule}`,
    "5. Never fabricate a dependency merely to connect graph components.",
    "",
  ].join("\n");
  return { generatedAt: new Date().toISOString(), markdown, architecture, capabilities, connectivity };
}

export async function writeOnboardingDocument(graph: CodeGraph, destination?: string): Promise<{ path: string; document: OnboardingDocument }> {
  const document = await buildOnboardingDocument(graph);
  const outputPath = path.resolve(destination ?? path.join(graph.repository.root, ".fehm", "onboarding.md"));
  await atomicWriteFile(outputPath, document.markdown);
  return { path: outputPath, document };
}

function noteName(filePath: string): string {
  const readable = filePath.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 90) || "root";
  return `${readable}-${createHash("sha1").update(filePath).digest("hex").slice(0, 8)}`;
}

function nodeLink(node: GraphNode, names: Map<string, string>): string {
  return node.path ? `[[Files/${names.get(node.path) ?? noteName(node.path)}|${node.qualifiedName}]]` : node.qualifiedName;
}

export async function exportObsidianVault(graph: CodeGraph, destination: string): Promise<{ path: string; notes: number }> {
  const output = path.resolve(destination);
  const onboarding = await buildOnboardingDocument(graph);
  const fileNodes = graph.nodes.filter((node) => node.kind === "file" && node.path).sort((a, b) => (a.path as string).localeCompare(b.path as string));
  const names = new Map(fileNodes.map((node) => [node.path as string, noteName(node.path as string)]));
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  await atomicWriteFile(path.join(output, "fehm.md"), [
    `# ${graph.repository.name}`,
    "",
    "- [[Onboarding]]",
    "- [[Architecture Intent]]",
    "- [[Engineering Capabilities]]",
    "- [[Graph Connectivity]]",
    "",
    "## Files",
    "",
    ...fileNodes.map((node) => `- [[Files/${names.get(node.path as string)}|${node.path}]]`),
    "",
  ].join("\n"));
  await atomicWriteFile(path.join(output, "Onboarding.md"), onboarding.markdown);
  await atomicWriteFile(path.join(output, "Architecture Intent.md"), `# Architecture Intent\n\n${markdownTable([["Question", "Status", "Evidence"], ...onboarding.architecture.questions.map((item) => [item.name, item.status, item.evidence.join("; ") || item.recommendation || item.summary])])}\n`);
  await atomicWriteFile(path.join(output, "Engineering Capabilities.md"), `# Engineering Capabilities\n\n${onboarding.capabilities.note}\n\n${markdownTable([["Capability", "Status", "Evidence"], ...onboarding.capabilities.capabilities.map((item) => [item.name, item.status, item.evidence.join(", ") || "not detected"])])}\n`);
  await atomicWriteFile(path.join(output, "Graph Connectivity.md"), `# Graph Connectivity\n\n- Components: ${onboarding.connectivity.components}\n- Largest component: ${onboarding.connectivity.largestComponentPercent}%\n- Isolated nodes: ${onboarding.connectivity.isolatedNodes}\n\n${onboarding.connectivity.note}\n`);
  for (const fileNode of fileNodes) {
    const filePath = fileNode.path as string;
    const symbols = graph.nodes.filter((node) => node.path === filePath && node.kind !== "file");
    const related = graph.edges.filter((edge) => edge.source === fileNode.id || edge.target === fileNode.id).map((edge) => ({ edge, other: nodes.get(edge.source === fileNode.id ? edge.target : edge.source) })).filter((item) => item.other);
    const contents = [
      `# ${filePath}`,
      "",
      `Source: \`${filePath}\``,
      "",
      "## Symbols",
      "",
      ...(symbols.length ? symbols.slice(0, 200).map((node) => `- ${node.kind}: \`${node.qualifiedName}\`${node.location ? ` (line ${node.location.line})` : ""}`) : ["- No indexed symbols."]),
      "",
      "## Relationships",
      "",
      ...(related.length ? related.slice(0, 200).map(({ edge, other }) => `- ${edge.kind}: ${nodeLink(other as GraphNode, names)} (${Math.round(edge.evidence.confidence * 100)}%)`) : ["- No direct file-level relationships; inspect symbol-level relationships in fehm." ]),
      "",
    ].join("\n");
    await atomicWriteFile(path.join(output, "Files", `${names.get(filePath)}.md`), contents);
  }
  return { path: output, notes: fileNodes.length + 5 };
}

export function formatArchitectureIntent(report: ArchitectureIntentReport): string {
  return `# Architecture Intent Audit\n\nScore: ${report.score}% (${report.status}; ${report.contractSource})\n\n${markdownTable([["Question", "Status", "Evidence / recommendation"], ...report.questions.map((item) => [item.name, item.status, item.evidence.join("; ") || item.recommendation || item.summary])])}\n`;
}

export function formatCapabilities(report: EngineeringCapabilityReport): string {
  return `# Engineering Capability Matrix\n\nDetected: ${report.detected}; partial: ${report.partial}; not detected: ${report.notDetected}\n\n${report.note}\n\n${markdownTable([["Capability", "Status", "Evidence"], ...report.capabilities.map((item) => [item.name, item.status, item.evidence.join(", ") || "not detected"])])}\n`;
}

export function formatProductionReadiness(report: ProductionReadinessReport): string {
  return `# Production Readiness Audit\n\nScore: ${report.score}%; rushed-production risk: ${report.risk}\n\n${report.conclusion}\n\n${markdownTable([["Check", "Status", "Evidence / recommendation"], ...report.findings.map((item) => [item.name, item.status, item.evidence.join(", ") || item.recommendation || item.summary])])}\n`;
}

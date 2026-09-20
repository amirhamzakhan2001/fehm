import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import type { ArchitectureConfig, ArchitectureLayer, ArchitectureProposal, CodeGraph } from "./model.js";
import { atomicWriteJson } from "./persistence.js";

const CATEGORY_HINTS: Array<{ name: string; segments: string[]; intent: string }> = [
  { name: "frontend", segments: ["components", "frontend", "pages", "ui", "views", "web"], intent: "User-facing presentation and interaction." },
  { name: "api", segments: ["api", "controllers", "handlers", "routes"], intent: "Transport boundary, request validation, and response mapping." },
  { name: "auth", segments: ["auth", "authentication", "permissions", "rbac"], intent: "Identity, session, and authorization policy." },
  { name: "services", segments: ["domain", "services", "usecases"], intent: "Application and business logic." },
  { name: "repositories", segments: ["data", "persistence", "repositories", "repository"], intent: "Persistence abstraction and external data access." },
  { name: "database", segments: ["database", "db", "migrations", "models", "prisma", "schema"], intent: "Database schema, migrations, and concrete storage." },
  { name: "testing", segments: ["__tests__", "test", "tests"], intent: "Automated verification code." },
  { name: "infrastructure", segments: ["deploy", "deployment", "docker", "infra", "infrastructure", "terraform"], intent: "Build, deployment, and runtime infrastructure." },
  { name: "shared", segments: ["common", "lib", "shared", "types", "utils"], intent: "Cross-cutting types and utilities with no feature ownership." },
];

async function exists(filePath: string): Promise<boolean> {
  try { await access(filePath); return true; } catch { return false; }
}

function normalize(value: string): string {
  return value.split(path.sep).join("/");
}

function patternFor(filePath: string, segment: string): string {
  const parts = normalize(filePath).split("/");
  const index = parts.findIndex((part) => part.toLowerCase() === segment);
  return `${parts.slice(0, index + 1).join("/")}/**`;
}

function inferredLayers(graph: CodeGraph): ArchitectureLayer[] {
  const files = graph.nodes.filter((node) => node.kind === "file" && node.path).map((node) => node.path as string);
  const layers: ArchitectureLayer[] = [];
  const claimed = new Set<string>();
  for (const hint of CATEGORY_HINTS) {
    const patterns = new Set<string>();
    for (const filePath of files) {
      const segments = normalize(filePath).toLowerCase().split("/");
      const match = hint.segments.find((segment) => segments.includes(segment));
      if (!match) continue;
      patterns.add(patternFor(filePath, match));
      claimed.add(filePath);
    }
    if (patterns.size) layers.push({ name: hint.name, patterns: [...patterns].sort() });
  }
  const remainingRoots = new Map<string, string[]>();
  for (const filePath of files.filter((candidate) => !claimed.has(candidate))) {
    const parts = normalize(filePath).split("/");
    const directory = parts.length > 2 && parts[0] === "src" ? parts[1] : parts.length > 1 ? parts[0] : undefined;
    if (!directory) continue;
    const values = remainingRoots.get(directory) ?? [];
    values.push(filePath);
    remainingRoots.set(directory, values);
  }
  for (const [directory] of [...remainingRoots].sort(([left], [right]) => left.localeCompare(right))) {
    if (layers.some((layer) => layer.name === directory)) continue;
    const prefix = files.some((filePath) => filePath.startsWith(`src/${directory}/`)) ? `src/${directory}/**` : `${directory}/**`;
    layers.push({ name: directory.replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase(), patterns: [prefix] });
  }
  return layers;
}

function globRegex(pattern: string): RegExp {
  const token = "__DOUBLE_STAR__";
  const escaped = pattern.replace(/\*\*/g, token).replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(new RegExp(token, "g"), ".*");
  return new RegExp(`^${escaped}$`);
}

function layerFor(filePath: string, layers: ArchitectureLayer[]): string | undefined {
  const normalized = normalize(filePath);
  return layers.find((layer) => layer.patterns.some((pattern) => globRegex(pattern).test(normalized)))?.name;
}

async function detectedTechnologies(graph: CodeGraph): Promise<{ technologies: string[]; evidence: string[] }> {
  const labels: Record<string, string> = { typescript: "TypeScript", javascript: "JavaScript", python: "Python", go: "Go", rust: "Rust", java: "Java" };
  const indexedLanguages = [...new Set(graph.nodes.flatMap((node) => node.language ? [node.language] : []))];
  const technologies = new Set<string>(indexedLanguages.map((language) => labels[language] ?? language));
  const evidence = new Set<string>(indexedLanguages.map((language) => `${labels[language] ?? language} indexed source graph`));
  try {
    const manifest = JSON.parse(await readFile(path.join(graph.repository.root, "package.json"), "utf8")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    const packages = new Set([...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.devDependencies ?? {})]);
    const mappings: Array<[string, string]> = [
      ["react", "React"], ["next", "Next.js"], ["express", "Express"], ["fastify", "Fastify"],
      ["@nestjs/core", "NestJS"], ["prisma", "Prisma"], ["@prisma/client", "PostgreSQL/Database"],
      ["pg", "PostgreSQL"], ["redis", "Redis"], ["ioredis", "Redis"], ["jest", "Jest"],
      ["vitest", "Vitest"], ["@playwright/test", "Playwright"], ["typescript", "TypeScript"],
    ];
    for (const [packageName, technology] of mappings) {
      if (!packages.has(packageName)) continue;
      technologies.add(technology);
      evidence.add(`package.json declares ${packageName}`);
    }
  } catch { /* package metadata is optional */ }
  const paths = Object.keys(graph.fileHashes);
  if (paths.some((filePath) => /(^|\/)Dockerfile$|docker-compose/.test(filePath))) technologies.add("Docker");
  if (paths.some((filePath) => /(^|\/)migrations?\//.test(filePath))) technologies.add("Database migrations");
  if (paths.some((filePath) => /\.test\.|\.spec\.|(^|\/)tests?\//.test(filePath))) technologies.add("Automated tests");
  return { technologies: [...technologies].sort(), evidence: [...evidence].sort() };
}

function configFingerprint(config: ArchitectureConfig): string {
  return createHash("sha256").update(JSON.stringify(config)).digest("hex");
}

export async function inferArchitecture(graph: CodeGraph): Promise<ArchitectureProposal> {
  const layers = inferredLayers(graph);
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const allowed = Object.fromEntries(layers.map((layer) => [layer.name, [] as string[]]));
  for (const edge of graph.edges) {
    if (edge.kind !== "imports") continue;
    const sourcePath = nodes.get(edge.source)?.path;
    const targetPath = nodes.get(edge.target)?.path;
    if (!sourcePath || !targetPath) continue;
    const sourceLayer = layerFor(sourcePath, layers);
    const targetLayer = layerFor(targetPath, layers);
    if (!sourceLayer || !targetLayer || sourceLayer === targetLayer) continue;
    const targets = allowed[sourceLayer] ?? [];
    if (!targets.includes(targetLayer)) targets.push(targetLayer);
    allowed[sourceLayer] = targets.sort();
  }
  if (allowed.testing) allowed.testing = layers.filter((layer) => layer.name !== "testing").map((layer) => layer.name).sort();
  const intent = Object.fromEntries(layers.map((layer) => {
    const hint = CATEGORY_HINTS.find((candidate) => candidate.name === layer.name);
    return [layer.name, hint?.intent ?? `Project module rooted at ${layer.patterns.join(", ")}.`];
  }));
  const config: ArchitectureConfig = { version: 1, layers, allowedDependencies: allowed, intent };
  const detection = await detectedTechnologies(graph);
  const proposalFingerprint = configFingerprint(config);
  return {
    version: 1,
    status: "proposed",
    generatedAt: new Date().toISOString(),
    repositoryFingerprint: graph.repository.fingerprint,
    proposalFingerprint,
    confidence: Math.min(99, 55 + layers.length * 5 + Math.min(20, detection.evidence.length * 3)),
    detectedTechnologies: detection.technologies,
    evidence: [
      `${layers.length} architectural layer(s) inferred from directory boundaries`,
      `${graph.stats.imports} verified import relationship(s) analyzed`,
      ...detection.evidence,
    ],
    config,
  };
}

export async function writeArchitectureProposal(graph: CodeGraph): Promise<{ path: string; proposal: ArchitectureProposal }> {
  const proposal = await inferArchitecture(graph);
  const destination = path.join(graph.repository.root, ".fehm", "architecture.proposed.json");
  await atomicWriteJson(destination, proposal);
  return { path: destination, proposal };
}

export async function readArchitectureState(graph: CodeGraph): Promise<{ proposal?: ArchitectureProposal; contract?: ArchitectureConfig }> {
  const directory = path.join(graph.repository.root, ".fehm");
  const proposalPath = path.join(directory, "architecture.proposed.json");
  const contractPath = path.join(directory, "architecture.json");
  const state: { proposal?: ArchitectureProposal; contract?: ArchitectureConfig } = {};
  if (await exists(proposalPath)) state.proposal = JSON.parse(await readFile(proposalPath, "utf8")) as ArchitectureProposal;
  if (await exists(contractPath)) state.contract = JSON.parse(await readFile(contractPath, "utf8")) as ArchitectureConfig;
  return state;
}

export async function approveArchitecture(graph: CodeGraph): Promise<{ path: string; contract: ArchitectureConfig }> {
  const state = await readArchitectureState(graph);
  if (!state.proposal) throw new Error("no architecture proposal exists; run architecture propose first");
  if (state.proposal.repositoryFingerprint !== graph.repository.fingerprint) {
    throw new Error("architecture proposal is stale; generate a new proposal for the current graph");
  }
  const contract: ArchitectureConfig = {
    ...state.proposal.config,
    approval: {
      status: "approved",
      approvedAt: new Date().toISOString(),
      source: "developer",
      proposalFingerprint: state.proposal.proposalFingerprint,
    },
  };
  const destination = path.join(graph.repository.root, ".fehm", "architecture.json");
  await atomicWriteJson(destination, contract);
  return { path: destination, contract };
}

export function formatArchitectureProposal(proposal: ArchitectureProposal): string {
  const lines = [
    "# Proposed Architecture",
    "",
    `Confidence: ${proposal.confidence}%`,
    `Technologies: ${proposal.detectedTechnologies.join(", ") || "none detected"}`,
    "",
    "## Layers",
    ...proposal.config.layers.map((layer) => `- ${layer.name}: ${layer.patterns.join(", ")}`),
    "",
    "## Observed dependency baseline",
    ...Object.entries(proposal.config.allowedDependencies ?? {}).map(([source, targets]) => `- ${source} → ${targets.join(", ") || "no other layers"}`),
    "",
    "Review .fehm/architecture.proposed.json, then approve it explicitly.",
  ];
  return `${lines.join("\n")}\n`;
}

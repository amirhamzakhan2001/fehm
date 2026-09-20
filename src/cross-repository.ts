import { readFile } from "node:fs/promises";
import path from "node:path";
import { buildApiContractIntelligence } from "./contract-intelligence.js";
import type { ApiConsumer, ApiEndpointContract, CodeGraph, CrossRepositoryConflict, CrossRepositoryGraph, CrossRepositoryNode } from "./model.js";
import { atomicWriteJson } from "./persistence.js";

interface RepositoryManifest {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

interface RepositoryContext {
  graph: CodeGraph;
  id: string;
  manifest: RepositoryManifest;
  contracts: Awaited<ReturnType<typeof buildApiContractIntelligence>>;
}

function repositoryId(graph: CodeGraph): string {
  return `repository:${graph.repository.name}:${graph.repository.fingerprint.slice(0, 12)}`;
}

async function readManifest(graph: CodeGraph): Promise<RepositoryManifest> {
  try { return JSON.parse(await readFile(path.join(graph.repository.root, "package.json"), "utf8")) as RepositoryManifest; }
  catch { return {}; }
}

function dependencies(manifest: RepositoryManifest): Array<{ name: string; version: string; kind: string }> {
  const result: Array<{ name: string; version: string; kind: string }> = [];
  for (const [section, values] of [
    ["runtime", manifest.dependencies],
    ["development", manifest.devDependencies],
    ["peer", manifest.peerDependencies],
    ["optional", manifest.optionalDependencies],
  ] as const) for (const [name, version] of Object.entries(values ?? {})) result.push({ name, version, kind: section });
  return result;
}

function major(version: string | undefined): number | undefined {
  if (!version || /^(?:workspace:|file:|link:)/.test(version)) return undefined;
  const match = /(?:^|[^0-9])(\d+)(?:\.|$)/.exec(version);
  return match ? Number(match[1]) : undefined;
}

function routeMatches(route: string, consumerEndpoint: string): boolean {
  const endpoint = consumerEndpoint.replace(/^https?:\/\/[^/]+/i, "").split(/[?#]/)[0] || "/";
  const routeSegments = route.replace(/\/$/, "").split("/");
  const endpointSegments = endpoint.replace(/\/$/, "").split("/");
  if (routeSegments.length !== endpointSegments.length) return false;
  return routeSegments.every((segment, index) => /^:[^/]+$|^\{[^/]+\}$/.test(segment) || segment === endpointSegments[index]);
}

function endpointId(repository: RepositoryContext, endpoint: ApiEndpointContract): string {
  return `${repository.id}:api:${endpoint.method}:${endpoint.route}`;
}

function consumerId(repository: RepositoryContext, consumer: ApiConsumer): string {
  return `${repository.id}:consumer:${consumer.path}:${consumer.line}:${consumer.method}:${consumer.endpoint}`;
}

export async function buildCrossRepositoryGraph(graphs: CodeGraph[]): Promise<CrossRepositoryGraph> {
  if (graphs.length < 2) throw new Error("cross-repository analysis requires at least two repository graphs");
  const uniqueRoots = new Set(graphs.map((graph) => path.resolve(graph.repository.root)));
  if (uniqueRoots.size !== graphs.length) throw new Error("cross-repository analysis requires distinct repository roots");
  const manifests = await Promise.all(graphs.map(readManifest));
  const contracts = await Promise.all(graphs.map((graph) => buildApiContractIntelligence(graph)));
  const repositories: RepositoryContext[] = graphs.map((graph, index) => ({ graph, id: repositoryId(graph), manifest: manifests[index] ?? {}, contracts: contracts[index] as Awaited<ReturnType<typeof buildApiContractIntelligence>> }));
  const nodes: CrossRepositoryNode[] = [];
  const edges: CrossRepositoryGraph["edges"] = [];
  const conflicts: CrossRepositoryConflict[] = [];
  const unknowns: string[] = [];
  const packageOwners = new Map<string, RepositoryContext[]>();

  for (const repository of repositories) {
    nodes.push({ id: repository.id, kind: "repository", label: repository.graph.repository.name, repositoryId: repository.id, path: repository.graph.repository.root, metadata: { fingerprint: repository.graph.repository.fingerprint } });
    if (repository.manifest.name) {
      const id = `${repository.id}:package:${repository.manifest.name}`;
      nodes.push({ id, kind: "package", label: repository.manifest.name, repositoryId: repository.id, path: "package.json", metadata: { ...(repository.manifest.version ? { version: repository.manifest.version } : {}) } });
      edges.push({ source: repository.id, target: id, relation: "contains", confidence: 1, evidence: [`${repository.graph.repository.root}/package.json`] });
      const owners = packageOwners.get(repository.manifest.name) ?? []; owners.push(repository); packageOwners.set(repository.manifest.name, owners);
    } else unknowns.push(`${repository.graph.repository.name}: root package.json has no package name; package-level cross-links may be incomplete`);
    for (const endpoint of repository.contracts.endpoints) {
      const id = endpointId(repository, endpoint);
      nodes.push({ id, kind: "api-endpoint", label: `${endpoint.method} ${endpoint.route}`, repositoryId: repository.id, path: endpoint.path, metadata: { framework: endpoint.framework ?? "unknown", line: endpoint.line } });
      edges.push({ source: repository.id, target: id, relation: "contains", confidence: 0.98, evidence: [`${endpoint.path}:${endpoint.line}`, endpoint.framework ?? "unknown framework"] });
    }
    for (const consumer of repository.contracts.consumers) nodes.push({ id: consumerId(repository, consumer), kind: "api-consumer", label: `${consumer.method} ${consumer.endpoint}`, repositoryId: repository.id, path: consumer.path, metadata: { line: consumer.line } });
  }

  for (const [name, owners] of packageOwners) if (owners.length > 1) conflicts.push({ kind: "duplicate-package", repositories: owners.map((item) => item.id), detail: `Package name ${name} is owned by ${owners.length} repositories.`, evidence: owners.map((item) => `${item.graph.repository.root}/package.json`), severity: "high" });

  for (const repository of repositories) for (const dependency of dependencies(repository.manifest)) {
    const owners = packageOwners.get(dependency.name) ?? [];
    const target = owners.find((item) => item.id !== repository.id);
    if (!target) {
      if (dependency.version.startsWith("workspace:")) conflicts.push({ kind: "unresolved-workspace-dependency", repositories: [repository.id], detail: `${repository.manifest.name ?? repository.graph.repository.name} declares workspace dependency ${dependency.name}, but no supplied repository owns it.`, evidence: [`package.json ${dependency.kind} ${dependency.name}@${dependency.version}`], severity: "high" });
      continue;
    }
    const sourcePackage = `${repository.id}:package:${repository.manifest.name ?? repository.graph.repository.name}`;
    const targetPackage = `${target.id}:package:${dependency.name}`;
    if (!nodes.some((node) => node.id === sourcePackage)) nodes.push({ id: sourcePackage, kind: "package", label: repository.manifest.name ?? repository.graph.repository.name, repositoryId: repository.id });
    edges.push({ source: sourcePackage, target: targetPackage, relation: "package-dependency", confidence: 1, evidence: [`${repository.graph.repository.root}/package.json`, `${dependency.kind} ${dependency.name}@${dependency.version}`] });
    const requestedMajor = major(dependency.version); const targetMajor = major(target.manifest.version);
    if (requestedMajor !== undefined && targetMajor !== undefined && requestedMajor !== targetMajor) conflicts.push({ kind: "version-mismatch", repositories: [repository.id, target.id], detail: `${repository.manifest.name ?? repository.graph.repository.name} requests ${dependency.name}@${dependency.version}, but the supplied repository is ${target.manifest.version}.`, evidence: [`requested major ${requestedMajor}`, `provided major ${targetMajor}`], severity: "high" });
  }

  for (const consumerRepository of repositories) for (const consumer of consumerRepository.contracts.consumers) {
    for (const providerRepository of repositories) {
      if (providerRepository.id === consumerRepository.id) continue;
      const routeMatchesInProvider = providerRepository.contracts.endpoints.filter((endpoint) => routeMatches(endpoint.route, consumer.endpoint));
      const endpoint = routeMatchesInProvider.find((candidate) => candidate.method === consumer.method);
      if (endpoint) edges.push({ source: consumerId(consumerRepository, consumer), target: endpointId(providerRepository, endpoint), relation: "api-consumer", confidence: 0.92, evidence: [`${consumer.path}:${consumer.line}`, `${endpoint.path}:${endpoint.line}`, `${consumer.method} ${consumer.endpoint} matches ${endpoint.route}`] });
      else if (routeMatchesInProvider.length) conflicts.push({ kind: "api-method-mismatch", repositories: [consumerRepository.id, providerRepository.id], detail: `${consumerRepository.graph.repository.name} calls ${consumer.method} ${consumer.endpoint}, while ${providerRepository.graph.repository.name} exposes ${routeMatchesInProvider.map((item) => item.method).join(", ")} for the matching route.`, evidence: [`${consumer.path}:${consumer.line}`, ...routeMatchesInProvider.map((item) => `${item.path}:${item.line}`)], severity: "high" });
    }
  }

  const uniqueNodes = [...new Map(nodes.map((node) => [node.id, node])).values()];
  const uniqueEdges = [...new Map(edges.map((edge) => [`${edge.source}:${edge.relation}:${edge.target}`, edge])).values()];
  const uniqueConflicts = [...new Map(conflicts.map((conflict) => [`${conflict.kind}:${conflict.detail}`, conflict])).values()];
  const result: CrossRepositoryGraph = {
    generatedAt: new Date().toISOString(),
    repositories: repositories.map((repository) => ({ id: repository.id, name: repository.graph.repository.name, root: repository.graph.repository.root, fingerprint: repository.graph.repository.fingerprint, ...(repository.manifest.name ? { packageName: repository.manifest.name } : {}), ...(repository.manifest.version ? { packageVersion: repository.manifest.version } : {}) })),
    nodes: uniqueNodes, edges: uniqueEdges, conflicts: uniqueConflicts, unknowns: [...new Set(unknowns)],
    summary: { repositories: repositories.length, packageDependencies: uniqueEdges.filter((edge) => edge.relation === "package-dependency").length, apiConnections: uniqueEdges.filter((edge) => edge.relation === "api-consumer").length, conflicts: uniqueConflicts.length },
  };
  const destination = path.join(graphs[0]?.repository.root as string, ".fehm", "cross-repository", "latest.json");
  await atomicWriteJson(destination, result);
  return result;
}

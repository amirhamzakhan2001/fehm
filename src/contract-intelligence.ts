import { readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import type { ApiConsumer, ApiContractReport, ApiEndpointContract, CodeGraph, InfrastructureGraph, InfrastructureNode } from "./model.js";
import { isInfrastructureArtifact, readRepositoryArtifacts } from "./repository-artifacts.js";
import { atomicWriteJson } from "./persistence.js";

function lineAt(content: string, offset: number): number { return content.slice(0, offset).split(/\r?\n/).length; }
function normalizedRoute(route: string): string { return route.replace(/\$\{[^}]+\}/g, ":param").replace(/:[^/]+/g, ":param").replace(/\{[^/]+\}/g, ":param").replace(/\?.*$/, "").replace(/\/+$/, "") || "/"; }
function routeMatches(contract: string, consumer: string): boolean {
  const expected = normalizedRoute(contract).split("/").filter(Boolean);
  const actual = normalizedRoute(consumer).split("/").filter(Boolean);
  return expected.length === actual.length && expected.every((segment, index) => segment === ":param" || segment === actual[index]);
}

async function sourceFiles(graph: CodeGraph): Promise<Array<{ path: string; content: string }>> {
  const values: Array<{ path: string; content: string }> = [];
  for (const node of graph.nodes) {
    if (node.kind !== "file" || !node.path || node.test) continue;
    try { values.push({ path: node.path, content: await readFile(path.join(graph.repository.root, node.path), "utf8") }); } catch { /* stale graph */ }
  }
  return values;
}

function endpointNode(graph: CodeGraph, filePath: string, line: number) {
  return graph.nodes.filter((node) => node.path === filePath && node.location && node.location.line <= line && (node.location.endLine ?? node.location.line) >= line)
    .sort((a, b) => ((a.location?.endLine ?? 0) - (a.location?.line ?? 0)) - ((b.location?.endLine ?? 0) - (b.location?.line ?? 0)))[0];
}

function parsedSource(filePath: string, content: string): ts.SourceFile {
  const kind = /\.tsx$/i.test(filePath) ? ts.ScriptKind.TSX
    : /\.jsx$/i.test(filePath) ? ts.ScriptKind.JSX
      : /\.[cm]?js$/i.test(filePath) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  return ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true, kind);
}

function staticText(node: ts.Expression | undefined): string | undefined {
  return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined;
}

function propertyName(node: ts.Expression): string | undefined {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node)) return staticText(node.argumentExpression);
  if (ts.isIdentifier(node)) return node.text;
  return undefined;
}

function receiverName(node: ts.Expression): string | undefined {
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) return propertyName(node.expression);
  return undefined;
}

function objectStringProperty(node: ts.Expression | undefined, name: string): string | undefined {
  if (!node || !ts.isObjectLiteralExpression(node)) return undefined;
  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const key = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) ? property.name.text : undefined;
    if (key?.toLowerCase() === name.toLowerCase()) return staticText(property.initializer);
  }
  return undefined;
}

interface SourceContractDiscovery {
  endpoints: Array<{ method: string; route: string; line: number; framework: "express" | "fastify" | "nest"; start: number; end: number }>;
  consumers: Array<{ method: string; endpoint: string; line: number; start: number; end: number }>;
}

function discoverSourceContracts(filePath: string, content: string): SourceContractDiscovery {
  const source = parsedSource(filePath, content);
  const endpoints: SourceContractDiscovery["endpoints"] = [];
  const consumers: SourceContractDiscovery["consumers"] = [];
  const methods = new Set(["get", "post", "put", "patch", "delete", "options", "head"]);
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const called = propertyName(node.expression)?.toLowerCase();
      const receiver = receiverName(node.expression)?.toLowerCase();
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
      const start = node.getStart(source); const end = node.getEnd();
      if (called && methods.has(called) && receiver && ["app", "router", "server", "fastify"].includes(receiver)) {
        const route = staticText(node.arguments[0]);
        if (route) endpoints.push({ method: called.toUpperCase(), route, line, framework: receiver === "fastify" ? "fastify" : "express", start, end });
      } else if (called && ["get", "post", "put", "patch", "delete"].includes(called) && ts.isIdentifier(node.expression)) {
        endpoints.push({ method: called.toUpperCase(), route: staticText(node.arguments[0]) ?? "/", line, framework: "nest", start, end });
      } else if (called === "route") {
        const method = objectStringProperty(node.arguments[0], "method")?.toUpperCase();
        const route = objectStringProperty(node.arguments[0], "url");
        if (method && route && methods.has(method.toLowerCase())) endpoints.push({ method, route, line, framework: "fastify", start, end });
      }
      if (called === "fetch" && ts.isIdentifier(node.expression)) {
        const endpoint = staticText(node.arguments[0]);
        if (endpoint) consumers.push({ method: objectStringProperty(node.arguments[1], "method")?.toUpperCase() ?? "GET", endpoint, line, start, end });
      } else if (called && methods.has(called) && receiver === "axios") {
        const endpoint = staticText(node.arguments[0]);
        if (endpoint) consumers.push({ method: called.toUpperCase(), endpoint, line, start, end });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { endpoints, consumers };
}

export async function buildApiContractIntelligence(graph: CodeGraph, before?: CodeGraph | ApiContractReport): Promise<ApiContractReport> {
  const files = await sourceFiles(graph);
  const endpoints: ApiEndpointContract[] = [];
  const consumers: ApiConsumer[] = [];
  for (const file of files) {
    const discovered = discoverSourceContracts(file.path, file.content);
    for (const endpoint of discovered.endpoints) {
      const owner = endpointNode(graph, file.path, endpoint.line);
      const nearby = file.content.slice(endpoint.start, Math.min(file.content.length, endpoint.end + 1_200));
      endpoints.push({ id: `api:${endpoint.method}:${normalizedRoute(endpoint.route)}:${file.path}:${endpoint.line}`, method: endpoint.method, route: endpoint.route, path: file.path, line: endpoint.line, ...(owner ? { node: owner } : {}), consumers: [], requestSignals: [...new Set([...nearby.matchAll(/\b(?:body|params|query)\.([A-Za-z_$][\w$]*)/g)].map((item) => item[1] as string))], responseSignals: [...new Set([...nearby.matchAll(/\b(?:json|send)\s*\(\s*\{([^}]{0,500})\}/g)].flatMap((item) => [...String(item[1]).matchAll(/([A-Za-z_$][\w$]*)\s*:/g)].map((field) => field[1] as string)))], framework: endpoint.framework });
    }
    const nextRoute = /(?:^|\/)app\/api\/(.+)\/route\.[cm]?[jt]sx?$/.exec(file.path);
    if (nextRoute) for (const match of file.content.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/g)) {
      const method = match[1] as string; const route = `/api/${(nextRoute[1] ?? "").replace(/\[([^\]]+)\]/g, ":$1")}`; const line = lineAt(file.content, match.index ?? 0);
      endpoints.push({ id: `api:${method}:${normalizedRoute(route)}:${file.path}:${line}`, method, route, path: file.path, line, consumers: [], requestSignals: [], responseSignals: [], framework: "next" });
    }
    for (const consumer of discovered.consumers) {
      const nearby = file.content.slice(consumer.start, Math.min(file.content.length, consumer.end + 800));
      consumers.push({ path: file.path, line: consumer.line, method: consumer.method, endpoint: consumer.endpoint, requestSignals: [...new Set([...nearby.matchAll(/JSON\.stringify\s*\(\s*\{([^}]{0,500})\}/g)].flatMap((item) => [...String(item[1]).matchAll(/([A-Za-z_$][\w$]*)\s*:/g)].map((field) => field[1] as string)))] });
    }
  }
  const specs = await readRepositoryArtifacts(graph.repository.root, (relative) => /(?:openapi|swagger).*(?:\.json|\.ya?ml)$/i.test(relative));
  for (const spec of specs) {
    if (/\.json$/i.test(spec.path)) {
      try {
        const value = JSON.parse(spec.content) as { paths?: Record<string, Record<string, unknown>> };
        for (const [route, methods] of Object.entries(value.paths ?? {})) for (const method of Object.keys(methods)) if (/^(get|post|put|patch|delete|options|head)$/i.test(method)) endpoints.push({ id: `api:${method.toUpperCase()}:${normalizedRoute(route)}:${spec.path}:1`, method: method.toUpperCase(), route, path: spec.path, line: 1, consumers: [], requestSignals: [], responseSignals: [], framework: "openapi" });
      } catch { /* malformed specifications are ignored by contract discovery */ }
    } else {
      let route: string | undefined; let routeLine = 1;
      for (const [index, line] of spec.content.split(/\r?\n/).entries()) {
        const pathMatch = /^\s{0,4}(\/[^:]+):\s*$/.exec(line); if (pathMatch) { route = pathMatch[1]; routeLine = index + 1; continue; }
        const methodMatch = /^\s+(get|post|put|patch|delete|options|head):\s*$/i.exec(line);
        if (route && methodMatch) endpoints.push({ id: `api:${methodMatch[1]?.toUpperCase()}:${normalizedRoute(route)}:${spec.path}:${routeLine}`, method: methodMatch[1]?.toUpperCase() ?? "GET", route, path: spec.path, line: routeLine, consumers: [], requestSignals: [], responseSignals: [], framework: "openapi" });
      }
    }
  }
  for (const endpoint of endpoints) {
    const owner = files.find((file) => file.path === endpoint.path)?.content ?? "";
    const body = endpoint.node?.location ? owner.split(/\r?\n/).slice(endpoint.node.location.line - 1, endpoint.node.location.endLine).join("\n") : "";
    const requestSignals = [...new Set([...body.matchAll(/\b(?:body|params|query)\.([A-Za-z_$][\w$]*)/g)].map((match) => match[1] as string))];
    const responseSignals = [...new Set([...body.matchAll(/\b(?:json|send)\s*\(\s*\{([^}]{0,300})\}/g)].flatMap((match) => [...String(match[1]).matchAll(/([A-Za-z_$][\w$]*)\s*:/g)].map((item) => item[1] as string)))];
    if (requestSignals.length) endpoint.requestSignals = [...new Set([...endpoint.requestSignals, ...requestSignals])];
    if (responseSignals.length) endpoint.responseSignals = [...new Set([...endpoint.responseSignals, ...responseSignals])];
  }
  for (const consumer of consumers) {
    const route = normalizedRoute(consumer.endpoint.replace(/^https?:\/\/[^/]+/, ""));
    const exact = endpoints.find((item) => routeMatches(item.route, route) && item.method === consumer.method);
    const routeOnly = endpoints.find((item) => routeMatches(item.route, route));
    if (exact) { consumer.matchedEndpointId = exact.id; exact.consumers.push(consumer); } else if (routeOnly) consumer.matchedEndpointId = routeOnly.id;
  }
  const mismatches: ApiContractReport["mismatches"] = [];
  for (const consumer of consumers) {
    if (/\$\{|\+/.test(consumer.endpoint)) mismatches.push({ kind: "dynamic-contract", detail: `${consumer.method} ${consumer.endpoint} is dynamic and requires runtime validation`, path: consumer.path, line: consumer.line });
    else if (!consumer.matchedEndpointId) mismatches.push({ kind: "missing-endpoint", detail: `${consumer.method} ${consumer.endpoint} has no matching backend route`, path: consumer.path, line: consumer.line });
    else { const matched = endpoints.find((item) => item.id === consumer.matchedEndpointId); if (matched && matched.method !== consumer.method) mismatches.push({ kind: "method-mismatch", detail: `${consumer.method} ${consumer.endpoint} maps to ${matched.method} ${matched.route}`, path: consumer.path, line: consumer.line }); }
    const matched = endpoints.find((item) => item.id === consumer.matchedEndpointId);
    const missingFields = (consumer.requestSignals ?? []).filter((field) => matched?.requestSignals.length && !matched.requestSignals.includes(field));
    if (matched && missingFields.length) mismatches.push({ kind: "request-schema-mismatch", detail: `${consumer.method} ${consumer.endpoint} sends unknown field(s): ${missingFields.join(", ")}`, path: consumer.path, line: consumer.line });
  }
  for (const endpoint of endpoints.filter((item) => !item.consumers.length)) mismatches.push({ kind: "unused-endpoint", detail: `${endpoint.method} ${endpoint.route} has no statically detected consumer`, path: endpoint.path, line: endpoint.line });
  const breakingChanges: ApiContractReport["breakingChanges"] = [];
  let previous: ApiContractReport | undefined;
  if (before) previous = "endpoints" in before ? before : await buildApiContractIntelligence(before);
  else {
    try { previous = JSON.parse(await readFile(path.join(graph.repository.root, ".fehm", "api-contract", "latest.json"), "utf8")) as ApiContractReport; } catch { /* first contract scan */ }
  }
  if (previous && previous.repositoryFingerprint !== graph.repository.fingerprint) {
    for (const endpoint of previous.endpoints) if (!endpoints.some((item) => item.method === endpoint.method && normalizedRoute(item.route) === normalizedRoute(endpoint.route))) {
      const replacement = endpoints.find((item) => normalizedRoute(item.route) === normalizedRoute(endpoint.route));
      breakingChanges.push(replacement ? { kind: "method-changed", detail: `${endpoint.method} ${endpoint.route} changed to ${replacement.method}` } : { kind: "removed-endpoint", detail: `${endpoint.method} ${endpoint.route} was removed` });
    }
  }
  const report: ApiContractReport = { generatedAt: new Date().toISOString(), repositoryFingerprint: graph.repository.fingerprint, endpoints, consumers, mismatches, breakingChanges, confidence: endpoints.length || consumers.length ? 90 : 50 };
  await atomicWriteJson(path.join(graph.repository.root, ".fehm", "api-contract", "latest.json"), report);
  return report;
}

function addInfraNode(map: Map<string, InfrastructureNode>, node: InfrastructureNode): void {
  const existing = map.get(node.id); map.set(node.id, existing ? { ...existing, evidence: [...new Set([...existing.evidence, ...node.evidence])] } : node);
}

export async function buildInfrastructureGraph(graph: CodeGraph): Promise<InfrastructureGraph> {
  const files = await sourceFiles(graph); const nodes = new Map<string, InfrastructureNode>(); const edges: InfrastructureGraph["edges"] = [];
  const codeNode = (file: string): string => `code:${file}`;
  for (const file of files) {
    addInfraNode(nodes, { id: codeNode(file.path), kind: "service", name: file.path, path: file.path, evidence: ["indexed source file"] });
    for (const match of file.content.matchAll(/(?:process\.env|import\.meta\.env)\.([A-Z][A-Z0-9_]*)/g)) { const id = `env:${match[1]}`; addInfraNode(nodes, { id, kind: "environment", name: match[1] as string, evidence: [`${file.path}:${lineAt(file.content, match.index ?? 0)}`] }); edges.push({ source: codeNode(file.path), target: id, relation: "uses", evidence: match[0] }); }
    for (const match of file.content.matchAll(/https?:\/\/([A-Za-z0-9.-]+)/g)) { const id = `external:${match[1]}`; addInfraNode(nodes, { id, kind: "external-api", name: match[1] as string, evidence: [`${file.path}:${lineAt(file.content, match.index ?? 0)}`] }); edges.push({ source: codeNode(file.path), target: id, relation: "connects-to", evidence: match[0] }); }
    const packageSignals: Array<[RegExp, InfrastructureNode["kind"], string]> = [[/\b(?:pg|postgres|prisma|mysql|mongodb|mongoose|redis|ioredis)\b/i, "database", "database"], [/\b(?:kafka|rabbitmq|amqplib|bullmq|sqs)\b/i, "queue", "message-queue"], [/\b(?:aws-sdk|@aws-sdk|google-cloud|@azure)\b/i, "cloud", "cloud-provider"]];
    for (const [pattern, kind, name] of packageSignals) if (pattern.test(file.content)) { const id = `${kind}:${name}`; addInfraNode(nodes, { id, kind, name, evidence: [file.path] }); edges.push({ source: codeNode(file.path), target: id, relation: "uses", evidence: `package or API signal in ${file.path}` }); }
  }
  const artifacts = await readRepositoryArtifacts(graph.repository.root, isInfrastructureArtifact);
  const declaredEnvironment = new Set<string>();
  for (const artifact of artifacts) {
    const artifactId = `service:${artifact.path}`;
    addInfraNode(nodes, { id: artifactId, kind: "service", name: artifact.path, path: artifact.path, evidence: ["infrastructure artifact"] });
    if (/(?:^|\/)\.env(?:\.|$)/i.test(artifact.path)) for (const match of artifact.content.matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*=/gm)) {
      const name = match[1] as string; declaredEnvironment.add(name); const id = `env:${name}`;
      addInfraNode(nodes, { id, kind: "environment", name, path: artifact.path, evidence: [`declared in ${artifact.path}`] }); edges.push({ source: artifactId, target: id, relation: "declares", evidence: match[0].trim() });
    }
    if (/Dockerfile/i.test(path.basename(artifact.path))) {
      const id = `container:${artifact.path}`; addInfraNode(nodes, { id, kind: "container", name: path.basename(artifact.path), path: artifact.path, evidence: ["Dockerfile"] }); edges.push({ source: artifactId, target: id, relation: "declares", evidence: "container build" });
      for (const match of artifact.content.matchAll(/^FROM\s+([^\s]+)/gmi)) { const image = `external:${match[1]}`; addInfraNode(nodes, { id: image, kind: "external-api", name: match[1] as string, evidence: [artifact.path] }); edges.push({ source: id, target: image, relation: "depends-on", evidence: match[0] }); }
    }
    if (/(?:docker-)?compose.*\.ya?ml$/i.test(artifact.path)) {
      const lines = artifact.content.split(/\r?\n/); let inServices = false; let current: string | undefined; let inDependsOn = false;
      for (const line of lines) {
        if (/^services:\s*$/.test(line)) { inServices = true; continue; }
        if (inServices && /^\S/.test(line)) { inServices = false; current = undefined; inDependsOn = false; }
        const service = inServices ? /^\s{2}([A-Za-z0-9_.-]+):\s*$/.exec(line)?.[1] : undefined;
        if (service) { current = `container:${service}`; inDependsOn = false; addInfraNode(nodes, { id: current, kind: "container", name: service, path: artifact.path, evidence: ["Compose service"] }); edges.push({ source: artifactId, target: current, relation: "declares", evidence: line.trim() }); continue; }
        if (current && /^\s{4}depends_on:\s*$/.test(line)) { inDependsOn = true; continue; }
        if (current && /^\s{4}[A-Za-z0-9_.-]+:\s*/.test(line)) inDependsOn = false;
        const dependency = current && inDependsOn ? /^\s{6}-\s*([A-Za-z0-9_.-]+)\s*$/.exec(line)?.[1] : undefined;
        if (current && dependency) { const target = `container:${dependency}`; addInfraNode(nodes, { id: target, kind: "container", name: dependency, path: artifact.path, evidence: ["Compose dependency"] }); edges.push({ source: current, target, relation: "depends-on", evidence: line.trim() }); }
      }
    }
    if (/\.ya?ml$/i.test(artifact.path)) for (const match of artifact.content.matchAll(/\bkind:\s*(Deployment|Service|StatefulSet|CronJob)[\s\S]{0,500}?\bname:\s*([^\s]+)/g)) {
      const id = `k8s:${match[2]}`; addInfraNode(nodes, { id, kind: "kubernetes", name: match[2] as string, path: artifact.path, evidence: [match[1] as string] }); edges.push({ source: artifactId, target: id, relation: "declares", evidence: match[0].slice(0, 120) });
    }
    if (/\.tf$/i.test(artifact.path)) for (const match of artifact.content.matchAll(/resource\s+"([^"]+)"\s+"([^"]+)"/g)) {
      const id = `terraform:${match[1]}.${match[2]}`; addInfraNode(nodes, { id, kind: "terraform", name: `${match[1]}.${match[2]}`, path: artifact.path, evidence: [match[0]] }); edges.push({ source: artifactId, target: id, relation: "declares", evidence: match[0] });
    }
  }
  const uniqueEdges = [...new Map(edges.map((edge) => [`${edge.source}:${edge.relation}:${edge.target}`, edge])).values()];
  const unknowns = [...nodes.values()].filter((node) => node.kind === "environment" && !declaredEnvironment.has(node.name)).map((node) => `Environment variable ${node.name} is consumed but no local declaration was indexed.`);
  return { nodes: [...nodes.values()], edges: uniqueEdges, unknowns };
}

import { createHash } from 'node:crypto';
import { join } from 'node:path';
import ts from 'typescript';
import type { FehmEngine } from '../engine.js';
import { BriefingFacts } from '../codebase-briefing/facts.js';
import { readJson, stateDir, writeJsonAtomic } from '../persistence.js';
import { splitIdentifier } from '../text.js';
import { optionalGit } from '../git-memory/git.js';
import type { SecurityReport } from '../security/types.js';
import type { HealthReport } from '../health/types.js';
import type { PromptReport } from '../prompts/types.js';
import { redactLine } from '../security/secrets.js';
import { OntologyIndex, normalizeConceptTerm } from './catalog.js';
import { CONCEPT_ANALYZER_VERSION, type ConceptFinding, type ConceptOptions, type ConceptReport, type ConceptScope, type ConceptStatus } from './types.js';
const digest = (s: string) => createHash('sha256').update(s).digest('hex');
interface Observation {
    concept: string;
    path: string;
    line: number;
    nodeId: string | null;
    status: ConceptStatus;
    scope: ConceptScope;
    method: string;
    rationale: string;
    limits: string[];
}
export const CONCEPT_RULES = ['catalog-mention', 'symbol-vocabulary', 'async-syntax', 'retry-loop-candidate', 'cache-flow-candidate', 'route-declaration', 'dependency-hint', 'security-control-adapter', 'prompt-adapter', 'health-adapter'];
class MentionMatcher {
    private terms = new Map<string, string[]>();
    private max = 1;
    constructor(ontology: OntologyIndex) {
        for (const { term, id } of ontology.terms()) {
            if (term.length < 4 && !['dfa', 'lsp', 'rag', 'c++', 'c#', 'sql', 'api', 'jwt', 'tls', 'ai', 'ml'].includes(term))
                continue;
            const words = term.split(' ');
            if (words.length > 10)
                continue;
            this.max = Math.max(this.max, words.length);
            this.terms.set(term, [...(this.terms.get(term) ?? []), id]);
        }
    }
    match(text: string): string[] {
        const words = (normalizeConceptTerm(text).match(/[\p{L}\p{N}+#./]+/gu) ?? []).map(w => w.replace(/[.]+$/u, '')), ids = new Set<string>();
        for (let i = 0; i < Math.min(words.length, 500); i++)
            for (let n = 1; n <= this.max && i + n <= words.length; n++)
                for (const id of this.terms.get(words.slice(i, i + n).join(' ')) ?? [])
                    ids.add(id);
        return [...ids];
    }
}
export interface ConceptInputs {
    engine: FehmEngine;
    ontology: OntologyIndex;
    facts?: BriefingFacts;
    security?: SecurityReport;
    health?: HealthReport;
    prompts?: PromptReport;
    options?: ConceptOptions;
}
export function analyzeConcepts({ engine, ontology, facts = new BriefingFacts(engine), security, health, prompts, options = {} }: ConceptInputs): ConceptReport {
    const cachePath = join(stateDir(engine.root, options.stateDirectory), 'concept-evidence.json');
    const key = `${CONCEPT_ANALYZER_VERSION}:${ontology.hash}`;
    const stored = readJson<{
        key: string;
        root: string;
        files: Record<string, {
            hash: string;
            observations: Observation[];
        }>;
    }>(cachePath);
    const old = stored.ok && stored.value?.key === key && stored.value.root === engine.root && stored.value.files && typeof stored.value.files === 'object' && !options.force ? stored.value.files : {};
    const files: Record<string, {
        hash: string;
        observations: Observation[];
    }> = {}, observations: Observation[] = [];
    let analyzed = 0, reused = 0;
    const matcher = new MentionMatcher(ontology);
    const add = (concept: string, path: string, line: number, status: ConceptStatus, scope: ConceptScope, method: string, rationale: string, limits: string[] = [], nodeId: string | null = null): Observation => ({ concept, path, line, status, scope, method, rationale, limits, nodeId });
    for (const { node, path, role } of facts.files) {
        const hash = engine.fileHashes().get(path) ?? '';
        const prev = old[path];
        let found: Observation[] = [];
        if (prev?.hash === hash && Array.isArray(prev.observations)) {
            found = prev.observations;
            reused++;
        }
        else {
            analyzed++;
            const lines = facts.lines(path);
            const seen = new Set<string>();
            const mention = (text: string, line: number, scope: ConceptScope, id: string | null) => {
                for (const concept of matcher.match(text)) {
                    const dedup = `${concept}:${scope}`;
                    if (seen.has(dedup) || seen.size >= 80)
                        continue;
                    seen.add(dedup);
                    found.push(add(concept, path, line, scope === 'documented_claim' ? 'explicitly_observed' : 'weakly_indicated', scope, 'catalog-mention', scope === 'documented_claim' ? 'The text mentions this engineering vocabulary; this is a documented reference, not verified implementation.' : 'A declaration matches reviewed concept vocabulary; its name alone does not establish behavior.', ['Aliases may be ambiguous; each meaning remains a candidate.', 'Documentation and names do not establish implementation or deployment.'], id));
                }
            };
            if (role === 'docs')
                lines.slice(0, 2000).forEach((line, i) => mention(line, i + 1, 'documented_claim', node.id));
            else {
                for (const symbol of facts.symbolsIn(path))
                    mention(splitIdentifier(symbol.name).join(' '), symbol.location?.line ?? 1, 'declaration', symbol.id);
                lines.slice(0, 2000).forEach((line, i) => { if (/^\s*(?:\/\/|#|\/\*|\*)/.test(line))
                    mention(line, i + 1, 'documented_claim', node.id); });
            }
            // Concept-specific syntax rules consume the same indexed files and map back to graph nodes.
            // They neither build a second call graph nor claim runtime reachability.
            if (/\.[cm]?[jt]sx?$/.test(path) && lines.length <= 20000) {
                const source = ts.createSourceFile(path, lines.join('\n'), ts.ScriptTarget.Latest, true);
                let asyncFound = false;
                const visit = (n: ts.Node) => {
                    if (ts.isAwaitExpression(n) && !asyncFound) {
                        asyncFound = true;
                        const line = source.getLineAndCharacterOfPosition(n.getStart(source)).line + 1;
                        found.push(add('p-flow.asynchronous-execution', path, line, 'explicitly_observed', 'implementation', 'async-syntax', 'An await expression coordinates completion in indexed source.', ['This establishes syntax, not nonblocking execution, active deployment or runtime performance.'], facts.enclosing(path, line)?.id ?? node.id));
                    }
                    if (ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n) || ts.isArrowFunction(n) || ts.isFunctionExpression(n)) {
                        const body = n.body;
                        if (body) {
                            const line = source.getLineAndCharacterOfPosition(n.getStart(source)).line + 1;
                            let boundedLoop = false, catchClause = false, call = false, lookup = false, store = false, returns = false;
                            const walk = (x: ts.Node) => {
                                if (x !== body && (ts.isFunctionDeclaration(x) || ts.isArrowFunction(x) || ts.isFunctionExpression(x)))
                                    return;
                                if (ts.isForStatement(x) && x.condition && x.incrementor)
                                    boundedLoop = true;
                                if (ts.isCatchClause(x))
                                    catchClause = true;
                                if (ts.isCallExpression(x)) {
                                    call = true;
                                    const e = x.expression;
                                    if (ts.isPropertyAccessExpression(e)) {
                                        if (e.name.text === 'get' || e.name.text === 'has')
                                            lookup = true;
                                        if (e.name.text === 'set')
                                            store = true;
                                    }
                                }
                                if (ts.isReturnStatement(x))
                                    returns = true;
                                ts.forEachChild(x, walk);
                            };
                            walk(body);
                            const id = facts.enclosing(path, line)?.id ?? node.id;
                            if (boundedLoop && catchClause && call)
                                found.push(add('s27.retry-mechanism', path, line, 'contextually_inferred', 'implementation', 'retry-loop-candidate', 'A function combines a conditioned incrementing loop, exception handling and calls; review failure-dependent retry control flow.', ['The loop may not bound failed-operation retries. Idempotency, reachability, retry budget and backoff are not proven.'], id));
                            if (lookup && store && returns)
                                found.push(add('s28.caching', path, line, 'contextually_inferred', 'implementation', 'cache-flow-candidate', 'A function combines get/has, set and return operations; this is a candidate cache flow.', ['Receivers may differ or implement unrelated methods. Hit/miss data flow and retained reuse require review.'], id));
                        }
                    }
                    ts.forEachChild(n, visit);
                };
                visit(source);
            }
        }
        files[path] = { hash, observations: found };
        observations.push(...found);
    }
    for (const route of facts.signals.routes) {
        const id = route.handler?.id ?? route.enclosing?.id ?? null;
        const supported = route.handler?.evidence.provenance === 'type-checker' || engine.graph.nodes().some(n => n.kind === 'route' && n.path === route.path && n.location?.line === route.line && n.evidence.provenance === 'ast');
        observations.push(add('s29.routing', route.path, route.line, supported ? 'structurally_supported' : 'weakly_indicated', 'declaration', 'route-declaration', `${route.method} ${route.route}: route evidence from Explain Codebase${route.handler ? ' with a mapped handler' : ''}.`, ['Registration does not prove deployment, reachability or successful requests.'], id));
    }
    const dependencies: Record<string, string[]> = { 'express-rate-limit': ['s29.rate-limiting'], opossum: ['s22.circuit-breaker'], 'p-retry': ['s27.retry-mechanism'], redis: ['s28.caching'], ioredis: ['s28.caching'], langchain: ['s48.retrieval-augmented-generation'], 'llama-index': ['s48.retrieval-augmented-generation'], pg: ['s19.connection-pooling'] };
    for (const dep of facts.declaredDependencies)
        for (const concept of dependencies[dep.name] ?? [])
            observations.push(add(concept, dep.path, dep.line, 'weakly_indicated', 'declaration', 'dependency-hint', `Manifest declares ${dep.name}${dep.dev ? ' as a development dependency' : ''}.`, ['An installed or declared dependency does not prove active usage.']));
    const controls: Record<string, string> = { authentication: 's39.authentication', authorization: 's39.authorization', 'rate-limiting': 's29.rate-limiting' };
    for (const control of security?.controls ?? []) {
        const concept = controls[control.id];
        if (!concept)
            continue;
        for (const e of control.evidence)
            observations.push(add(concept, e.path, e.line ?? 1, 'weakly_indicated', 'declaration', 'security-control-adapter', `Security Review control inventory: ${control.summary}`, ['Control inventory can include import/name clues; it does not establish enforcement on all paths.']));
    }
    for (const p of prompts?.prompts ?? [])
        observations.push(add('s48.prompt-engineering', p.path, p.line, p.reconstruction === 'complete' ? 'explicitly_observed' : 'weakly_indicated', 'declaration', 'prompt-adapter', `Prompt Intelligence reconstructed ${p.kind} instructions (${p.reconstruction}).`, ['Prompt presence and static scores do not prove behavioral quality or RAG.'], p.functionId ?? p.fileId));
    for (const d of health?.deadCode.items ?? [])
        observations.push(add('p-quality.dead-code', d.path, d.line ?? 1, 'weakly_indicated', 'declaration', 'health-adapter', `Project Health candidate: ${d.state}.`, ['Static reference absence does not prove runtime dead code.'], d.nodeId ?? null));
    const revision = optionalGit(engine.root, ['rev-parse', '--verify', 'HEAD']), status = optionalGit(engine.root, ['status', '--porcelain']);
    const valid = observations.filter(o => ontology.get(o.concept) && engine.fileHashes().has(o.path) && o.line >= 1 && o.line <= facts.lines(o.path).length);
    const findings: ConceptFinding[] = [...new Map(valid.map(o => {
            const nodeId = o.nodeId && engine.graph.node(o.nodeId) ? o.nodeId : facts.enclosing(o.path, o.line)?.id ?? null;
            const edgeIds = nodeId ? engine.graph.edgesOf(nodeId, 'both', ['calls', 'imports', 'references']).map(e => e.id).slice(0, 20) : [];
            const id = digest(`${o.concept}:${o.path}:${o.line}:${o.method}:${o.scope}`);
            const guidance = ontology.guidance(o.concept);
            const f: ConceptFinding = { id, concept_id: o.concept, status: o.status, scope: o.scope, evidence: [{ id: `e:${id}`, path: o.path, line: o.line, endLine: o.line, nodeId, provenance: o.method === 'async-syntax' ? 'ast' : o.method === 'route-declaration' ? 'existing-graph' : 'heuristic', method: o.method, detail: o.rationale, edgeIds }], rationale: o.rationale, limitations: [...o.limits, ...(guidance.limit ? [guidance.limit] : [])], counterevidence: [], repository_revision: revision, analyzer_version: CONCEPT_ANALYZER_VERSION, ontology_version: ontology.version };
            return [id, f] as const;
        })).values()].sort((a, b) => a.concept_id.localeCompare(b.concept_id) || a.evidence[0]!.path.localeCompare(b.evidence[0]!.path));
    if (!options.dryRun)
        writeJsonAtomic(cachePath, { key, root: engine.root, files });
    return { version: CONCEPT_ANALYZER_VERSION, ontologyVersion: ontology.version, ontologyHash: ontology.hash, generatedAt: new Date().toISOString(), repositoryRevision: revision, dirty: status === null ? null : status.length > 0, fingerprint: digest([...engine.fileHashes()].sort().map(([p, h]) => `${p}:${h}`).join('\n')), findings, coverage: { files: Object.keys(files).length, analyzed, reused, removed: Object.keys(old).filter(p => !files[p]).length, supportedDetectors: CONCEPT_RULES, limitations: ['No evidence means unknown, not absence. Runtime/deployment/operation evidence is not connected.', 'Name/document/dependency matches never establish implemented architecture or enforced security.', 'JS/TS syntax rules are bounded to 20,000 lines; vocabulary scans cover 2,000 lines and 80 concept/scope pairs per file.', 'Reflection, dynamic dispatch, generated code and unsupported languages can hide implementation.', 'Cross-file links are recomputed from the current graph; cached local evidence is keyed by content, catalog and rule versions.', ...(!security ? ['Security results were not supplied.'] : []), ...(!health ? ['Health results were not supplied.'] : []), ...(!prompts ? ['Prompt results were not supplied.'] : [])] } };
}
export function conceptAssessment(report: ConceptReport, ontology: OntologyIndex, id: string) {
    const concept = ontology.get(id);
    if (!concept)
        throw new Error('Unknown concept');
    const findings = report.findings.filter(f => f.concept_id === id);
    const profile = concept.detection.profile;
    const scope: ConceptScope = profile === 'metric' ? 'measurement' : profile === 'operational' ? 'operation' : profile === 'deployment' ? 'deployment' : 'implementation';
    return { concept, guidance: ontology.guidance(id), findings, unverified: { status: 'not_verifiable' as const, scope, reason: findings.length ? 'Evidence above is scoped. Broader behavior, active deployment and achieved properties are not established.' : 'No supported evidence was found in the analyzed scope; this is not proof of absence.' }, coverage: report.coverage };
}
export function conceptExcerpt(engine: FehmEngine, path: string, line: number) {
    if (!engine.fileHashes().has(path) || !Number.isInteger(line) || line < 1)
        throw new Error('Source must be an indexed file with a positive line');
    const lines = engine.sourceLines(path) ?? [], start = Math.max(1, line - 3);
    if (line > lines.length)
        throw new Error('Line outside file');
    return { path, start, lines: lines.slice(start - 1, line + 5).map(redactLine) };
}

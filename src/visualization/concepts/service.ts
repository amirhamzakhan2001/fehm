import type { FehmEngine } from '../../engine.js';
import { stateDir } from '../../persistence.js';
import { OntologyIndex } from '../../concepts/catalog.js';
import { analyzeConcepts, conceptAssessment, conceptExcerpt } from '../../concepts/analysis.js';
import { conceptContext } from '../../concepts/context.js';
import type { ConceptOptions, ConceptReport } from '../../concepts/types.js';
import { ArchitectureService } from '../architecture/service.js';
import { SecurityService } from '../security/service.js';
import { HealthService } from '../health/service.js';
import { PromptService } from '../prompts/service.js';
import { entityGitHistory, indexGitMemory } from '../../git-memory/history.js';
import type { SecurityReport } from '../../security/types.js';
import type { HealthReport } from '../../health/types.js';
import type { PromptReport } from '../../prompts/types.js';
export interface ConceptServiceOptions extends ConceptOptions {
    architecture?: ArchitectureService;
    security?: SecurityService;
    health?: HealthService;
    prompts?: PromptService;
}
export class ConceptService {
    private indices = new Map<string, OntologyIndex>();
    private reports = new WeakMap<FehmEngine, {
        report: ConceptReport;
        security: SecurityReport;
        health: HealthReport;
        prompts: PromptReport;
    }>();
    private architecture: ArchitectureService;
    private security: SecurityService;
    private health: HealthService;
    private prompts: PromptService;
    constructor(private options: ConceptServiceOptions = {}) {
        this.architecture = options.architecture ?? new ArchitectureService(options);
        this.security = options.security ?? new SecurityService({ ...options, architecture: this.architecture });
        this.health = options.health ?? new HealthService({ ...options, architecture: this.architecture });
        this.prompts = options.prompts ?? new PromptService({ ...options, architecture: this.architecture, security: this.security });
    }
    index(engine: FehmEngine): OntologyIndex { let index = this.indices.get(engine.root); if (!index) {
        index = OntologyIndex.open({ stateDirectory: stateDir(engine.root, this.options.stateDirectory), memory: !!this.options.dryRun });
        this.indices.set(engine.root, index);
    } return index; }
    refreshCatalog(engine: FehmEngine) {
        const replacement = OntologyIndex.open({ stateDirectory: stateDir(engine.root, this.options.stateDirectory), memory: !!this.options.dryRun });
        const previous = this.indices.get(engine.root);
        this.indices.set(engine.root, replacement);
        previous?.close();
        this.reports = new WeakMap();
    }
    close() { for (const index of this.indices.values())
        index.close(); this.indices.clear(); }
    report(engine: FehmEngine): ConceptReport {
        const security = this.security.report(engine), health = this.health.report(engine), prompts = this.prompts.report(engine), cached = this.reports.get(engine);
        if (cached && cached.security === security && cached.health === health && cached.prompts === prompts)
            return cached.report;
        const report = analyzeConcepts({ engine, ontology: this.index(engine), facts: this.architecture.facts(engine), security, health, prompts, options: this.options });
        this.reports.set(engine, { report, security, health, prompts });
        return report;
    }
    detail(engine: FehmEngine, id: string) {
        const assessment = conceptAssessment(this.report(engine), this.index(engine), id), paths = new Set(assessment.findings.flatMap(f => f.evidence.map(e => e.path)));
        const model = this.architecture.model(engine), facts = this.architecture.facts(engine);
        return { ...assessment, components: model.nodes.filter(n => n.files.some(p => paths.has(p)) && n.type !== 'file').map(n => ({ id: n.id, name: n.name, type: n.type })), tests: facts.testFiles.filter(p => [...(facts.fileDeps.out.get(p) ?? [])].some(d => paths.has(d))).map(path => ({ path, evidence: 'Static file dependency; not measured behavioral coverage' })), neighborhood: this.graph(engine, id) };
    }
    graph(engine: FehmEngine, id: string) {
        const report = this.report(engine), concept = this.index(engine).get(id);
        if (!concept)
            throw new Error('Unknown concept');
        const findings = report.findings.filter(f => f.concept_id === id), nodeIds = [...new Set(findings.flatMap(f => f.evidence.flatMap(e => e.nodeId ? [e.nodeId] : [])))].slice(0, 100);
        const edges = findings.flatMap(f => f.evidence.filter(e => e.nodeId && nodeIds.includes(e.nodeId)).map(e => ({ source: `concept:${id}`, target: e.nodeId!, kind: ['structurally_supported', 'explicitly_observed'].includes(f.status) && f.scope === 'implementation' ? 'implemented_by' : e.path.endsWith('.json') && f.scope === 'declaration' ? 'configured_by' : 'referenced_by', evidence: e.id, status: f.status, scope: f.scope })));
        const calls = engine.graph.edges().filter(e => nodeIds.includes(e.source) && nodeIds.includes(e.target) && ['calls', 'imports', 'uses', 'references'].includes(e.kind));
        return { concept: { id: `concept:${id}`, name: concept.name }, nodes: nodeIds.map(i => engine.graph.node(i)!), edges, codeEdges: calls, highlightIds: nodeIds, graphUrl: `/graph#concept=${encodeURIComponent(id)}`, note: 'Existing Codebase Graph node/edge IDs; concept relationships are an overlay, not a second code graph.' };
    }
    history(engine: FehmEngine, id: string) { const paths = [...new Set(this.detail(engine, id).findings.flatMap(f => f.evidence.map(e => e.path)))]; const report = indexGitMemory(engine.root, { ...this.options, limit: 100 }); return { paths: paths.slice(0, 20).map(path => entityGitHistory(report, path)), note: 'File changes are temporal associations, not verified concept introduction dates.', coverage: report.coverage }; }
    excerpt(engine: FehmEngine, path: string, line: number) { return conceptExcerpt(engine, path, line); }
    context(engine: FehmEngine, query: string, maxBytes = 8000) { return conceptContext(this.report(engine), this.index(engine), query, { maxBytes, definitions: true }); }
}

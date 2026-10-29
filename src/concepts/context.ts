import type { OntologyIndex } from './catalog.js';
import type { ConceptReport } from './types.js';
export function conceptContext(report: ConceptReport, ontology: OntologyIndex, query: string, options: {
    maxBytes?: number;
    maxTokens?: number;
    tokenizer?: (text: string) => number;
    definitions?: boolean;
} = {}) {
    const maxBytes = options.maxBytes ?? 8000;
    if (!Number.isInteger(maxBytes) || maxBytes < 500 || maxBytes > 100000)
        throw new Error('Context byte budget must be 500–100000');
    if (options.maxTokens !== undefined && (!options.tokenizer || !Number.isInteger(options.maxTokens) || options.maxTokens < 1))
        throw new Error('A positive token budget requires an explicit target-model tokenizer');
    const resolution = ontology.lookup(query, { limit: 12 });
    const selected = new Set(resolution.candidates.map(c => c.id));
    const items = report.findings.filter(f => selected.has(f.concept_id)).sort((a, b) => ['structurally_supported', 'explicitly_observed', 'contextually_inferred', 'weakly_indicated', 'not_verifiable'].indexOf(a.status) - ['structurally_supported', 'explicitly_observed', 'contextually_inferred', 'weakly_indicated', 'not_verifiable'].indexOf(b.status));
    const payload: {
        revision: string | null;
        ontologyVersion: string;
        ambiguous: boolean;
        assumptions: string[];
        concepts: {
            id: string;
            name: string;
            definition?: string;
        }[];
        findings: unknown[];
        omitted: number;
    } = { revision: report.repositoryRevision, ontologyVersion: report.ontologyVersion, ambiguous: resolution.ambiguous, assumptions: ['Scope/status describe evidence, not production guarantees. Missing evidence is unknown.'], concepts: [], findings: [], omitted: items.length };
    const fits = () => { const text = JSON.stringify(payload); return Buffer.byteLength(text) <= maxBytes && (options.maxTokens === undefined || options.tokenizer!(text) <= options.maxTokens); };
    if (!fits())
        throw new Error('Budget too small for context envelope');
    for (const c of resolution.candidates) {
        payload.concepts.push({ id: c.id, name: c.name, ...(options.definitions ? { definition: c.definition } : {}) });
        if (!fits()) {
            payload.concepts.pop();
            break;
        }
    }
    const included = new Set(payload.concepts.map(c => c.id));
    for (const f of items) {
        if (!included.has(f.concept_id))
            continue;
        payload.findings.push({ id: f.concept_id, status: f.status, scope: f.scope, evidence: f.evidence.slice(0, 3).map(e => ({ path: e.path, line: e.line, node: e.nodeId })), rationale: f.rationale, limitations: f.limitations.slice(0, 2) });
        payload.omitted--;
        if (!fits()) {
            payload.findings.pop();
            payload.omitted++;
        }
    }
    const serialized = JSON.stringify(payload);
    return { payload, serialized, bytes: Buffer.byteLength(serialized), tokens: options.tokenizer ? options.tokenizer(serialized) : null, tokenMeasurement: options.tokenizer ? 'caller-supplied tokenizer; identity must be recorded by caller' : 'unavailable; byte budget only', catalogIncluded: false };
}

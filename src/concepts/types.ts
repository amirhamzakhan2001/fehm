export const CONCEPT_ANALYZER_VERSION = '1';
export const EVIDENCE_STATUSES = ['explicitly_observed', 'structurally_supported', 'contextually_inferred', 'weakly_indicated', 'not_verifiable'] as const;
export type ConceptStatus = typeof EVIDENCE_STATUSES[number];
export type ConceptScope = 'documented_claim' | 'declaration' | 'implementation' | 'deployment' | 'measurement' | 'operation';
export interface DetectionGuidance {
    profile?: string;
    modes?: string[];
    evidence?: string[];
    signals?: string[];
    anti_signals?: string[];
    requirements?: string[];
    limit?: string;
}
export interface ConceptRecord {
    id: string;
    name: string;
    aliases: string[];
    definition: string;
    type: string;
    detection: DetectionGuidance & {
        profile: string;
    };
    related: string[];
    parent?: string;
    retrieval?: Record<string, string[]>;
    source_entries?: string[];
}
export interface OntologyCatalog {
    schema_version: string;
    metadata: {
        name: string;
        version: string;
        total_sections: number;
        total_concepts: number;
    };
    policy: {
        catalog_only: boolean;
        confidence_labels: string[];
        detection_modes: string[];
    };
    detection_profiles: Record<string, DetectionGuidance>;
    sections: {
        id: string;
        name: string;
        retrieval?: Record<string, string[]>;
        concepts: ConceptRecord[];
    }[];
}
export interface ConceptCandidate extends ConceptRecord {
    section: string;
    sectionName: string;
    retrievalScore: number;
    match: 'canonical' | 'alias' | 'text';
}
export interface ConceptEvidence {
    id: string;
    path: string;
    line: number;
    endLine: number;
    nodeId: string | null;
    provenance: string;
    method: string;
    detail: string;
    edgeIds: string[];
}
export interface ConceptFinding {
    id: string;
    concept_id: string;
    status: ConceptStatus;
    scope: ConceptScope;
    evidence: ConceptEvidence[];
    rationale: string;
    limitations: string[];
    counterevidence: string[];
    repository_revision: string | null;
    analyzer_version: string;
    ontology_version: string;
}
export interface ConceptReport {
    version: string;
    ontologyVersion: string;
    ontologyHash: string;
    generatedAt: string;
    repositoryRevision: string | null;
    dirty: boolean | null;
    fingerprint: string;
    findings: ConceptFinding[];
    coverage: {
        files: number;
        analyzed: number;
        reused: number;
        removed: number;
        supportedDetectors: string[];
        limitations: string[];
    };
}
export interface ConceptOptions {
    stateDirectory?: string;
    dryRun?: boolean;
    force?: boolean;
}

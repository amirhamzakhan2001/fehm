import type { Finding, Severity } from '../findings/model.js';
export type PromptRole = 'system' | 'developer' | 'user' | 'assistant' | 'tool' | 'context';
export type PromptKind = 'generation' | 'classification' | 'extraction' | 'rag' | 'agent' | 'code' | 'guardrail' | 'multimodal';
export interface PromptFragment {
    separator?: "" | "\n";
    role: PromptRole;
    text: string;
    path: string;
    line: number;
    resolved: boolean;
}
export interface PromptVariable {
    name: string;
    origin: string;
    trust: 'unknown' | 'untrusted';
    path: string;
    line: number;
}
export interface PromptFinding extends Finding {
    promptId: string;
    detectionConfidence: number;
    autofixAvailable: boolean;
}
export interface PromptScore {
    static: number;
    semantic: number | null;
    behavioral: number | null;
    composite: number;
    dimensions: {
        name: string;
        score: number | null;
        reason: string;
    }[];
    band: string;
}
export interface PromptRecord {
    environment?: 'production' | 'test' | 'example' | 'development';
    referenceIds?: string[];
    analysisStatus?: 'pending' | 'complete' | 'error';
    analysisError?: string;
    id: string;
    name: string;
    path: string;
    line: number;
    fileId: string;
    functionId?: string;
    call: string;
    provider: string;
    model: string | null;
    kind: PromptKind;
    confidence: number;
    reconstruction: 'complete' | 'partial';
    fragments: PromptFragment[];
    text: string;
    variables: PromptVariable[];
    behavioralInstruction: 'present' | 'not-detected' | 'unknown';
    tools: string[];
    outputContract: {
        format: 'json' | 'text' | 'unknown';
        enforced: boolean;
        evidence: string[];
    };
    dependencies: {
        nodeId: string;
        edgeId: string;
        relation: string;
    }[];
    testFiles: string[];
    securityFindingIds: string[];
    ontologyNodeIds: string[];
    findings: PromptFinding[];
    score: PromptScore;
    tokens: {
        estimated: true;
        method: string;
        static: number;
        dynamic: null;
        stablePrefix: number;
        total: null;
    };
    /** Only a complete, single string expression can be patched automatically. Normalized source offsets. */
    sourceSpan?: {
        start: number;
        end: number;
        original: string;
        encoding: 'js' | 'text';
    };
}
export interface PromptReport {
    schemaVersion: 1;
    generatedAt: string;
    repository: string;
    digest: string;
    prompts: PromptRecord[];
    findings: PromptFinding[];
    summary: {
        aiCalls: number;
        prompts: number;
        behavioralInstructions: number;
        missingInstructions: number;
        unknownInstructions: number;
        averageScore: number | null;
        critical: number;
        staticTokens: number;
    };
    coverage: {
        exclusions?: { directories: string[]; maxFileBytes: number; rules: string[] };
        astFiles: number;
        heuristicFiles: number;
        templateFiles: number;
        unsupportedFiles: number;
        semantic: 'not-run';
        behavioral: 'not-run';
    };
    unknowns: string[];
}
export const MODES = ['quality', 'tokens', 'reliability', 'structured-output', 'security', 'balanced'] as const;
export type OptimizationMode = typeof MODES[number];
export interface PromptCandidate {
    id: string;
    promptId: string;
    mode: OptimizationMode;
    originalDigest: string;
    text: string;
    score: PromptScore;
    tokens: number;
    tokenDelta: number;
    changes: {
        ruleId: string;
        reason: string;
        addition: string;
    }[];
    intent: {
        preserved: boolean;
        variablesPreserved: boolean;
        requirements: string[];
    };
    status: 'needs-validation' | 'rejected' | 'recommended';
    reasons: string[];
    diff: string;
    patch: string | null;
    createdAt: string;
}
export type Assertion = {
    type: 'equals' | 'contains' | 'not-contains';
    value: string;
} | {
    type: 'json';
    required?: Record<string, 'string' | 'number' | 'boolean' | 'object' | 'array'>;
};
export interface PromptCase {
    id: string;
    name: string;
    variables: Record<string, string>;
    assertions: Assertion[];
    security?: boolean;
    critical?: boolean;
    origin: 'authored' | 'generated';
    reviewed: boolean;
}
export interface CaseResult {
    id: string;
    passed: boolean;
    assertions: boolean[];
    error?: string;
    security: boolean;
    critical: boolean;
}
export interface EvaluationRun {
    promptDigest: string;
    suiteDigest: string;
    status: 'complete' | 'not-run';
    score: number | null;
    cases: CaseResult[];
    model: string;
    at: string;
}
export interface SemanticResult {
    score: number;
    intentPreserved: boolean;
    rationale: string;
    model: string;
}
export interface PromptPolicy {
    missingInstructionSeverity?: Severity;
    staticTokenLimit?: number;
}

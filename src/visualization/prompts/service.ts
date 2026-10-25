import { stateDir } from '../../persistence.js';
import { promptHistory, recordRevision } from '../../prompts/revisions.js';
import type { FehmEngine } from '../../engine.js';
import { buildPromptReport } from '../../prompts/report.js';
import { improvePrompt } from '../../prompts/optimization.js';
import type { OptimizationMode, PromptCandidate, PromptReport } from '../../prompts/types.js';
import { ArchitectureService } from '../architecture/service.js';
import { SecurityService, type SecurityServiceOptions } from '../security/service.js';
export class PromptService {
    private readonly reports = new WeakMap<FehmEngine, PromptReport>();
    private readonly architecture: ArchitectureService;
    private readonly security: SecurityService;
    constructor(private readonly options: SecurityServiceOptions & { security?: SecurityService } = {}) {
        this.architecture = options.architecture ?? new ArchitectureService(options);
        this.security = options.security ?? new SecurityService({ ...options, architecture: this.architecture });
    }
    report(engine: FehmEngine): PromptReport {
        let report = this.reports.get(engine);
        if (!report) {
            report = buildPromptReport({ engine, facts: this.architecture.facts(engine), security: this.security.report(engine) });
            this.reports.set(engine, report);
        }
        return report;
    }
    history(engine: FehmEngine, id: string) { return promptHistory(stateDir(engine.root, this.options.stateDirectory), id); }
    save(engine: FehmEngine, id: string, mode: OptimizationMode) {
        if (this.options.dryRun)
            throw new Error('Read-only (dry run)');
        const candidate = this.candidate(engine, id, mode);
        return recordRevision(engine.root, stateDir(engine.root, this.options.stateDirectory), candidate);
    }
    candidate(engine: FehmEngine, id: string, mode: OptimizationMode): PromptCandidate {
        const p = this.report(engine).prompts.find(p => p.id === id);
        if (!p)
            throw new Error('Unknown prompt');
        return improvePrompt(p, mode, engine.sourceLines(p.path)?.join('\n'));
    }
}

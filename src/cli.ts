#!/usr/bin/env node
import { investigate } from './debugging/investigate.js';
import { InvestigationStore } from './debugging/store.js';
import { investigationContext } from './debugging/context.js';
import type { FailureInput } from './debugging/types.js';
import { analyzeChange } from './guardrails/change.js';
import { Guardrails, suggestedPolicy, type GuardPolicy, type Requirement, type Phase } from "./guardrails/workflow.js";
import { OntologyIndex } from "./concepts/catalog.js";
import { ConceptService } from "./visualization/concepts/service.js";
import { indexGitMemory, compareGitMemory, entityGitHistory, renderGitMemory, searchGitMemory } from "./git-memory/history.js";
import { historicalSnapshot, compareMemorySnapshots } from "./git-memory/snapshots.js";
import { historyBlame, rawHistoryDiff } from "./git-memory/git.js";
import { buildPromptReport, renderPromptText } from "./prompts/report.js";
import { execFileSync } from "node:child_process";
import { applyPromptCandidate, promptHistory, recordRevision } from "./prompts/revisions.js";
import { compareCandidate, improvePrompt } from "./prompts/optimization.js";
import { MODES, type OptimizationMode, type EvaluationRun, type SemanticResult } from "./prompts/types.js";
import { evaluatePrompt, suggestedCases, validateCases } from "./prompts/evaluation.js";
import { resolve } from "node:path";
import { commandProvider, FehmEngine, type FlowStep, type RelatedNode, type Resolution } from "./engine.js";
import { indexRepository, type IndexOptions } from "./indexer.js";
import { addMemory, loadMemory, removeMemory } from "./memory.js";
import type { RetrievalIntent } from "./model.js";
import { buildAgentContext } from "./agent-context.js";
import { manageSkill, type InstallResult } from "./integrations.js";
import { runSkillBench, type SkillBenchCase } from "./skill-eval.js";
import { loadSkillFeedback, recordSkillFeedback } from "./skill-feedback.js";
import { SKILL_LEVELS, type SkillFeedbackValue, type SkillLevel, type SkillRoutingResult } from "./skill-model.js";
import { repositoryProfileFromEngine } from "./skill-profile.js";
import { BUNDLED_CATALOG, checkUpstreamFreshness, SkillRegistry, type RegistrySource } from "./skill-registry.js";
import { commandReranker, routeSkills, routeSkillsWithReranker } from "./skill-router.js";
import { startServer } from "./server.js";
import { dashboardHref, FEATURES } from "./visualization/features.js";
import { buildCodebaseBriefing, withFreshness } from "./codebase-briefing/briefing.js";
import { DEPTH_BUDGET, renderBriefing, type BriefingDepth } from "./codebase-briefing/render.js";
import { SECTION_IDS, type SectionId } from "./codebase-briefing/types.js";
import { readFileSync, statSync } from "node:fs";
import { VIEW_TYPES, type ViewType } from "./architecture/types.js";
import { renderArchitectureText } from "./architecture/text-report.js";
import { ArchitectureService } from "./visualization/architecture/service.js";
import { renderDriftText } from "./drift/drift.js";
import { DriftService } from "./visualization/drift/service.js";
import { checkAdvisories } from "./health/advisories.js";
import { indexFingerprint, runCheck } from "./health/build.js";
import { cycloneDx, spdx } from "./health/dependencies.js";
import { buildHealthReport, FEHM_VERSION, renderHealthText } from "./health/health.js";
import { writeBaseline as writeHealthBaseline } from "./health/history.js";
import { stateDir } from "./persistence.js";
import { buildSecurityReport, renderSecurityText, SECURITY_BASELINE_FILE, toSarif } from "./security/security.js";

const HELP = `fehm — local codebase understanding & context engine

Usage: fehm <command> [args] [--root DIR] [--json]

  debug --input FILE | --location PATH --line N | --run-id ID --evidence-id ID [--save]
  debug report|context|delete --id ID
  debug run --id ID --action-id ID --approve
  guardrails analyze | verify [--approve] | plan | start --file TASK.json | history
  guardrails run --run-id ID --check-id ID --phase baseline|red|green|refactor --approve
  guardrails security|report|exception|review --run-id ID [--reason TEXT] [--gate]
                                     explicit local verification workflow; plan shows policy template
  ontology [query] [--concept-id ID] [--json]
                                     local SQLite catalog, aliases, ambiguity and related concepts
  concepts [query] [--concept-id ID] [--context] [--bytes N] [--json]
                                     evidence-scoped engineering concepts; no model or network calls
  git-memory [query] [--ref REV] [--limit N] [--path FILE] [--category CATEGORY]
                                     searchable Git history and compact context (--json for events)
  git-memory --from REV --to REV [--snapshot] [--raw]
                                     semantic comparison; --snapshot runs existing FEHM analyzers
  git-memory --snapshot [--ref REV]  analyze committed state without checkout or test execution
  git-memory --blame --path FILE [--ref REV] [--line N]
                                     line provenance; --entity NAME follows declaration history
  scan [path] [--force]              index the repository (full / incremental / cache-hit)
  stats                              graph statistics and index status
  search "<query>" [--limit N]       ranked retrieval hits with signals
  context "<query>" [--budget N]     LLM-ready context packet (markdown; --json for canonical JSON)
  focus <symbol>                     a symbol and its direct relationships
  relationships <symbol>             every relationship with provenance/confidence
  explain <symbol-or-file>           summary, excerpt, relationships, unknowns
  flow <entry> [--depth N]           outgoing call tree
  system-map                         project structure overview
  connectivity                       components, hubs, isolated files, unresolved counts
  summaries [--generate T... --command CMD [--model M]]
                                     semantic-summary status, or opt-in generation via a local command
  memory add "<text>" [--link P] [--tag T] | memory list | memory remove <id>
  brief [--depth minimal|standard|deep] [--sections a,b] [--budget N] [--force]
                                     evidence-backed codebase briefing (deterministic, no LLM; --json for the full briefing)
  architecture [--view VIEW] [--focus ID] [--list]
                                     VIEW: system|components|runtime|dataflow|workflow|lifecycle|deployment|security|dependencies|delta
                                     architecture components, roles, relationships and layout validation (--json for the view)
  drift [--all] [--history] [--baseline] [--fail-on new|high|any]
                                     architecture drift: where the code deviates from its own conventions, its framework's
                                     and common practice; --history dates findings over recent commits; --fail-on for CI
  health [--all] [--changed] [--baseline] [--run all|KIND,...] [--advisories] [--sbom cyclonedx|spdx]
         [--fail-on critical|high|medium|new]
                                     project health: tests, coverage, quality, dead code, dependencies, reliability, debt;
                                     --run executes detected build/test/lint/typecheck checks (KIND or check id),
                                     --advisories looks up known vulnerabilities on OSV.dev (network), --fail-on exits 1 for CI
  security [--all] [--changed] [--baseline] [--sarif] [--fail-on critical|high|medium|new]
                                     security review: data flow to sinks, secrets, routes and their controls, CI/CD,
                                     containers, Kubernetes, IaC, LLM/agent/MCP; --sarif prints SARIF 2.1.0 for code scanning
  prompts [--prompt-id ID] [--prompt-mode balanced|quality|tokens|reliability|structured-output|security]
          [--prompt-eval FILE] [--cases] [--history] [--save-revision] [--fail-on high|medium|low]
          [--prompt-comparison FILE] [--apply --approve --prompt-check '["npm","test"]']
                                     prompt inventory, evidence, candidate revisions and recorded-output evaluation
  serve [--port 4317]                localhost dashboard: graph, briefing, architecture, drift, health, security and engine views

Skills (Skill Routing — skill routing; nothing is installed unless you ask):
  skills index [--force]             build/refresh the skill registry (incremental)
  skills list [--category C] [--source S] [--kind K]
  skills search "<query>" [--limit N]
  skills resource <skill-id> <relative-path>  read a declared supporting resource
  skills show <skill-id> [--level metadata|routing|summary|sections|full]
  skills route "<task>" [--budget N] [--max N] [--skill ID]... [--no-repo] [--rerank-command CMD]
  skills feedback <skill-id> useful|neutral|irrelevant|conflicting|too-verbose|missing --task "<task>" [--outcome success|failure]
  skills install|uninstall|status <skill-id>... --platform P [--project] [--dry-run] [--force]
  skills install --task "<task>" --platform P  install the skills routing selects for a task
  skills freshness [--upstream REPO=DIR]...  local changes since indexing / upstream changes
  skills eval [--file eval/skills-bench.json]
  agent-context "<task>" [--total-budget N] [--skill-budget N] [--code-budget N] [--no-skills]
                                     skill context + Context Engine code context in one budget

Common: --intent locate|explain|change|debug|test|architecture  --depth 0-3
Skills: --exclude-source NAME (disable a source) --exclude-skill ID (disable one skill)
Skills: --skills DIR (catalog, default: bundled skills/)  --skill-source NAME=DIR (extra SKILL.md tree)
`;

interface Args {
  positional: string[];
  flags: Map<string, string[]>;
  bools: Set<string>;
}

const VALUE_FLAGS = new Set([
  "input", "location", "evidence-id", "failure-revision", "id", "action-id", "tokens",
  "run-id", "check-id", "phase", "expected-test", "reason",
  "concept-id", "bytes", "ref", "from", "to", "path", "entity", "author", "since", "until", "line",
  "prompt-id", "prompt-mode", "prompt-eval", "prompt-comparison", "prompt-check",
  "root", "limit", "intent", "depth", "budget", "command", "model", "port", "link", "tag", "state-dir",
  "exclude-source", "exclude-skill", "skills", "skill-source", "max", "level", "category", "source", "kind", "skill", "task", "outcome", "platform",
  "rerank-command", "total-budget", "skill-budget", "code-budget", "task-budget", "file", "upstream", "sections", "fail-on", "run", "sbom",
]);
const INTENTS = new Set(["locate", "explain", "change", "debug", "test", "architecture"]);

function parseArgs(argv: string[]): Args {
  const args: Args = { positional: [], flags: new Map(), bools: new Set() };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const [key, inline] = a.slice(2).split("=", 2) as [string, string | undefined];
      if (VALUE_FLAGS.has(key)) {
        const value = inline ?? argv[++i];
        if (value === undefined) throw new Error(`--${key} needs a value`);
        args.flags.set(key, [...(args.flags.get(key) ?? []), value]);
      } else args.bools.add(key);
    } else args.positional.push(a);
  }
  return args;
}

const flag = (args: Args, key: string): string | undefined => args.flags.get(key)?.at(-1);
const num = (args: Args, key: string): number | undefined => {
  const v = flag(args, key);
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`--${key} must be a number`);
  return n;
};
const intentOf = (args: Args): RetrievalIntent | undefined => {
  const v = flag(args, "intent");
  if (v !== undefined && !INTENTS.has(v)) throw new Error(`--intent must be one of ${[...INTENTS].join(", ")}`);
  return v as RetrievalIntent | undefined;
};

function out(value: unknown, json: boolean, text: () => string): void {
  process.stdout.write(json ? `${JSON.stringify(value, null, 2)}\n` : `${text()}\n`);
}

function flushed(text: string): Promise<void> {
  return new Promise((resolveWrite, reject) => process.stdout.write(text, (error) => (error ? reject(error) : resolveWrite())));
}

function unresolvedText<T>(r: Resolution<T>): string {
  if (r.status === "not-found") return `No symbol or file matches "${r.query}".`;
  if (r.status === "ambiguous") return `Ambiguous — ${r.candidates.length} candidates (use name@path or a node id):\n${r.candidates.map((c) => `  ${c.id}`).join("\n")}`;
  return "";
}

function relatedText(related: RelatedNode[]): string {
  if (!related.length) return "  (no relationships)";
  return related
    .map((r) => `  ${r.direction === "out" ? "→" : "←"} ${r.relation.padEnd(10)} ${r.name} (${r.kind}${r.path ? `, ${r.path}${r.line ? `:${r.line}` : ""}` : ""}) [${r.provenance} ${r.confidence.toFixed(2)}]`)
    .join("\n");
}

function flowText(step: FlowStep, indent = ""): string {
  const line = `${indent}${step.name}${step.path ? ` (${step.path})` : ""}${step.depth ? ` [${step.provenance} ${step.confidence.toFixed(2)}]` : ""}${step.repeated ? " ↺" : ""}`;
  return [line, ...step.children.map((c) => flowText(c, `${indent}  `))].join("\n");
}

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  const [command, ...rest] = args.positional;
  const json = args.bools.has("json");
  const stateDirectory = flag(args, "state-dir");
  const indexOptions = { ...(args.bools.has("force") ? { force: true } : {}), ...(stateDirectory ? { stateDirectory } : {}) };
  const root = resolve(flag(args, "root") ?? (command === "scan" && rest[0] ? rest[0] : "."));
  if (!command || command === "help" || args.bools.has("help")) {
    process.stdout.write(HELP);
    return 0;
  }
  const open = (): FehmEngine => FehmEngine.open(root, indexOptions);
  const needArg = (what: string): string => {
    const v = rest.join(" ").trim();
    if (!v) throw new Error(`${command} needs ${what}`);
    return v;
  };

  switch (command) {
    case "debug": {
      const store = new InvestigationStore(root, stateDirectory), action = rest[0] ?? "analyze";
      if (action === "delete") {
        store.remove(flag(args,"id") ?? ""); out({deleted:true},json,()=>"Investigation deleted"); return 0;
      }
      if (action === "run") {
        const result = await store.run(flag(args,"id") ?? "",flag(args,"action-id") ?? "",args.bools.has("approve"));
        if (args.bools.has("save")) store.save(result);
        out(result,json,()=>JSON.stringify(result,null,2)); return 0;
      }
      if (!["analyze","report","context"].includes(action)) throw new Error("Unknown debugging action");
      const engine = FehmEngine.open(root,{...indexOptions,dryRun:true});
      if (action === "report" || action === "context") {
        const report=store.current(flag(args,"id") ?? "",engine);
        const result=action === "context" ? investigationContext(report,num(args,"tokens") ?? 4000) : report;
        out(result,json,()=>action === "context" ? (result as {text:string}).text : JSON.stringify(result,null,2));return 0;
      }
      const input:FailureInput={};
      const file=flag(args,"input"), location=flag(args,"location"), runId=flag(args,"run-id"), evidenceId=flag(args,"evidence-id"), revision=flag(args,"failure-revision");
      if (file) {if (statSync(resolve(file)).size>128*1024) throw new Error("Failure input exceeds 128 KiB");input.text=readFileSync(resolve(file),"utf8");}
      if (location) input.location={path:location,line:num(args,"line") ?? 1};
      if (runId) input.runId=runId;
      if (evidenceId) input.evidenceId=evidenceId;
      if (revision) input.failureRevision=revision;
      const report=investigate(engine,input);
      if (args.bools.has("save")) store.save(report);
      out(report,json,()=>JSON.stringify(report,null,2));return 0;
    }
    case "guardrails": {
      const service = new Guardrails(root), action = rest[0] ?? "history";
      let result: unknown;
      if (action === "analyze") result = analyzeChange(root);
      else if (action === "verify") {
        const verification = await service.verifyChange(args.bools.has("approve"));
        out(verification, json, () => JSON.stringify(verification, null, 2));
        return args.bools.has("gate") && !verification.report?.readiness.startsWith("verified_") ? 1 : 0;
      }
      else if (action === "plan") result = { task: "Describe the change", requirements: [{ id: "acceptance-1", text: "Describe observable acceptance criteria", origin: "user", confirmed: false, checks: [] }], policy: suggestedPolicy(root) };
      else if (action === "start") {
        const path = flag(args, "file"); if (!path) throw new Error("start requires --file TASK.json");
        const input = JSON.parse(readFileSync(resolve(path), "utf8")) as { task: string; requirements: Requirement[]; policy: GuardPolicy; mode?: "agent-integration" | "fehm-directed" | "verification-only" };
        result = service.start(input.task, input.requirements, input.policy, input.mode);
      } else if (action === "history") result = service.history();
      else {
        const id = flag(args, "run-id"); if (!id) throw new Error("--run-id required");
        if (action === "run") {
          const check = flag(args, "check-id"); if (!check) throw new Error("--check-id required");
          await service.execute(id, check, (flag(args, "phase") ?? "green") as Phase, args.bools.has("approve"), flag(args, "expected-test"));
        } else if (action === "security") service.assessSecurity(id);
        else if (action === "exception") service.exception(id, flag(args, "reason") ?? "");
        else if (action === "review") service.review(id, flag(args, "reason") ?? "");
        else if (action !== "report" && action !== "context") throw new Error("Unknown guardrails action");
        const report = service.report(id); result = action === "context" ? service.context(id, num(args, "bytes")) : report;
        out(result, json, () => JSON.stringify(result, null, 2));
        return args.bools.has("gate") && !report.readiness.startsWith("verified_") ? 1 : 0;
      }
      out(result, json, () => JSON.stringify(result, null, 2)); return 0;
    }

    case "ontology": {
      const index = OntologyIndex.open({ stateDirectory: stateDir(root, stateDirectory), memory: args.bools.has("dry-run") });
      try {
        const id = flag(args, "concept-id");
        if (id && !index.get(id)) throw new Error("Unknown concept");
        const result = id ? { concept: index.get(id), guidance: index.guidance(id), neighborhood: index.neighborhood(id) } : rest.length ? index.lookup(rest.join(" "), { limit: num(args, "limit") ?? 30 }) : index.summary();
        out(result, json, () => JSON.stringify(result, null, 2));
      } finally { index.close(); }
      return 0;
    }
    case "concepts": {
      const service = new ConceptService({ ...indexOptions, dryRun: args.bools.has("dry-run") });
      try {
        const engine = FehmEngine.open(root, { ...indexOptions, dryRun: args.bools.has("dry-run") });
        const id = flag(args, "concept-id"), query = rest.join(" ");
        let result: unknown;
        if (args.bools.has("context")) result = service.context(engine, query, num(args, "bytes") ?? 8000);
        else if (id) result = service.detail(engine, id);
        else { const report = service.report(engine); const resolution = query ? service.index(engine).lookup(query) : null; const ids = resolution ? new Set(resolution.candidates.map(c => c.id)) : null; result = { ...report, findings: report.findings.filter(f => !ids || ids.has(f.concept_id)), resolution }; }
        out(result, json, () => JSON.stringify(result, null, 2));
      } finally { service.close(); }
      return 0;
    }
    case "git-memory": {
      const options = { ...indexOptions, dryRun: args.bools.has("dry-run"), ...(flag(args, "ref") ? { ref: flag(args, "ref")! } : {}), ...(num(args, "limit") !== undefined ? { limit: num(args, "limit")! } : {}) };
      const from = flag(args, "from"), to = flag(args, "to") ?? "HEAD";
      let result: unknown;
      if (args.bools.has("blame")) result = historyBlame(root, flag(args, "ref") ?? "HEAD", flag(args, "path") ?? "", num(args, "line") ?? 1, (num(args, "line") ?? 1) + 49);
      else if (from && args.bools.has("raw")) result = rawHistoryDiff(root, from, to);
      else if (from && args.bools.has("snapshot")) result = compareMemorySnapshots(historicalSnapshot(root, from, options), historicalSnapshot(root, to, options));
      else if (from) result = compareGitMemory(root, from, to);
      else if (args.bools.has("snapshot")) result = historicalSnapshot(root, flag(args, "ref") ?? "HEAD", options);
      else {
        const report = indexGitMemory(root, options);
        const filter = Object.fromEntries(["path", "entity", "category", "author", "since", "until"].filter(k => flag(args, k)).map(k => [k, flag(args, k)!]));
        if (rest.length) filter.query = rest.join(" ");
        let selectedReport = report;
        if (flag(args, "path") || flag(args, "entity")) {
          const history = entityGitHistory(report, flag(args, "path") ?? "", flag(args, "entity"));
          const remainingFilter = { ...filter }; delete remainingFilter.path;
          selectedReport = { ...report, commits: history.commits };
          result = { ...history, commits: searchGitMemory(selectedReport, remainingFilter) };
          delete filter.path;
        }
        else if (Object.keys(filter).length) result = { commits: searchGitMemory(report, filter), coverage: report.coverage };
        else result = report;
        if (!json) { process.stdout.write(renderGitMemory(selectedReport, filter, num(args, "budget") ?? 3000) + "\n"); return 0; }
      }
      out(result, json, () => typeof result === "string" ? result : JSON.stringify(result, null, 2));
      return 0;
    }
    case "scan": {
      const { report, graph } = indexRepository(root, indexOptions);
      out({ report, stats: graph.stats() }, json, () => {
        const s = graph.stats();
        return [
          `Indexed ${root} (${report.mode}${report.reason ? `: ${report.reason}` : ""}) in ${report.durationMs}ms`,
          `  files: ${s.files}  nodes: ${s.nodes}  edges: ${s.edges}  unresolved: ${s.unresolved}`,
          `  analyzed ${report.analyzedFiles.length}, reused ${report.reusedFiles.length}, invalidated ${report.invalidatedFiles.length}, removed ${report.removedFiles.length}`,
          `  symbols +${report.changedSymbols.added.length}/-${report.changedSymbols.removed.length}, relationships +${report.changedRelationships.added}/-${report.changedRelationships.removed}`,
          report.staleSummaries.length ? `  stale semantic summaries: ${report.staleSummaries.length}` : "",
          report.scanErrors.length ? `  scan errors: ${report.scanErrors.map((e) => `${e.path} (${e.reason})`).join("; ")}` : "",
        ].filter(Boolean).join("\n");
      });
      return 0;
    }
    case "stats": {
      const status = open().status();
      out(status, json, () => {
        const s = status.stats;
        const kinds = (o: Record<string, number | undefined>): string => Object.entries(o).map(([k, v]) => `${k} ${v}`).join(", ");
        return [
          `${status.root} — sync: ${status.sync.mode}`,
          `nodes ${s.nodes}: ${kinds(s.nodesByKind)}`,
          `edges ${s.edges}: ${kinds(s.edgesByKind)}`,
          `provenance: ${kinds(s.edgesByProvenance)}`,
          `unresolved references: ${s.unresolved}`,
          `semantic summaries: ${status.summaries.fresh} fresh, ${status.summaries.stale} stale`,
        ].join("\n");
      });
      return 0;
    }
    case "search": {
      const intent = intentOf(args);
      const depth = num(args, "depth");
      const hits = open().search(needArg("a query"), { limit: num(args, "limit") ?? 15, ...(intent ? { intent } : {}), ...(depth !== undefined ? { depth } : {}) });
      out(hits, json, () =>
        hits.length
          ? hits.map((h, i) => `${String(i + 1).padStart(2)}. ${h.score.toFixed(3)} ${h.kind} ${h.name}${h.path ? ` — ${h.path}` : ""}\n      lex ${h.signals.lexical.toFixed(2)} sym ${h.signals.symbol.toFixed(2)} sem ${h.signals.semantic.toFixed(2)} graph ${h.signals.graph.toFixed(2)} intent ${h.signals.intent.toFixed(2)} · ${h.reasons.join("; ")}`).join("\n")
          : "No matches.",
      );
      return 0;
    }
    case "context": {
      const engine = open();
      const intent = intentOf(args);
      const depth = num(args, "depth");
      const budget = num(args, "budget");
      const packet = engine.context(needArg("a query"), { ...(budget !== undefined ? { budget } : {}), ...(intent ? { intent } : {}), ...(depth !== undefined ? { depth } : {}) });
      out(packet, json, () => engine.renderContext(packet));
      return 0;
    }
    case "focus":
    case "relationships": {
      const engine = open();
      const r = command === "focus" ? engine.focus(needArg("a symbol")) : engine.relationships(needArg("a symbol"));
      out(r, json, () => {
        if (r.status !== "found") return unresolvedText(r);
        const res = r.result as { node: { id: string }; summary?: string; related: RelatedNode[] };
        return [res.node.id, res.summary ?? "", relatedText(res.related)].filter(Boolean).join("\n");
      });
      return r.status === "found" ? 0 : 2;
    }
    case "explain": {
      const r = open().explain(needArg("a symbol or file"));
      out(r, json, () => {
        if (r.status !== "found") return unresolvedText(r);
        const e = r.result;
        return [
          `${e.node.id}`,
          e.node.signature ? `  ${e.node.signature}` : "",
          `\n${e.summary}`,
          e.semanticSummary ? `\nSemantic (${e.semanticSummary.model}): ${e.semanticSummary.text}` : e.semanticStatus === "stale" ? "\nSemantic summary is stale (source changed); not shown." : "",
          e.excerpt.length ? `\n${e.excerpt.join("\n")}` : "",
          `\nRelationships:\n${relatedText(e.related)}`,
          e.unknowns.length ? `\nUnknowns:\n${e.unknowns.map((u) => `  ${u.location.path}:${u.location.line} ${u.kind} ${u.text} — ${u.reason}`).join("\n")}` : "",
        ].filter(Boolean).join("\n");
      });
      return r.status === "found" ? 0 : 2;
    }
    case "flow": {
      const r = open().flow(needArg("an entry point"), num(args, "depth") ?? 3);
      out(r, json, () => (r.status === "found" ? flowText(r.result) : unresolvedText(r)));
      return r.status === "found" ? 0 : 2;
    }
    case "system-map": {
      const map = open().systemMap();
      out(map, json, () =>
        [
          `${map.name} (${map.root})`,
          `languages: ${Object.entries(map.languages).map(([l, n]) => `${l} ${n}`).join(", ")}`,
          `files: ${map.files.total} (source ${map.files.source}, test ${map.files.test}, config ${map.files.config}, manifest ${map.files.manifest}, docs ${map.files.docs})`,
          `symbols: ${Object.entries(map.symbols).map(([k, n]) => `${k} ${n}`).join(", ")}`,
          `entry points: ${map.entryPoints.join(", ") || "(none detected)"}`,
          `manifests: ${map.manifests.join(", ") || "(none)"}`,
          `external packages: ${map.externalPackages.slice(0, 12).map((p) => `${p.name}(${p.importers})`).join(", ") || "(none)"}`,
          "directories:",
          ...map.directories.map((d) => `  ${d.path.padEnd(40)} files ${d.files}  symbols ${d.symbols}${d.tests ? `  tests ${d.tests}` : ""}`),
        ].join("\n"),
      );
      return 0;
    }
    case "connectivity": {
      const c = open().connectivity();
      out(c, json, () =>
        [
          `components: ${c.components.map((x) => x.size).join(", ") || "(none)"}`,
          `isolated files (${c.isolatedFiles.length}): ${c.isolatedFiles.slice(0, 15).join(", ")}${c.isolatedFiles.length > 15 ? ", …" : ""}`,
          `hubs: ${c.hubs.map((h) => `${h.path}(${h.dependents})`).join(", ")}`,
          `exported but unreferenced (${c.unreferencedExports.length}; candidates only): ${c.unreferencedExports.slice(0, 10).join(", ")}${c.unreferencedExports.length > 10 ? ", …" : ""}`,
          `unresolved: ${Object.entries(c.unresolved).map(([k, n]) => `${k} ${n}`).join(", ") || "none"}`,
          `edges by provenance: ${Object.entries(c.edgesByProvenance).map(([k, n]) => `${k} ${n}`).join(", ")}`,
        ].join("\n"),
      );
      return 0;
    }
    case "summaries": {
      const engine = open();
      if (args.bools.has("generate")) {
        const cmd = flag(args, "command");
        if (!cmd) throw new Error("--generate requires --command \"<local command that reads a prompt on stdin>\"");
        const result = await engine.summarize(rest, commandProvider(cmd, flag(args, "model") ?? cmd));
        out(result, json, () => `generated ${result.generated.length}, reused ${result.reused.length}, failed ${result.failed.length}${result.failed.length ? `\n${result.failed.map((f) => `  ${f.nodeId}: ${f.error}`).join("\n")}` : ""}${result.unresolvedTargets.length ? `\nunresolved targets: ${result.unresolvedTargets.join(", ")}` : ""}`);
        return result.failed.length ? 1 : 0;
      }
      const status = engine.status();
      out({ summaries: status.summaries, stale: status.sync.staleSummaries }, json, () => `semantic summaries: ${status.summaries.fresh} fresh, ${status.summaries.stale} stale${status.sync.staleSummaries.length ? `\nstale: ${status.sync.staleSummaries.join(", ")}` : ""}`);
      return 0;
    }
    case "memory": {
      const [sub, ...text] = rest;
      if (sub === "add") {
        const entry = addMemory(root, { text: text.join(" "), links: args.flags.get("link") ?? [], tags: args.flags.get("tag") ?? [] }, stateDirectory);
        out(entry, json, () => `added ${entry.id}`);
        return 0;
      }
      if (sub === "remove") {
        const ok = removeMemory(root, text[0] ?? "", stateDirectory);
        out({ removed: ok }, json, () => (ok ? "removed" : "no such memory"));
        return ok ? 0 : 2;
      }
      const entries = loadMemory(root, stateDirectory);
      out(entries, json, () => entries.map((e) => `${e.id}  ${e.text}${e.links.length ? `  [${e.links.join(", ")}]` : ""}`).join("\n") || "(no project memory)");
      return 0;
    }
    case "brief": {
      const engine = open();
      const briefing = withFreshness(buildCodebaseBriefing(engine, { ...(stateDirectory ? { stateDirectory } : {}), ...(args.bools.has("force") ? { force: true } : {}) }), engine);
      if (json) {
        // Wait for the flush: the CLI exits via process.exit, which would truncate a large piped write.
        await flushed(`${JSON.stringify(briefing, null, 2)}\n`);
        return 0;
      }
      const depth = (flag(args, "depth") ?? "standard") as BriefingDepth;
      if (!(depth in DEPTH_BUDGET)) throw new Error(`--depth must be minimal, standard or deep`);
      const sections = (flag(args, "sections") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
      const unknownSections = sections.filter((x) => !(SECTION_IDS as readonly string[]).includes(x));
      if (unknownSections.length) throw new Error(`unknown section(s): ${unknownSections.join(", ")}. Valid: ${SECTION_IDS.join(", ")}`);
      const budget = num(args, "budget");
      const out = renderBriefing(briefing, { depth, ...(sections.length ? { sections: sections as SectionId[] } : {}), ...(budget ? { tokenBudget: budget } : {}) });
      await flushed(`${out.text}\n`);
      process.stderr.write(`[brief] ~${out.tokens} tokens (${out.estimator}) · sections cached ${briefing.cache.reused.length}/${briefing.sections.length} · ${briefing.cache.durationMs}ms\n`);
      return 0;
    }
    case "architecture": {
      const engine = open();
      const service = new ArchitectureService({ ...(stateDirectory ? { stateDirectory } : {}) });
      const view = (flag(args, "view") ?? "system") as ViewType;
      if (!(VIEW_TYPES as readonly string[]).includes(view)) throw new Error(`--view must be one of ${VIEW_TYPES.join(", ")}`);
      if (args.bools.has("list")) {
        const views = service.views(engine);
        await flushed(`${json ? JSON.stringify(views, null, 2) : views.map((v) => `${v.available ? "✓" : "·"} ${v.type.padEnd(13)} ${v.available ? v.question : v.reason ?? ""}${v.options?.length ? `\n    ${v.optionLabel}: ${v.options.slice(0, 8).map((o) => o.id).join("  ")}${v.options.length > 8 ? ` … +${v.options.length - 8}` : ""}` : ""}`).join("\n")}\n`);
        return 0;
      }
      const published = service.view(engine, view, flag(args, "focus"));
      if ("error" in published) throw new Error(published.error);
      if (json) {
        await flushed(`${JSON.stringify({ summary: service.summary(engine), view: published }, null, 2)}\n`);
        return 0;
      }
      await flushed(`${renderArchitectureText(service.summary(engine), published)}\n`);
      return published.layout ? 0 : 1;
    }
    case "drift": {
      const engine = open();
      const service = new DriftService({ ...(stateDirectory ? { stateDirectory } : {}) });
      const failOn = flag(args, "fail-on");
      if (failOn !== undefined && !["new", "high", "any"].includes(failOn)) throw new Error("--fail-on must be new, high or any");
      if (args.bools.has("baseline")) {
        const r = service.setBaseline(engine);
        if ("error" in r) throw new Error(r.error);
        process.stderr.write(`[drift] baseline set: ${r.findings} findings accepted as existing\n`);
      }
      if (args.bools.has("history")) {
        const commits = service.payload(engine).history.commits;
        for (const [i, c] of commits.entries()) {
          process.stderr.write(`[drift] analysing ${c.short} (${i + 1}/${commits.length})\n`);
          const p = service.historyPoint(engine, c.ref);
          if (p.error) process.stderr.write(`[drift]   ${p.error}\n`);
        }
      }
      const report = service.report(engine);
      const history = service.payload(engine).history;
      if (json) await flushed(`${JSON.stringify(report, null, 2)}\n`);
      else {
        let text = renderDriftText(report, { all: args.bools.has("all") });
        if (history.comparison) text += `\n\nDated against ${history.comparison.label}: ${report.summary.new} new, ${report.findings.length - report.summary.new} existing, ${history.resolved.length} resolved.`;
        else text += `\n\nFindings are not dated yet: run with --history (git window) or --baseline.`;
        await flushed(`${text}\n`);
      }
      const core = report.findings.filter((f) => f.group !== "ai");
      if (failOn === "new") {
        if (!history.comparison) throw new Error("--fail-on new needs a comparison point: run with --history, or set --baseline first");
        if (core.some((f) => f.status === "new")) return 1;
      }
      if (failOn === "high" && core.some((f) => f.attention === "high" || f.attention === "critical")) return 1;
      if (failOn === "any" && core.length) return 1;
      return 0;
    }
    case "health": {
      const engine = open();
      const state = stateDir(root, stateDirectory);
      const scope = args.bools.has("changed") ? "changed" : "all";
      const failOn = flag(args, "fail-on");
      if (failOn !== undefined && !["critical", "high", "medium", "new"].includes(failOn)) throw new Error("--fail-on must be critical, high, medium or new");
      const sbom = flag(args, "sbom");
      if (sbom !== undefined && sbom !== "cyclonedx" && sbom !== "spdx") throw new Error("--sbom must be cyclonedx or spdx");
      let report = buildHealthReport({ engine, stateDirectory: state, scope });
      const run = flag(args, "run");
      if (run !== undefined) {
        const wanted = run.split(",").map((x) => x.trim()).filter(Boolean);
        const checks = report.build.checks.filter((c) => wanted.includes("all") || wanted.includes(c.kind) || wanted.includes(c.id));
        if (!checks.length) throw new Error(`no detected check matches --run ${run}; detected: ${report.build.checks.map((c) => `${c.kind} (${c.display})`).join(", ") || "none"}`);
        for (const c of checks) {
          process.stderr.write(`[health] running ${c.display} …\n`);
          const r = runCheck(root, state, c, indexFingerprint(engine), report.git.commit);
          process.stderr.write(`[health] ${c.display}: ${r.status}${r.exitCode !== undefined ? ` (exit ${r.exitCode})` : ""} in ${Math.round(r.durationMs / 100) / 10}s\n`);
        }
      }
      if (args.bools.has("advisories")) {
        process.stderr.write(`[health] querying OSV.dev for ${report.dependencies.components.length} components …\n`);
        const a = await checkAdvisories(state, report.dependencies.components);
        if (a.status === "error") throw new Error(a.reason ?? "advisory check failed");
        process.stderr.write(`[health] ${a.items.length} advisories\n`);
      }
      if (run !== undefined || args.bools.has("advisories")) report = buildHealthReport({ engine, stateDirectory: state, scope });
      if (sbom) {
        const subject = { name: report.repository.name, components: report.dependencies.components, toolVersion: FEHM_VERSION, generatedAt: new Date().toISOString() };
        await flushed(`${JSON.stringify(sbom === "spdx" ? spdx(subject) : cycloneDx(subject), null, 2)}\n`);
        return 0;
      }
      if (args.bools.has("baseline")) {
        writeHealthBaseline(state, report.findings, report.git.commit);
        process.stderr.write(`[health] baseline set with ${report.findings.length} findings\n`);
        report = buildHealthReport({ engine, stateDirectory: state, scope });
      }
      await flushed(`${json ? JSON.stringify(report, null, 2) : renderHealthText(report, { all: args.bools.has("all") })}\n`);
      const open_ = report.findings.filter((f) => !f.review || f.review.status === "reviewed");
      if (failOn === "new") {
        if (!report.baseline) throw new Error("--fail-on new needs a baseline: run `fehm health --baseline` first");
        return open_.some((f) => f.baseline === "new") ? 1 : 0;
      }
      const levels = failOn === "critical" ? ["critical"] : failOn === "high" ? ["critical", "high"] : failOn === "medium" ? ["critical", "high", "medium"] : [];
      return open_.some((f) => levels.includes(f.severity)) ? 1 : 0;
    }
    case "prompts": {
      const engine = open();
      const failOn = flag(args, "fail-on");
      if (failOn && !["critical", "high", "medium", "low"].includes(failOn)) throw new Error("--fail-on must be critical, high, medium or low");
      const report = buildPromptReport({ engine, security: buildSecurityReport({ engine, dryRun: true }) });
      const id = flag(args, "prompt-id");
      const prompt = id ? report.prompts.find(p => p.id === id) : undefined;
      if (id && !prompt) throw new Error("Unknown prompt ID");
      const mode = flag(args, "prompt-mode") as OptimizationMode | undefined;
      if (mode && !MODES.includes(mode)) throw new Error("Invalid --prompt-mode");
      const evalFile = flag(args, "prompt-eval");
      if ((mode || evalFile || args.bools.has("cases")) && !prompt) throw new Error("--prompt-id is required");
      const comparisonFile = flag(args, "prompt-comparison");
      if ((comparisonFile || args.bools.has("history") || args.bools.has("save-revision") || args.bools.has("apply")) && !prompt) throw new Error("--prompt-id is required");
      if (args.bools.has("apply") && !comparisonFile) throw new Error("--apply requires --prompt-comparison");
      if (args.bools.has("history") && prompt) { out(promptHistory(stateDir(root,stateDirectory),prompt.id),true,()=>""); return 0; }
      if (comparisonFile && prompt) {
        const comparison = JSON.parse(readFileSync(resolve(root,comparisonFile),"utf8")) as {baseline:EvaluationRun;proposed:EvaluationRun;semantic:SemanticResult};
        if(!comparison.baseline?.cases || !comparison.proposed?.cases || !comparison.semantic) throw new Error("Comparison requires baseline, proposed and semantic evaluation records");
        const candidate=improvePrompt(prompt,mode??"balanced",engine.sourceLines(prompt.path)?.join("\n"));
        const checked=compareCandidate(prompt,candidate,comparison.baseline,comparison.proposed,comparison.semantic);
        if(args.bools.has("apply")) {
          const command=flag(args,"prompt-check");
          if(!command)throw new Error("--prompt-check requires an explicit JSON command array for relevant code tests");
          const argv:unknown=JSON.parse(command);
          if(!Array.isArray(argv)||!argv.length||argv.some(a=>typeof a!=="string"||a.includes("\0")))throw new Error("--prompt-check must be a nonempty JSON string array");
          const result=await applyPromptCandidate({engine,prompt,candidate,baseline:comparison.baseline,proposed:comparison.proposed,semantic:comparison.semantic,approved:args.bools.has("approve"),dryRun:args.bools.has("dry-run"),stateDirectory:stateDir(root,stateDirectory),validate:async()=>{try{execFileSync(argv[0] as string,argv.slice(1) as string[],{cwd:root,timeout:120_000,stdio:["ignore","pipe","pipe"]});return true;}catch(error){process.stderr.write(String(error)+"\n");return false;}}});
          out(result,json,()=>result.applied?`Applied ${result.candidateId} to ${result.path}; code checks passed.`:"Dry run: source is current and candidate passed the comparison gates.");return 0;
        }
        if(args.bools.has("save-revision"))recordRevision(root,stateDir(root,stateDirectory),checked);
        out(checked,json,()=>`${checked.status}: ${checked.reasons.join(" ")}`);return checked.status==="recommended"?0:1;
      }
      if(args.bools.has("save-revision")&&prompt){const c=improvePrompt(prompt,mode??"balanced");out(recordRevision(root,stateDir(root,stateDirectory),c),true,()=>"");return 0;}
      if (evalFile && prompt) {
        const data = JSON.parse(readFileSync(resolve(root, evalFile), "utf8")) as { cases: unknown; outputs: Record<string, unknown>; model: string };
        validateCases(data.cases);
        if (!data.outputs || typeof data.outputs !== "object" || typeof data.model !== "string") throw new Error("Evaluation file needs cases, outputs and model");
        const text = mode ? improvePrompt(prompt, mode).text : prompt.text;
        const run = await evaluatePrompt(text, data.cases, async ({test}) => { const value = data.outputs[test.id]; if (typeof value !== "string") throw new Error("Missing recorded output"); return value; }, data.model);
        out({...run, source: "user-supplied recorded outputs; model execution not verified"}, json, () => `${run.cases.filter(c => c.passed).length}/${run.cases.length} cases passed; score ${run.score ?? "not run"}`);
        return run.status === "complete" && run.cases.every(c => c.passed) ? 0 : 1;
      }
      if (prompt && args.bools.has("cases")) out(suggestedCases(prompt), true, () => "");
      else if (prompt && mode) { const candidate = improvePrompt(prompt, mode, engine.sourceLines(prompt.path)?.join("\n")); out(candidate, json, () => `${candidate.status}: ${candidate.reasons.join(" ")}\n${candidate.diff}`); }
      else if (prompt) out(prompt, json, () => `${prompt.id} ${prompt.path}:${prompt.line}\n${prompt.text}`);
      else out(report, json, () => renderPromptText(report));
      const ranks = ["critical", "high", "medium", "low", "info"];
      return failOn && report.findings.some(f => ranks.indexOf(f.severity) <= ranks.indexOf(failOn)) ? 1 : 0;
    }
    case "security": {
      const engine = open();
      const state = stateDir(root, stateDirectory);
      const scope = args.bools.has("changed") ? "changed" : "all";
      const failOn = flag(args, "fail-on");
      if (failOn !== undefined && !["critical", "high", "medium", "new"].includes(failOn)) throw new Error("--fail-on must be critical, high, medium or new");
      let report = buildSecurityReport({ engine, stateDirectory: state, scope });
      if (args.bools.has("baseline")) {
        writeHealthBaseline(state, report.findings, report.provenance.commit, SECURITY_BASELINE_FILE);
        process.stderr.write(`[security] baseline set with ${report.findings.length} findings\n`);
        report = buildSecurityReport({ engine, stateDirectory: state, scope });
      }
      if (args.bools.has("sarif")) await flushed(`${JSON.stringify(toSarif(report), null, 2)}\n`);
      else await flushed(`${json ? JSON.stringify(report, null, 2) : renderSecurityText(report, { all: args.bools.has("all") })}\n`);
      const openFindings = report.findings.filter((f) => !f.review || f.review.status === "reviewed");
      if (failOn === "new") {
        if (!report.baseline) throw new Error("--fail-on new needs a baseline: run `fehm security --baseline` first");
        return openFindings.some((f) => f.baseline === "new") ? 1 : 0;
      }
      const levels = failOn === "critical" ? ["critical"] : failOn === "high" ? ["critical", "high"] : failOn === "medium" ? ["critical", "high", "medium"] : [];
      return openFindings.some((f) => levels.includes(f.severity)) ? 1 : 0;
    }
    case "serve": {
      const port = num(args, "port") ?? 4317;
      const server = await startServer(root, port, indexOptions);
      const address = server.address();
      const base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : port}`;
      process.stdout.write(`fehm dashboard on ${base}\n${FEATURES.map((f) => `  ${f.title.padEnd(18)} ${base}${dashboardHref(f.id)}`).join("\n")}\n`);
      return new Promise<number>(() => undefined);
    }
    case "skills":
      return skillsCommand(args, root, rest, json, stateDirectory, indexOptions);
    case "agent-context": {
      const engine = open();
      const registry = args.bools.has("no-skills") ? null : openRegistry(args, root, stateDirectory);
      const route = routeFlags(args, root, stateDirectory);
      const total = num(args, "total-budget");
      const skillBudget = num(args, "skill-budget");
      const codeBudget = num(args, "code-budget");
      const taskBudget = num(args, "task-budget");
      const intent = intentOf(args);
      const ctx = buildAgentContext(engine, needArg("a task"), {
        registry,
        route,
        ...(total !== undefined ? { totalBudget: total } : {}),
        ...(skillBudget !== undefined ? { skillBudget } : {}),
        ...(codeBudget !== undefined ? { codeBudget } : {}),
        ...(taskBudget !== undefined ? { taskBudget } : {}),
        ...(intent ? { intent } : {}),
      });
      out(ctx, json, () => ctx.markdown);
      return 0;
    }
    default:
      process.stderr.write(`Unknown command "${command}".\n\n${HELP}`);
      return 2;
  }
}

function openRegistry(args: Args, root: string, stateDirectory: string | undefined, force = false): SkillRegistry {
  const sources: RegistrySource[] = [{ type: "catalog", dir: resolve(flag(args, "skills") ?? BUNDLED_CATALOG) }];
  for (const spec of args.flags.get("skill-source") ?? []) {
    const [name, dir] = spec.split("=", 2) as [string, string | undefined];
    if (!name || !dir) throw new Error("--skill-source needs NAME=DIR");
    sources.push({ type: "directory", dir: resolve(dir), options: { name } });
  }
  return SkillRegistry.open({ sources, root, force, ...(stateDirectory ? { stateDirectory } : {}) });
}

function routeFlags(args: Args, root: string, stateDirectory: string | undefined) {
  const max = num(args, "max");
  return {
    ...(max !== undefined ? { maxSkills: max } : {}),
    ...(args.flags.get("skill")?.length ? { include: args.flags.get("skill")! } : {}),
    exclude: args.flags.get("exclude-skill") ?? [],
    excludeSources: args.flags.get("exclude-source") ?? [],
    feedback: loadSkillFeedback(root, stateDirectory),
  };
}

function routeText(r: SkillRoutingResult): string {
  const lines = [`task: ${r.task}`, `intents: ${r.profile.intents.map((i) => `${i}${(r.profile.intentStrength[i] ?? 0) < 1 ? "(weak)" : ""}`).join(", ") || "none"}  confidence: ${r.confidence.toFixed(2)}`];
  if (r.profile.repository) lines.push(`repository: ${r.profile.repository.technologies.join(", ") || "(no technologies recognised)"}`);
  if (r.clarification) lines.push(`clarification: ${r.clarification}`);
  lines.push("", "selected:");
  for (const s of r.selected) {
    lines.push(`  ${s.role.padEnd(10)} ${s.skillId}  score ${s.score.toFixed(2)}  loaded ${s.loadedLevel} (~${s.estimatedTokens} tok)${s.stale ? "  STALE" : ""}`);
    for (const reason of s.reason) lines.push(`             - ${reason}`);
  }
  if (!r.selected.length) lines.push("  (none)");
  if (r.dependencies.length) lines.push("", "dependencies:", ...r.dependencies.map((d) => `  ${d.skillId} ← ${d.requiredBy.join(", ")} (${d.loadedLevel})`));
  if (r.dependencyIssues.cycles.length) lines.push("", `dependency cycles: ${r.dependencyIssues.cycles.map((c) => c.join(" → ")).join("; ")}`);
  if (r.conflicts.length) lines.push("", "conflicts:", ...r.conflicts.map((c) => `  kept ${c.kept}, dropped ${c.dropped} — ${c.reason} [${c.rule}]`));
  lines.push("", "rejected (top):", ...r.rejected.slice(0, 8).map((x) => `  ${x.skillId}  ${x.score.toFixed(2)} — ${x.reason.join("; ")}`));
  lines.push("", `budget: ${r.budget.usedTokens}/${r.budget.maximumTokens} tokens (${r.budget.estimator})${r.budget.dropped.length ? `, dropped ${r.budget.dropped.map((d) => d.skillId).join(", ")}` : ""}`);
  if (r.reranker) lines.push(`reranker: ${r.reranker.used ? "used" : "not used"} — ${r.reranker.reason}`);
  return lines.join("\n");
}

async function skillsCommand(
  args: Args,
  root: string,
  rest: string[],
  json: boolean,
  stateDirectory: string | undefined,
  indexOptions: IndexOptions,
): Promise<number> {
  const [sub, ...params] = rest;
  const text = params.join(" ").trim();
  const registry = openRegistry(args, root, stateDirectory, sub === "index" && args.bools.has("force"));
  switch (sub) {
    case "index":
    case undefined: {
      out({ size: registry.size, report: registry.report }, json, () => {
        const r = registry.report;
        return [
          `skill registry: ${registry.size} skills (${r.mode}${r.reason ? `: ${r.reason}` : ""}) in ${r.durationMs}ms`,
          `  added ${r.added.length}, changed ${r.changed.length}, removed ${r.removed.length}, unchanged ${r.unchanged}, re-indexed ${r.reindexed}`,
          ...r.warnings.slice(0, 20).map((w) => `  warning: ${w}`),
        ].join("\n");
      });
      return 0;
    }
    case "list": {
      const category = flag(args, "category");
      const source = flag(args, "source");
      const kind = flag(args, "kind");
      const records = registry.list({ ...(category ? { category } : {}), ...(source ? { source } : {}), ...(kind ? { kind } : {}) });
      out(records.map((r) => ({ id: r.id, name: r.name, kind: r.kind, source: r.source, license: r.license, tasks: r.tasks, tokens: r.tokens })), json, () =>
        records.map((r) => `${r.id.padEnd(58)} ${r.kind.padEnd(11)} ${r.source.padEnd(22)} ${r.license.padEnd(8)} ~${r.tokens.full} tok`).join("\n") || "(no skills)",
      );
      return 0;
    }
    case "search": {
      if (!text) throw new Error("skills search needs a query");
      const hits = registry.search(text, num(args, "limit") ?? 10);
      out(hits.map((h) => ({ id: h.record.id, score: h.score, matchedTerms: h.matchedTerms, description: h.record.description })), json, () =>
        hits.map((h, i) => `${String(i + 1).padStart(2)}. ${h.score.toFixed(2)} ${h.record.id} — ${h.record.description.slice(0, 110)}`).join("\n") || "No matches.",
      );
      return 0;
    }
    case "resource": {
      const id = params[0] ?? "", name = params[1] ?? "";
      const resource = registry.resourceFiles(id).find(r => r.path === name);
      if (!resource) throw new Error(`No declared resource ${name} for ${id}`);
      out({ skillId: id, path: name, text: resource.content.toString("utf8") }, json, () => resource.content.toString("utf8"));
      return 0;
    }
    case "show": {
      const found = registry.resolve(params[0] ?? "");
      if (!found) {
        process.stderr.write(`No skill matches "${params[0] ?? ""}".\n`);
        return 2;
      }
      if ("ambiguous" in found) {
        out(found, json, () => `Ambiguous — ${found.ambiguous.length} skills:\n${found.ambiguous.map((id) => `  ${id}`).join("\n")}`);
        return 2;
      }
      const level = (flag(args, "level") ?? "routing") as SkillLevel;
      if (!SKILL_LEVELS.includes(level)) throw new Error(`--level must be one of ${SKILL_LEVELS.join(", ")}`);
      const loaded = registry.load(found.id, level);
      const { signature: _signature, ...record } = found;
      out({ record, loaded }, json, () =>
        [
          `${found.id}  (${found.kind}, ${found.source}:${found.sourcePath}@${found.sourceCommit}, ${found.license}, sha256 ${found.contentHash.slice(0, 12)})`,
          `metadata provenance: ${Object.entries(found.metadataProvenance).map(([k, v]) => `${k}=${v}`).join(" ")}`,
          `capabilities (requirements, not permissions): ${Object.entries(found.capabilities).filter(([, v]) => v).map(([k]) => k).join(", ") || "none"}${found.riskFlags.length ? `  content flags: ${found.riskFlags.join(", ")}` : ""}`,
          `tokens: metadata ${found.tokens.metadata}, summary ${found.tokens.summary}, full ${found.tokens.full}`,
          "",
          loaded.text,
        ].join("\n"),
      );
      return 0;
    }
    case "route": {
      if (!text) throw new Error("skills route needs a task");
      const budget = num(args, "budget");
      const repository = args.bools.has("no-repo") ? undefined : repositoryProfileFromEngine(FehmEngine.open(root, indexOptions));
      const options = { ...routeFlags(args, root, stateDirectory), ...(budget !== undefined ? { budget } : {}), ...(repository ? { repository } : {}) };
      const rerank = flag(args, "rerank-command");
      const result = rerank ? await routeSkillsWithReranker(registry, text, commandReranker(rerank), options) : routeSkills(registry, text, options);
      out(result, json, () => (args.bools.has("context") ? result.context || "(no skill context)" : routeText(result)));
      return 0;
    }
    case "feedback": {
      const [skillId, value] = params;
      const task = flag(args, "task");
      if (!skillId || !value || !task) throw new Error('usage: skills feedback <skill-id> <value> --task "<task>"');
      if (!registry.get(skillId)) throw new Error(`unknown skill ${skillId}`);
      const outcome = flag(args, "outcome") as "success" | "failure" | "unknown" | undefined;
      const entry = recordSkillFeedback(root, { task, skillId, feedback: value as SkillFeedbackValue, ...(outcome ? { outcome } : {}) }, stateDirectory);
      out(entry, json, () => `recorded ${entry.feedback} for ${entry.skillId}`);
      return 0;
    }
    case "install":
    case "uninstall":
    case "status": {
      const platform = flag(args, "platform");
      if (!platform) throw new Error(`skills ${sub} needs --platform`);
      let ids = params;
      const task = flag(args, "task");
      if (!ids.length && task && sub === "install") ids = routeSkills(registry, task, routeFlags(args, root, stateDirectory)).selected.map((s) => s.skillId);
      if (!ids.length) throw new Error(`skills ${sub} needs skill ids or --task`);
      const results: InstallResult[] = [];
      for (const id of ids) {
        results.push(
          await manageSkill(registry, id, sub, {
            platform,
            project: args.bools.has("project"),
            dryRun: args.bools.has("dry-run"),
            force: args.bools.has("force"),
            allowUnknownLicense: args.bools.has("allow-unknown-license"),
            cwd: root,
          }),
        );
      }
      out(results, json, () => results.map((r) => `${r.action}${r.dryRun ? " (dry run)" : ""} ${r.skillId} → ${r.path} [${r.state}]`).join("\n"));
      return 0;
    }
    case "freshness": {
      const upstream = (args.flags.get("upstream") ?? []).map((spec) => {
        const [repo, dir] = spec.split("=", 2) as [string, string | undefined];
        if (!repo || !dir) throw new Error("--upstream needs REPO=DIR");
        return checkUpstreamFreshness(registry, repo, resolve(dir));
      });
      const local = { mode: registry.report.mode, added: registry.report.added, changed: registry.report.changed, removed: registry.report.removed };
      out({ local, upstream }, json, () =>
        [
          `local catalog: ${local.mode}; added ${local.added.length}, changed ${local.changed.length}, removed ${local.removed.length}`,
          ...upstream.map((u) => `upstream ${u.repository}: checked ${u.checked} sources — current ${u.current.length}, changed ${u.changed.length}, missing ${u.missing.length}${u.changed.length ? `\n  changed: ${u.changed.map((c) => c.skillId).join(", ")}` : ""}`),
        ].join("\n"),
      );
      return upstream.some((u) => u.changed.length) ? 3 : 0;
    }
    case "eval": {
      const file = resolve(flag(args, "file") ?? "eval/skills-bench.json");
      const cases = (JSON.parse(readFileSync(file, "utf8")) as { cases: SkillBenchCase[] }).cases;
      const { results, summary } = runSkillBench(registry, cases);
      out({ summary, results }, json, () =>
        [
          `${file}: ${summary.cases} cases`,
          `recall ${summary.recall}  precision ${summary.precision}  F1 ${summary.f1}  top-1 ${summary.top[1]}  top-3 ${summary.top[3]}  top-5 ${summary.top[5]}`,
          `forbidden-hit rate ${summary.forbiddenRate}  over-selection ${summary.overSelection}  abstention ${summary.abstention.correct}/${summary.abstention.cases}  ambiguity ${summary.ambiguity.correct}/${summary.ambiguity.cases}`,
          `tokens mean ${summary.tokens.mean} max ${summary.tokens.max}  latency p50 ${summary.latencyMs.p50}ms p95 ${summary.latencyMs.p95}ms`,
        ].join("\n"),
      );
      return 0;
    }
    default:
      process.stderr.write(`Unknown skills command "${sub}".\n\n${HELP}`);
      return 2;
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: Error) => {
    process.stderr.write(`fehm: ${error.message}\n`);
    process.exit(1);
  },
);

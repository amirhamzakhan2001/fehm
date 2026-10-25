import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { BriefingFacts } from "../codebase-briefing/facts.js";
import type { Finding } from "../findings/model.js";
import { makeFinding } from "./rules.js";
import type { CiReport, GateId } from "./types.js";

/**
 * CI health: which quality gates the pipeline configuration runs. A gate is
 * "present" when a CI file invokes a recognised command for it; the exact
 * line is the evidence. Security findings about the pipeline itself
 * (permissions, untrusted checkouts) belong to Feature 3.6.
 */

const GATES: [GateId, string, RegExp][] = [
  ["build", "Build", /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?build\b|\btsc\b(?![^#\n]*--noEmit)|\bgo build\b|\bcargo build\b|\bmvn\b[^#\n]*\b(?:package|install|verify)\b|\bgradlew?\b[^#\n]*\bbuild\b|\bdocker(?:\/build-push-action| build)\b|\bmake build\b/],
  ["test", "Tests", /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b|\bnpm t\b|\bpytest\b|\bgo test\b|\bcargo test\b|\bmvn\b[^#\n]*\btest\b|\bgradlew?\b[^#\n]*\btest\b|\bjest\b|\bvitest\b|\bmake test\b|\btox\b|\bnox\b|\bnode --test\b/],
  ["lint", "Lint", /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?lint\b|\beslint\b|\bruff\b|\bflake8\b|\bpylint\b|\bgolangci-lint\b|\bgo vet\b|\bclippy\b|\bbiome\b|\bprettier\s+--check\b/],
  ["typecheck", "Type check", /\btypecheck\b|\btype-check\b|\btsc\b|\bmypy\b|\bpyright\b|\b(?:npm|pnpm|yarn)\s+(?:run\s+)?check\b/],
  ["coverage", "Coverage", /\bcoverage\b|--cov\b|\bcodecov\b|\bc8\b|\bnyc\b|\bcoveralls\b/],
  ["security", "Security scan", /\b(?:npm|pnpm|yarn) audit\b|\bsnyk\b|codeql|\btrivy\b|\bsemgrep\b|\bgitleaks\b|\btrufflehog\b|\bskylos\b|\bbandit\b|\bosv-scanner\b|dependency-review-action|\bgovulncheck\b|\bcargo audit\b|\bpip-audit\b|\bsafety check\b|\bgrype\b|\bfehm health\b/],
  ["deployment-approval", "Deployment approval", /^\s+environment:\s*\S|^\s+when:\s*manual\b/],
];
const UPDATE_BOTS = [".github/dependabot.yml", ".github/dependabot.yaml", "renovate.json", ".renovaterc", ".renovaterc.json", ".github/renovate.json"];

export function analyzeCi(root: string, facts: BriefingFacts): CiReport {
  const files = facts.configOf("ci").map((c) => c.path).sort();
  const providers = new Set<string>();
  const triggers = new Set<string>();
  const gates: CiReport["gates"] = GATES.map(([id, label]) => ({ id, label, present: false }));
  gates.splice(6, 0, { id: "dependency-updates", label: "Dependency updates", present: false });
  for (const path of files) {
    providers.add(path.startsWith(".github/") ? "GitHub Actions" : /gitlab/.test(path) ? "GitLab CI" : /circleci/.test(path) ? "CircleCI" : /azure/.test(path) ? "Azure Pipelines" : /jenkins/i.test(path) ? "Jenkins" : path);
    const lines = facts.lines(path);
    lines.forEach((raw, i) => {
      if (/^\s*#/.test(raw)) return;
      for (const t of raw.matchAll(/\b(pull_request_target|pull_request|push|schedule|workflow_dispatch|merge_requests?|release|tags)\b/g)) if (/^\s*(?:on:|-|\w+:|\[)/.test(raw) || /\bon:/.test(raw)) triggers.add(t[1]!);
      for (const [id, , re] of GATES) {
        const g = gates.find((x) => x.id === id)!;
        if (!g.present && re.test(raw)) {
          g.present = true;
          g.evidence = { path, line: i + 1, text: raw.trim().slice(0, 160) };
        }
      }
    });
  }
  const bot = UPDATE_BOTS.find((p) => existsSync(join(root, p)));
  if (bot) {
    const g = gates.find((x) => x.id === "dependency-updates")!;
    g.present = true;
    let first = "";
    try {
      first = readFileSync(join(root, bot), "utf8").split(/\r?\n/).find((l) => l.trim()) ?? "";
    } catch {
      /* the file exists; its content is not needed */
    }
    g.evidence = { path: bot, line: 1, text: first.trim().slice(0, 160) || bot };
  }
  return { files, providers: [...providers], triggers: [...triggers].sort(), gates };
}

export function ciFindings(ci: CiReport, sourceFiles: number): Finding[] {
  if (!sourceFiles) return [];
  if (!ci.files.length) {
    return [
      makeFinding("ci/no-ci", {
        id: "ci:none",
        title: "No CI configuration was found",
        message: "No GitHub Actions workflow, .gitlab-ci.yml, CircleCI, Azure Pipelines or Jenkinsfile.",
        why: "Without CI, nothing checks that a change builds and passes its tests before it is merged.",
        action: "Add a workflow that installs, builds and runs the tests on every pull request.",
        confidence: "strong",
        evidence: [{ type: "absence", detail: "Looked for .github/workflows/*.yml, .gitlab-ci.yml, .circleci/config.yml, azure-pipelines.yml, Jenkinsfile." }],
      }),
    ];
  }
  const out: Finding[] = [];
  const important: [GateId, "medium" | "low"][] = [["test", "medium"], ["build", "low"], ["security", "low"]];
  for (const [id, severity] of important) {
    const g = ci.gates.find((x) => x.id === id)!;
    if (g.present) continue;
    out.push(
      makeFinding("ci/missing-gate", {
        id: `ci:missing:${id}`,
        severity,
        title: `CI does not appear to run ${g.label.toLowerCase()}`,
        message: `None of ${ci.files.join(", ")} invokes a recognised ${g.label.toLowerCase()} command.`,
        why: id === "test" ? "Changes can merge with failing tests." : id === "build" ? "Changes can merge without compiling." : "Vulnerable dependencies and risky code patterns reach the main branch unnoticed.",
        action: `Add a ${g.label.toLowerCase()} step to the pipeline${id === "security" ? " (for example npm audit, pip-audit, govulncheck or a Fehm health run)" : ""}.`,
        confidence: "inferred",
        evidence: ci.files.map((p) => ({ type: "config" as const, path: p, detail: `no ${g.label.toLowerCase()} command recognised` })),
        missing: ["A step that calls the command through a wrapper script is not recognised; if yours does, this is a false positive."],
      }),
    );
  }
  return out;
}

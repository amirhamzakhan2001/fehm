import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import type { BriefingFacts } from "../codebase-briefing/facts.js";
import type { FehmEngine } from "../engine.js";
import type { Finding } from "../findings/model.js";
import { readJson, writeJsonAtomic } from "../persistence.js";
import { makeFinding } from "./rules.js";
import type { BuildCheck, BuildReport, CheckKind, RunResult } from "./types.js";

/**
 * Build health. Fehm detects the project's own build, test, lint and
 * type-check commands from its manifests, and reports the results of the last
 * time each was run *through Fehm*. It never runs a repository command on its
 * own: a check runs only when explicitly requested (`fehm health --run`, or
 * the page's Run button after confirming the exact command). Commands run
 * without a shell, from the detected argv only.
 */

export const RUNS_FILE = "health-runs.json";
const RUN_TIMEOUT_MS = 10 * 60_000;
const OUTPUT_TAIL = 20_000;

const SCRIPT_KIND: [RegExp, CheckKind][] = [
  [/^(?:build|compile)$/, "build"],
  [/^test$/, "test"],
  [/^lint$/, "lint"],
  [/^(?:typecheck|type-check|check|tsc|types)$/, "typecheck"],
  [/^(?:coverage|test:coverage|test:cov)$/, "coverage"],
];
const KIND_LABEL: Record<CheckKind, string> = { build: "Build", test: "Tests", lint: "Lint", typecheck: "Type check", coverage: "Coverage" };

/** Fingerprint of the index (file hashes): a run result from another fingerprint may be stale. */
export function indexFingerprint(engine: FehmEngine): string {
  const h = createHash("sha256");
  for (const [p, x] of [...engine.fileHashes()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) h.update(`${p}\0${x}\n`);
  return h.digest("hex").slice(0, 16);
}

export function detectBuild(root: string, facts: BriefingFacts): BuildReport {
  const checks: BuildCheck[] = [];
  const managers = new Set<string>();
  const systems = new Set<string>();
  const add = (kind: CheckKind, label: string, argv: string[], cwd: string, source: { path: string; line?: number }): void => {
    const id = `${kind}:${cwd || "."}:${argv.join(" ")}`;
    if (checks.some((c) => c.id === id)) return;
    checks.push({ id, kind, label, argv, cwd, display: `${cwd ? `(cd ${cwd}) ` : ""}${argv.join(" ")}`, source });
  };
  const has = (dir: string, f: string): boolean => existsSync(join(root, dir, f));

  for (const m of facts.manifests) {
    const dir = posix.dirname(m.path) === "." ? "" : posix.dirname(m.path);
    if (m.kind === "npm") {
      systems.add("npm scripts");
      const pm = has(dir, "pnpm-lock.yaml") || has("", "pnpm-lock.yaml") ? "pnpm" : has(dir, "yarn.lock") || has("", "yarn.lock") ? "yarn" : has(dir, "bun.lock") || has(dir, "bun.lockb") ? "bun" : "npm";
      managers.add(pm);
      let typecheck = false;
      for (const s of m.scripts) {
        const kind = SCRIPT_KIND.find(([re]) => re.test(s.name))?.[1];
        if (!kind || (kind === "test" && /no test specified/.test(s.command))) continue;
        if (kind === "typecheck") typecheck = true;
        add(kind, `${KIND_LABEL[kind]} (${s.name}: ${s.command.slice(0, 60)})`, pm === "yarn" ? ["yarn", s.name] : [pm, "run", s.name], dir, { path: m.path, line: s.line });
      }
      const tsconfig = posix.join(dir, "tsconfig.json");
      if (!typecheck && existsSync(join(root, tsconfig)) && m.dependencies.some((d) => d.name === "typescript")) {
        systems.add("TypeScript");
        add("typecheck", "Type check (tsc --noEmit)", ["npx", "--no-install", "tsc", "--noEmit", "-p", "tsconfig.json"], dir, { path: tsconfig });
      }
    } else if (m.kind === "python") {
      systems.add("Python");
      const names = new Set(m.dependencies.map((d) => d.name.toLowerCase()));
      const text = facts.lines(m.path).join("\n");
      managers.add(has(dir, "uv.lock") ? "uv" : has(dir, "poetry.lock") ? "poetry" : has(dir, "Pipfile.lock") ? "pipenv" : "pip");
      if (names.has("pytest") || /\[tool\.pytest/.test(text) || has(dir, "pytest.ini")) add("test", "Tests (pytest)", ["python", "-m", "pytest", "-q"], dir, { path: m.path });
      if (names.has("ruff") || /\[tool\.ruff/.test(text)) add("lint", "Lint (ruff)", ["ruff", "check", "."], dir, { path: m.path });
      if (names.has("mypy") || /\[tool\.mypy/.test(text)) add("typecheck", "Type check (mypy)", ["mypy", "."], dir, { path: m.path });
    } else if (m.kind === "go") {
      systems.add("Go");
      managers.add("go modules");
      add("build", "Build (go build)", ["go", "build", "./..."], dir, { path: m.path });
      add("test", "Tests (go test)", ["go", "test", "./..."], dir, { path: m.path });
      add("lint", "Vet (go vet)", ["go", "vet", "./..."], dir, { path: m.path });
    } else if (m.kind === "cargo") {
      systems.add("Cargo");
      managers.add("cargo");
      add("build", "Build (cargo build)", ["cargo", "build"], dir, { path: m.path });
      add("test", "Tests (cargo test)", ["cargo", "test"], dir, { path: m.path });
    } else if (m.kind === "maven") {
      systems.add("Maven");
      managers.add("maven");
      add("build", "Build (mvn package)", ["mvn", "-q", "package", "-DskipTests"], dir, { path: m.path });
      add("test", "Tests (mvn test)", ["mvn", "-q", "test"], dir, { path: m.path });
    } else if (m.kind === "gradle") {
      systems.add("Gradle");
      managers.add("gradle");
      const g = has(dir, "gradlew") ? ["./gradlew"] : ["gradle"];
      add("build", "Build (gradle build)", [...g, "build", "-x", "test"], dir, { path: m.path });
      add("test", "Tests (gradle test)", [...g, "test"], dir, { path: m.path });
    }
  }
  if (existsSync(join(root, "Makefile"))) {
    systems.add("Make");
    const lines = readFileSync(join(root, "Makefile"), "utf8").split(/\r?\n/);
    lines.forEach((l, i) => {
      const t = /^(build|test|lint|check|typecheck|coverage):/.exec(l)?.[1];
      if (!t) return;
      const kind: CheckKind = t === "check" ? "typecheck" : (t as CheckKind);
      add(kind, `${KIND_LABEL[kind]} (make ${t})`, ["make", t], "", { path: "Makefile", line: i + 1 });
    });
  }

  const report: BuildReport = { packageManagers: [...managers], systems: [...systems], checks };
  const ts = readTsconfig(root, facts);
  if (ts) report.typescript = ts;
  return report;
}

function readTsconfig(root: string, facts: BriefingFacts): BuildReport["typescript"] {
  const path = facts.configOf("typescript").map((c) => c.path).find((p) => p === "tsconfig.json") ?? facts.configOf("typescript").map((c) => c.path).find((p) => /tsconfig\.json$/.test(p));
  if (!path) return undefined;
  let text: string;
  try {
    text = readFileSync(join(root, path), "utf8");
  } catch {
    return undefined;
  }
  const lines = text.split(/\r?\n/);
  const idx = lines.findIndex((l) => /"strict"\s*:/.test(l));
  const extendsOther = /"extends"\s*:/.test(text);
  if (idx >= 0) return { path, strict: /"strict"\s*:\s*true/.test(lines[idx]!), line: idx + 1 };
  return extendsOther ? { path } : { path, strict: false };
}

interface RunStore {
  version: 1;
  results: Record<string, RunResult>;
}

export function readRuns(stateDirectory: string): Record<string, RunResult> {
  const r = readJson<RunStore>(join(stateDirectory, RUNS_FILE));
  return r.ok && r.value?.version === 1 && r.value.results ? r.value.results : {};
}

export function attachRuns(report: BuildReport, runs: Record<string, RunResult>, fingerprint: string): void {
  for (const c of report.checks) {
    const r = runs[c.id];
    if (r) c.last = { ...r, stale: r.fingerprint !== fingerprint };
    else delete c.last;
  }
}

/** Run one detected check. Only ids from `detectBuild` are accepted; argv is never taken from the caller. */
export function runCheck(root: string, stateDirectory: string | undefined, check: BuildCheck, fingerprint: string, commit: string | undefined): RunResult {
  const started = Date.now();
  const r = spawnSync(check.argv[0]!, check.argv.slice(1), { ...spawnOptions(root, check), maxBuffer: 32 * 1024 * 1024, encoding: "utf8" });
  const timedOut = (r.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT";
  return record(stateDirectory, check, fingerprint, commit, started, `${r.stdout ?? ""}${r.stderr ?? ""}${r.error ? `\n${r.error.message}` : ""}`, timedOut ? "timeout" : r.error ? "error" : r.status === 0 ? "passed" : "failed", r.status);
}

/** The same, without blocking the caller (the localhost server keeps answering while a check runs). */
export function runCheckAsync(root: string, stateDirectory: string | undefined, check: BuildCheck, fingerprint: string, commit: string | undefined): Promise<RunResult> {
  const started = Date.now();
  return new Promise((resolvePromise) => {
    let output = "";
    let settled = false;
    const keep = (chunk: Buffer): void => {
      output += chunk.toString("utf8");
      if (output.length > 4 * OUTPUT_TAIL) output = output.slice(-2 * OUTPUT_TAIL);
    };
    const child = spawn(check.argv[0]!, check.argv.slice(1), spawnOptions(root, check));
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish("timeout", null);
    }, RUN_TIMEOUT_MS);
    const finish = (status: RunResult["status"], code: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise(record(stateDirectory, check, fingerprint, commit, started, output, status, code));
    };
    child.stdout?.on("data", keep);
    child.stderr?.on("data", keep);
    child.on("error", (e) => {
      output += `\n${e.message}`;
      finish("error", null);
    });
    child.on("close", (code) => finish(code === 0 ? "passed" : "failed", code));
  });
}

function spawnOptions(root: string, check: BuildCheck): { cwd: string; timeout: number; env: NodeJS.ProcessEnv; shell: boolean } {
  return { cwd: join(root, check.cwd), timeout: RUN_TIMEOUT_MS, env: { ...process.env, CI: "1", FORCE_COLOR: "0" }, shell: process.platform === "win32" };
}

function record(stateDirectory: string | undefined, check: BuildCheck, fingerprint: string, commit: string | undefined, started: number, output: string, status: RunResult["status"], code: number | null): RunResult {
  const result: RunResult = { checkId: check.id, command: check.display, status, ...(typeof code === "number" ? { exitCode: code } : {}), durationMs: Date.now() - started, at: new Date().toISOString(), ...(commit ? { commit } : {}), fingerprint, output: output.length > OUTPUT_TAIL ? `…${output.slice(-OUTPUT_TAIL)}` : output };
  if (stateDirectory) {
    const runs = readRuns(stateDirectory);
    runs[check.id] = result;
    writeJsonAtomic(join(stateDirectory, RUNS_FILE), { version: 1, results: runs } satisfies RunStore);
  }
  return result;
}

export function buildFindings(report: BuildReport): Finding[] {
  const out: Finding[] = [];
  for (const c of report.checks) {
    if (!c.last || c.last.status === "passed") continue;
    out.push(
      makeFinding("build/check-failed", {
        id: `build:failed:${c.id}`,
        severity: c.last.stale ? "medium" : "critical",
        title: `${KIND_LABEL[c.kind]} ${c.last.status === "timeout" ? "timed out" : c.last.status === "error" ? "could not start" : "failed"}: ${c.display}`,
        message: `Last run ${c.last.at}${c.last.exitCode !== undefined ? `, exit code ${c.last.exitCode}` : ""}${c.last.stale ? ". Files changed since, so this result may be out of date" : ""}.`,
        why: "A failing build, test or type check means the current code cannot be trusted to work.",
        action: "Open the output below, fix the failure, then run the check again.",
        confidence: c.last.stale ? "inferred" : "verified",
        file: c.source.path,
        ...(c.source.line ? { line: c.source.line } : {}),
        evidence: [{ type: "runtime", path: c.source.path, ...(c.source.line ? { line: c.source.line } : {}), detail: c.last.output.trim().split("\n").slice(-6).join(" ⏎ ").slice(0, 400) || "(no output)" }],
        verification: ["Run the check again from Fehm; the finding disappears when it passes."],
      }),
    );
  }
  if (report.typescript && report.typescript.strict === false) {
    out.push(
      makeFinding("build/not-strict", {
        id: "build:not-strict",
        title: "TypeScript strict mode is off",
        message: `${report.typescript.path} does not enable "strict".`,
        why: "Without strict mode the compiler lets through null/undefined errors and implicit any, which then surface at runtime.",
        action: 'Enable "strict": true, fixing errors module by module if needed.',
        confidence: "verified",
        file: report.typescript.path,
        ...(report.typescript.line ? { line: report.typescript.line } : {}),
        evidence: [{ type: "config", path: report.typescript.path, ...(report.typescript.line ? { line: report.typescript.line } : {}), detail: report.typescript.line ? '"strict" is false' : '"strict" is not set and nothing is extended' }],
      }),
    );
  }
  return out;
}

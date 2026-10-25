import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { utimesSync } from "node:fs";
import http from "node:http";
import type net from "node:net";
import { join } from "node:path";
import { test } from "node:test";
import { FehmEngine } from "../src/engine.js";
import type { Finding } from "../src/findings/model.js";
import { advisoryFindings, checkAdvisories, cvss3, type Fetcher } from "../src/health/advisories.js";
import { runCheck } from "../src/health/build.js";
import { licensePolicy, parseHealthConfig, defaultConfig } from "../src/health/config.js";
import { cycloneDx, spdx } from "../src/health/dependencies.js";
import { buildHealthReport, renderHealthText } from "../src/health/health.js";
import { writeBaseline } from "../src/health/history.js";
import { analyzeFile } from "../src/health/metrics.js";
import type { HealthPagePayload, HealthReport } from "../src/health/types.js";
import { startServer } from "../src/server.js";
import { makeRepo, tempDir, writeFile } from "./helpers.js";

function health(root: string, state = tempDir(), extra: Partial<Parameters<typeof buildHealthReport>[0]> = {}): { report: HealthReport; engine: FehmEngine; state: string } {
  const engine = FehmEngine.open(root, { stateDirectory: state });
  return { report: buildHealthReport({ engine, stateDirectory: state, ...extra }), engine, state };
}

const byRule = (r: HealthReport, ruleId: string): Finding[] => r.findings.filter((f) => f.ruleId === ruleId);
const one = (r: HealthReport, ruleId: string): Finding => {
  const f = byRule(r, ruleId);
  assert.ok(f.length, `expected a ${ruleId} finding; have: ${[...new Set(r.findings.map((x) => x.ruleId))].join(", ")}`);
  return f[0]!;
};
const tsFile = (path: string, text: string, isTest = false) => analyzeFile({ path, hash: "h", language: "typescript", lines: text.split("\n"), isTest, functions: [] })!;

test("metrics: TypeScript complexity, nesting and parameters follow Skylos' definitions", () => {
  const r = tsFile(
    "src/a.ts",
    [
      "export function route(a: number, b: number, c: number, d: number, e: number, f: number) {",
      "  if (a > 1 && b > 2) {", //            if +1, && +1
      "    for (const x of [a]) {", //           loop +1
      "      if (x) {", //                        if +1
      "        return x ? 1 : 2;", //            ?: +1
      "      }",
      "    }",
      "  } else if (c) {", //                    else-if +1
      "    return 3;",
      "  }",
      "  try { return d ?? e; } catch { return f; }", // ?? +1, catch +1
      "}",
    ].join("\n"),
  );
  const fn = r.functions.find((f) => f.name === "route")!;
  assert.equal(fn.cyclomatic, 9);
  assert.equal(fn.params, 6);
  assert.equal(fn.nesting, 3, "if → for → if; the top-level try adds nothing");
  // Cognitive: if 1 + && 1, for 1+1 (nested once), if 1+2, ?: 1+3, else-if 1, ?? 1, catch 1 = 14.
  assert.equal(fn.cognitive, 14);
  assert.equal(fn.resolution, "ast");
});

test("metrics: reliability, dead-code and quality patterns in TypeScript", () => {
  const r = tsFile(
    "src/b.ts",
    [
      'import { used, unused } from "./lib";',
      "export async function f(items: number[]) {",
      "  try { used(); } catch (e) {}",
      "  try { used(); } catch { /* deliberately ignored */ }",
      "  items.forEach(async (i) => { await used(i); });",
      "  items.map(async (i) => used(i));",
      "  const p = new Promise(async (resolve) => resolve(1));",
      "  for (const i of items) { await used(i); }",
      "  if (items.length) { return 1; } else { return 1; }",
      "  return p;",
      "  debugger;",
      "}",
    ].join("\n"),
  );
  const rules = r.hits.map((h) => h.rule);
  for (const expected of ["reliability/empty-catch", "reliability/async-foreach", "reliability/discarded-async-map", "reliability/async-promise-executor", "reliability/await-in-loop", "quality/duplicate-branches", "dead-code/unreachable", "dead-code/unused-import"]) assert.ok(rules.includes(expected), `${expected} in ${rules.join(", ")}`);
  assert.equal(rules.filter((x) => x === "reliability/empty-catch").length, 1, "a commented empty catch is intentional");
  assert.match(r.hits.find((h) => h.rule === "dead-code/unused-import")!.detail, /^unused /);
  assert.ok(rules.includes("quality/debug-leftover"), "the debugger statement is reported even though it is also unreachable");
});

test("metrics: heuristic Python analysis over the Feature 1 function ranges", () => {
  const root = makeRepo({
    "app.py": ["import os", "import requests", "", "def handler(a, b):", "    if a and b:", "        for x in a:", "            if x:", "                return requests.get(x)", "    try:", "        pass", "    except:", "        pass", "    return None", ""].join("\n"),
  });
  const { report } = health(root);
  const fn = report.quality.top.find((f) => f.name === "handler")!;
  assert.equal(fn.resolution, "heuristic");
  assert.equal(fn.cyclomatic, 6, "if, and, for, if, except");
  assert.equal(fn.nesting, 3);
  assert.equal(fn.params, 2);
  assert.ok(one(report, "reliability/bare-except"));
  assert.match(one(report, "reliability/missing-timeout").evidence[0]!.detail, /requests\.get/);
  assert.ok(one(report, "dead-code/unused-import").evidence.some((e) => /\bos\b/.test(e.detail)));
  const py = report.languages.find((l) => l.language === "python")!;
  assert.equal(py.checks.cognitive, "unsupported");
  assert.equal(py.checks.complexity, "heuristic");
});

const TESTED = {
  "package.json": JSON.stringify({ name: "demo", version: "1.0.0", scripts: { test: "node --test" } }, null, 2),
  "src/auth.ts": "export function login(user: string, password: string): boolean {\n  if (!user) throw new Error('user');\n  return password.length > 8;\n}\n",
  "src/math.ts": "export function add(a: number, b: number) { return a + b; }\nexport function sub(a: number, b: number) { return a - b; }\n",
  "src/api.ts": 'import { login } from "./auth";\nimport { add } from "./math";\nexport function session(u: string, p: string) { return login(u, p) ? add(1, 2) : 0; }\nexport function token(u: string) { return login(u, u) ? session(u, u) : 0; }\nexport function refresh(u: string) { return token(u); }\nexport function logout(u: string) { return token(u) + session(u, u); }\n',
  "src/server.ts": 'import { session, token } from "./api";\nexport function handle(u: string) { return session(u, u) + token(u); }\n',
  "test/math.test.ts": 'import { test, it } from "node:test";\nimport assert from "node:assert";\nimport { add } from "../src/math";\nimport { login } from "../src/auth";\ntest("adds", () => { assert.equal(add(1, 2), 3); });\ntest("logs in", () => { assert.ok(login("a", "long-password")); });\nit.only("focus", () => { expect(true).toBe(true); });\nit.skip("later", () => {});\ntest("empty", () => {});\ntest("no assertion", () => { add(1, 1); });\n',
};

test("tests: inventory, weak tests, structural protection and risk-ranked gaps", () => {
  const { report } = health(makeRepo(TESTED));
  const t = report.tests.totals;
  assert.equal(t.files, 1);
  assert.equal(t.cases, 6);
  assert.equal(t.focused, 1);
  assert.equal(t.skipped, 1);
  assert.equal(t.empty, 1);
  assert.equal(t.assertionless, 1);
  assert.equal(t.tautologies, 1);
  assert.equal(report.tests.files[0]!.framework, "node:test");
  for (const r of ["test/focused-test", "test/skipped-test", "test/empty-test", "test/assertionless-test", "ai-code/weakened-test"]) assert.ok(one(report, r));
  assert.equal(one(report, "test/focused-test").severity, "high");
  // add and login are called from the test; sub is not.
  const gapNames = report.tests.gaps.map((g) => g.name);
  assert.ok(!gapNames.includes("add"));
  assert.equal(report.coverage.structural.symbols >= 7, true);
  assert.ok(report.coverage.structural.direct >= 2);
  // session/token are security-sensitive and used from other functions: risky and untested.
  const gap = report.tests.gaps.find((g) => g.name === "session");
  assert.ok(gap && gap.security, `session gap in ${gapNames.join(", ")}`);
  assert.ok(byRule(report, "test/critical-gap").some((f) => f.symbol === "session"));
  // login is tested only on the success path (no toThrow/rejects/4xx in its test file).
  assert.ok(one(report, "test/no-failure-path").evidence.some((e) => e.detail.startsWith("login")));
  const dim = report.dimensions.find((d) => d.id === "tests")!;
  assert.equal(dim.metric?.unit, "%");
  assert.equal(report.dimensions.find((d) => d.id === "coverage")!.status, "unknown", "no artifact → unknown, never 0%");
});

test("tests: a repository without tests is critical for the tests dimension", () => {
  const { report } = health(makeRepo({ "src/a.ts": "export const a = 1;\n" }));
  assert.equal(one(report, "test/no-tests").severity, "critical");
  assert.equal(report.dimensions.find((d) => d.id === "tests")!.status, "critical");
});

test("coverage: LCOV lines drive runtime protection; staleness is detected; other formats parse", () => {
  const root = makeRepo({
    ...TESTED,
    "coverage/lcov.info": ["TN:", "SF:src/math.ts", "FNF:2", "FNH:1", "DA:1,3", "DA:2,0", "LF:2", "LH:1", "end_of_record", "SF:/elsewhere/not-indexed.ts", "DA:1,1", "end_of_record", ""].join("\n"),
  });
  const past = new Date(Date.now() - 3_600_000);
  utimesSync(join(root, "coverage/lcov.info"), past, past);
  utimesSync(join(root, "src/math.ts"), past, past);
  const { report } = health(root);
  const rt = report.coverage.runtime!;
  assert.equal(rt.artifacts[0]!.format, "lcov");
  assert.deepEqual(rt.totals.lines, { covered: 1, total: 2, pct: 50 });
  assert.deepEqual(rt.totals.functions, { covered: 1, total: 2, pct: 50 });
  assert.equal(rt.unmatchedRecords, 1);
  assert.deepEqual(rt.artifacts[0]!.staleFiles, []);
  assert.equal(report.dimensions.find((d) => d.id === "coverage")!.metric?.value, 50);
  // sub (line 2) was never executed: runtime says unprotected even though nothing else is known.
  assert.ok(report.tests.gaps.every((g) => g.name !== "add"));
  // Touch the source after the artifact: stale.
  writeFile(root, "src/math.ts", "export function add(a: number, b: number) { return a + b; }\nexport function sub(a: number, b: number) { return a - b; }\n// changed\n");
  const again = health(root).report;
  assert.deepEqual(again.coverage.runtime!.artifacts[0]!.staleFiles, ["src/math.ts"]);
  assert.ok(one(again, "coverage/stale-artifact"));

  const other = makeRepo({
    "pkg/a.go": "package pkg\nfunc A() int {\n  return 1\n}\n",
    "go.mod": "module example.com/m\n\ngo 1.22\n",
    "coverage.out": "mode: set\nexample.com/m/pkg/a.go:2.14,4.2 1 1\n",
    "src/b.py": "def b():\n    return 1\n",
    "coverage.xml": '<?xml version="1.0"?><coverage line-rate="0.5"><sources><source>/abs/src</source></sources><packages><package><classes><class name="b" filename="b.py" line-rate="0.5"><lines><line number="1" hits="1"/><line number="2" hits="0" branch="true" condition-coverage="50% (1/2)"/></lines></class></classes></package></packages></coverage>',
  });
  const o = health(other).report;
  assert.equal(o.coverage.runtime!.artifacts[0]!.format, "cobertura", "Cobertura is preferred over the Go profile (listed first among line formats)");
  assert.deepEqual(o.coverage.runtime!.totals.branches, { covered: 1, total: 2, pct: 50 });
  assert.ok(o.coverage.detected.some((d) => d.path === "coverage.out" && /Also present/.test(d.problem)));
});

test("dead code: each verdict carries its evidence, and keep-alive checks win", () => {
  const root = makeRepo({
    "package.json": JSON.stringify({ name: "lib", main: "src/index.ts" }),
    "src/index.ts": 'export { api } from "./api";\n',
    "src/api.ts": "export function api() { return helper(); }\nfunction helper() { return 1; }\nfunction orphan() { return 2; }\nexport function lonely() { return 3; }\n",
    "src/plugins.ts": 'export function registered() { return 1; }\nconst table = { name: "registered" };\nexport const t = table;\n',
    "src/orphan-file.ts": "export const nothing = 1;\n",
    "src/views.py": "@app.route('/x')\ndef view():\n    return 1\n",
  });
  const { report } = health(root);
  const d = report.deadCode;
  const item = (name: string) => [...d.items, ...d.kept].find((i) => i.name.endsWith(name));
  assert.equal(item("orphan")?.state, "definitely-unused");
  assert.ok(item("orphan")!.evidence.every((e) => e.passed));
  assert.equal(item("lonely")?.state, "external-api", "exported from the package main file");
  assert.equal(item("registered")?.state, "dynamic-reference", "named in a string");
  assert.equal(item("view")?.state, "framework-entrypoint");
  assert.ok(!item("helper"), "helper is called");
  assert.ok(d.unusedFiles.some((f) => f.path === "src/orphan-file.ts"));
  assert.ok(byRule(report, "dead-code/unused-symbol").some((f) => f.symbol === "orphan" && f.confidence === "strong"));
});

test("dependencies: lockfile inventory, depth, licenses as declared, policy, SBOM", () => {
  const lock = {
    name: "app",
    lockfileVersion: 3,
    packages: {
      "": { name: "app", dependencies: { left: "^1.0.0", copyleft: "^2.0.0" }, devDependencies: { tool: "*" } },
      "node_modules/left": { version: "1.2.0", license: "MIT", dependencies: { deep: "^1" } },
      "node_modules/deep": { version: "1.0.0" },
      "node_modules/copyleft": { version: "2.0.0", license: "GPL-3.0-only" },
      "node_modules/tool": { version: "0.1.0", license: "MIT", dev: true },
      "node_modules/left/node_modules/deep": { version: "0.9.0", license: "ISC" },
    },
  };
  const root = makeRepo({
    "package.json": JSON.stringify({ name: "app", version: "1.0.0", dependencies: { left: "^1.0.0", copyleft: "^2.0.0" }, devDependencies: { tool: "*" } }, null, 2),
    "package-lock.json": JSON.stringify(lock),
    "src/a.ts": 'import left from "left";\nimport c from "copyleft";\nexport const x = [left, c];\n',
    "py/requirements.txt": "requests\n",
    "py/app.py": "import requests\n",
  });
  const { report } = health(root);
  const d = report.dependencies;
  const deep = d.components.filter((c) => c.name === "deep");
  assert.deepEqual(deep.map((c) => c.version).sort(), ["0.9.0", "1.0.0"]);
  assert.equal(deep.find((c) => c.version === "1.0.0")!.license, "NOASSERTION", "no license declared → NOASSERTION, never guessed");
  assert.equal(deep.find((c) => c.version === "0.9.0")!.depth, 2);
  assert.equal(d.counts.duplicates, 1);
  assert.equal(d.components.find((c) => c.name === "left")!.importers, 1);
  assert.ok(one(report, "dependency/license-review").evidence.some((e) => /copyleft@2\.0\.0: GPL-3\.0-only/.test(e.detail)));
  assert.ok(one(report, "dependency/unpinned-version").evidence.some((e) => /tool: "\*"/.test(e.detail)));
  assert.ok(one(report, "dependency/no-lockfile").evidence.some((e) => e.path === "py/requirements.txt"));
  assert.equal(d.advisories.status, "not-checked");

  const subject = { name: "app", components: d.components, toolVersion: "t", generatedAt: "2026-01-01T00:00:00.000Z" };
  const cdx = cycloneDx(subject) as { specVersion: string; components: { purl: string; licenses?: unknown }[] };
  assert.equal(cdx.specVersion, "1.5");
  assert.ok(cdx.components.some((c) => c.purl === "pkg:npm/left@1.2.0" && c.licenses));
  assert.ok(cdx.components.some((c) => c.purl === "pkg:npm/deep@1.0.0" && !c.licenses));
  const sp = spdx(subject) as { spdxVersion: string; packages: { licenseDeclared: string; name: string }[] };
  assert.equal(sp.spdxVersion, "SPDX-2.3");
  assert.equal(sp.packages.find((p) => p.name === "deep" && p.licenseDeclared === "NOASSERTION")?.name, "deep");

  const cfg = defaultConfig();
  assert.equal(licensePolicy("MIT OR GPL-3.0-only", cfg), "allowed", "a permissive choice exists");
  assert.equal(licensePolicy("MIT AND GPL-3.0-only", cfg), "review");
  assert.equal(licensePolicy("NOASSERTION", cfg), "unknown");
});

test("advisories: opt-in OSV lookup through an injected fetcher, severities, caching and staleness", async () => {
  assert.equal(cvss3("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H"), 9.8);
  assert.equal(cvss3("CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N"), 6.1);
  const calls: string[] = [];
  const fetcher: Fetcher = async (url, init) => {
    calls.push(url);
    if (url.endsWith("/querybatch")) {
      const q = JSON.parse(init!.body!) as { queries: { package: { name: string } }[] };
      return { ok: true, status: 200, json: async () => ({ results: q.queries.map((x) => (x.package.name === "left" ? { vulns: [{ id: "GHSA-1" }] } : {})) }) };
    }
    return { ok: true, status: 200, json: async () => ({ id: "GHSA-1", summary: "Prototype pollution", aliases: ["CVE-2026-0001"], database_specific: { severity: "HIGH" } }) };
  };
  const components = [{ name: "left", version: "1.2.0", ecosystem: "npm" as const, direct: true, dev: false, license: "MIT", licenseSource: "lockfile" as const, purl: "pkg:npm/left@1.2.0" }];
  const state = tempDir();
  const r = await checkAdvisories(state, components, fetcher);
  assert.equal(r.status, "checked");
  assert.deepEqual(r.items.map((i) => [i.id, i.severity]), [["GHSA-1", "high"]]);
  assert.ok(calls.some((c) => c.includes("api.osv.dev")));
  const f = advisoryFindings(r, components);
  assert.equal(f[0]!.severity, "high");
  assert.match(f[0]!.message, /CVE-2026-0001/);
  const failing: Fetcher = async () => ({ ok: false, status: 503, json: async () => ({}) });
  assert.equal((await checkAdvisories(undefined, components, failing)).status, "error");
});

test("AI-code indicators: phantom imports, undeclared packages, disabled controls — and pattern text does not flag itself", () => {
  const root = makeRepo({
    "package.json": JSON.stringify({ name: "x", dependencies: { real: "1.0.0" } }),
    "src/a.ts": 'import { ghost } from "./does-not-exist";\nimport real from "real";\nimport made from "made-up-sdk";\nimport { join } from "node:path";\nexport const agent = { rejectUnauthorized: false, x: [ghost, real, made, join] };\nexport const key = "your-api-key";\n',
    "src/rules.ts": 'export const patterns = [/rejectUnauthorized\\s*:\\s*false/, "turning off rejectUnauthorized: false is bad"];\nexport const why = "Filler text and your-api-key strings mean unfinished work.";\n',
  });
  const { report } = health(root);
  assert.match(one(report, "ai-code/phantom-import").evidence[0]!.detail, /does-not-exist/);
  const undeclared = one(report, "ai-code/undeclared-package").evidence.map((e) => e.detail);
  assert.ok(undeclared.some((d) => d.includes('"made-up-sdk"')));
  assert.ok(!undeclared.some((d) => d.includes('"real"') || d.includes("node:path")));
  const disabled = one(report, "ai-code/disabled-control");
  assert.deepEqual(disabled.evidence.map((e) => e.path), ["src/a.ts"]);
  assert.deepEqual(one(report, "ai-code/placeholder-data").evidence.map((e) => e.path), ["src/a.ts"]);
});

test("build and CI: detected checks never run on their own; a requested run records pass, fail and staleness", () => {
  const root = makeRepo({
    "package.json": JSON.stringify({ name: "b", scripts: { build: "node -e \"process.exit(0)\"", test: "node -e \"console.log('boom'); process.exit(3)\"", lint: "node -e 0" } }, null, 2),
    "package-lock.json": JSON.stringify({ lockfileVersion: 3, packages: { "": {} } }),
    "tsconfig.json": '{ "compilerOptions": { "strict": false } }\n',
    ".github/workflows/ci.yml": "on: [push, pull_request]\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm ci\n      - run: npm test\n",
    "src/a.ts": "export const a = 1;\n",
  });
  const state = tempDir();
  let { report, engine } = health(root, state);
  assert.deepEqual(report.build.checks.map((c) => `${c.kind}:${c.display}`).sort(), ["build:npm run build", "lint:npm run lint", "test:npm run test"]);
  assert.ok(report.build.checks.every((c) => !c.last), "nothing ran");
  assert.equal(report.dimensions.find((d) => d.id === "build")!.status, "unknown");
  assert.ok(one(report, "build/not-strict"));
  const gates = Object.fromEntries(report.ci.gates.map((g) => [g.id, g.present]));
  assert.equal(gates.test, true);
  assert.equal(gates.build, false);
  assert.deepEqual(report.ci.triggers, ["pull_request", "push"]);
  assert.ok(byRule(report, "ci/missing-gate").some((f) => f.id === "ci:missing:security"));

  const test_ = report.build.checks.find((c) => c.kind === "test")!;
  const r = runCheck(root, state, test_, "fp-now", undefined);
  assert.equal(r.status, "failed");
  assert.equal(r.exitCode, 3);
  assert.match(r.output, /boom/);
  report = buildHealthReport({ engine, stateDirectory: state });
  const failed = one(report, "build/check-failed");
  assert.equal(failed.severity, "medium", "fingerprint differs from the index: result is stale");
  assert.equal(report.build.checks.find((c) => c.kind === "test")!.last!.stale, true);
  void engine;
});

test("findings lifecycle: baseline splits new from existing; reviews hide suppressed findings from the counts", () => {
  const root = makeRepo(TESTED);
  const { report, engine, state } = health(root);
  writeBaseline(state, report.findings.filter((f) => f.ruleId !== "test/focused-test"));
  const again = buildHealthReport({ engine, stateDirectory: state });
  assert.equal(again.baseline!.added, 1);
  assert.equal(one(again, "test/focused-test").baseline, "new");
  assert.ok(again.findings.filter((f) => f.ruleId !== "test/focused-test").every((f) => f.baseline === "existing"));
  const text = renderHealthText(again);
  assert.match(text, /1 new since baseline/);
});

test("config: validation by JSON path, thresholds and ignores apply, bad files fall back to defaults", () => {
  const bad = parseHealthConfig({ thresholds: { cyclomatic: -1, nope: 3 }, coverage: ["../x"], licenses: { deny: [1] }, extra: true });
  assert.equal(bad.ok, false);
  const issues = (bad as { issues: string[] }).issues.join("\n");
  for (const p of ["$.thresholds.cyclomatic", "$.thresholds.nope", "$.coverage", "$.licenses.deny", "$.extra"]) assert.ok(issues.includes(p), `${p} in ${issues}`);

  const src = "export function f(a: number) {\n  if (a) { if (a > 1) { return 1; } }\n  return 0;\n}\n";
  const root = makeRepo({ "src/f.ts": src, "src/gen/g.ts": src, ".fehm/health.json": JSON.stringify({ thresholds: { cyclomatic: 2 }, ignore: ["src/gen/**"] }) });
  const { report } = health(root);
  assert.equal(report.config.file, ".fehm/health.json");
  const cyc = byRule(report, "quality/cyclomatic-complexity");
  assert.deepEqual(cyc.map((f) => f.file), ["src/f.ts"]);
  assert.equal(cyc[0]!.upstream, "SKY-Q301");

  writeFile(root, ".fehm/health.json", "{ not json");
  const fallback = health(root).report;
  assert.equal(fallback.config.issues.length, 1);
  assert.equal(byRule(fallback, "quality/cyclomatic-complexity").length, 0, "defaults (10) apply");
});

test("provenance and trend: the digest is reproducible and changes with the inputs; trend points accumulate per distinct analysis", () => {
  const root = makeRepo({ "src/a.ts": "export function a() { return 1; }\n" });
  const state = tempDir();
  const first = health(root, state).report;
  const second = health(root, state).report;
  assert.equal(first.provenance.digest, second.provenance.digest);
  assert.equal(second.trend.length, 1, "same digest → no new point");
  writeFile(root, "src/a.ts", "export function a() { return 2; }\n");
  const third = health(root, state).report;
  assert.notEqual(third.provenance.digest, first.provenance.digest);
  assert.equal(third.trend.length, 2);
  const dry = health(root, tempDir(), { dryRun: true }).report;
  assert.equal(dry.trend.length, 1);
  assert.ok(first.unknowns.some((u) => /Runtime coverage/.test(u)));
  assert.ok(first.analyzers.some((a) => a.id === "advisories" && a.status === "skipped"));
});

test("changed-files scope keeps only findings in files changed since HEAD", () => {
  const root = makeRepo({ "src/a.ts": "export function a(p1: number, p2: number, p3: number, p4: number, p5: number, p6: number) { return p1; }\n", "src/b.ts": "export function b(p1: number, p2: number, p3: number, p4: number, p5: number, p6: number) { return p1; }\n" });
  const git = (...a: string[]): void => void execFileSync("git", ["-C", root, ...a], { stdio: "ignore" });
  git("init", "-q");
  git("-c", "user.email=t@t", "-c", "user.name=t", "add", ".");
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");
  writeFile(root, "src/b.ts", "export function b(p1: number, p2: number, p3: number, p4: number, p5: number, p6: number, p7: number) { return p1; }\n");
  const { report } = health(root, tempDir(), { scope: "changed" });
  assert.deepEqual(report.git.changed, ["src/b.ts"]);
  assert.deepEqual([...new Set(byRule(report, "quality/too-many-params").map((f) => f.file))], ["src/b.ts"]);
  assert.equal(report.git.available, true);
});

function request(port: number, path: string, method = "GET", headers: Record<string, string> = {}): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolvePromise, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path, method, headers }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolvePromise({ status: res.statusCode ?? 0, body, headers: res.headers }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("server: /health page, payload, guarded writes, reviews, SBOM download and source excerpts", async () => {
  const root = makeRepo(TESTED);
  const server = await startServer(root, 0, { stateDirectory: tempDir() });
  const port = (server.address() as net.AddressInfo).port;
  try {
    const page = await request(port, "/health");
    assert.equal(page.status, 200);
    assert.match(page.body, /\/health\/assets\/health\/ui\/main\.js/);
    assert.match(String(page.headers["content-security-policy"]), /frame-ancestors 'self'/);
    assert.equal((await request(port, "/health/assets/health/ui/main.js")).status, 200);
    const payload = JSON.parse((await request(port, "/api/health")).body) as HealthPagePayload;
    assert.equal(payload.writable, true);
    assert.ok(payload.dimensions.length >= 10);
    const focused = payload.findings.find((f) => f.ruleId === "test/focused-test")!;

    assert.equal((await request(port, `/api/health/review?id=${encodeURIComponent(focused.id)}&status=suppressed`, "POST")).status, 403, "x-fehm header required");
    assert.equal((await request(port, "/api/health/review?id=x&status=bogus", "POST", { "x-fehm": "1" })).status, 409);
    assert.equal((await request(port, `/api/health/review?id=${encodeURIComponent(focused.id)}&status=suppressed&note=known`, "POST", { "x-fehm": "1" })).status, 200);
    const after = JSON.parse((await request(port, "/api/health")).body) as HealthPagePayload;
    assert.equal(after.findings.find((f) => f.id === focused.id)!.review?.status, "suppressed");
    assert.equal(after.summary.bySeverity.high, payload.summary.bySeverity.high - 1);
    assert.equal((await request(port, "/api/health/run?check=nope", "POST", { "x-fehm": "1" })).status, 409, "only detected check ids run");

    const sbom = await request(port, "/api/health/sbom?format=spdx");
    assert.match(String(sbom.headers["content-disposition"]), /sbom\.spdx\.json/);
    assert.equal((JSON.parse(sbom.body) as { spdxVersion: string }).spdxVersion, "SPDX-2.3");
    assert.equal((await request(port, "/api/health/source?path=src/auth.ts&line=2")).status, 200);
    assert.equal((await request(port, "/api/health/source?path=/etc/passwd&line=1")).status, 404);
    assert.equal((await request(port, "/api/health/baseline", "POST", { "x-fehm": "1" })).status, 200);
    const based = JSON.parse((await request(port, "/api/health")).body) as HealthPagePayload;
    assert.equal(based.baseline?.added, 0);
  } finally {
    server.close();
  }
});

test("CLI: fehm health prints the report and --fail-on gates CI", () => {
  const root = makeRepo(TESTED);
  const cli = join(process.cwd(), "src/cli.ts");
  const run = (...a: string[]): { status: number; out: string } => {
    try {
      return { status: 0, out: execFileSync(process.execPath, ["--import", "tsx", cli, "health", "--root", root, "--state-dir", tempDir(), ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) };
    } catch (e) {
      const err = e as { status: number; stdout: string };
      return { status: err.status, out: err.stdout };
    }
  };
  const text = run();
  assert.equal(text.status, 0);
  assert.match(text.out, /Project health — fehm-test-/);
  assert.match(text.out, /Not determined:/);
  assert.equal(run("--fail-on", "high").status, 1, "a focused test is a high finding");
  assert.equal(run("--fail-on", "critical").status, 0);
  const json = JSON.parse(run("--json").out) as HealthReport;
  assert.equal(json.schemaVersion, "1.0");
  assert.equal((JSON.parse(run("--sbom", "cyclonedx").out) as { bomFormat: string }).bomFormat, "CycloneDX");
});

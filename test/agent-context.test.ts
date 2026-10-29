import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { buildAgentContext } from "../src/agent-context.js";
import { estimateTokens } from "../src/compression.js";
import { FehmEngine } from "../src/engine.js";
import { installedSkillName, integrationPlatforms, manageSkill } from "../src/integrations.js";
import { repositoryProfileFromEngine } from "../src/skill-profile.js";
import { corpusCopy, REPO_ROOT, tempDir } from "./helpers.js";
import { makeCatalog, prose, registryOf } from "./skill-fixtures.js";

const corpus = corpusCopy();
const engine = FehmEngine.open(corpus, { stateDirectory: tempDir() });
const catalog = makeCatalog(
  [
    { id: "debugging/systematic", description: "Find the root cause of bugs, crashes and failing behaviour before fixing.", intents: ["debug"], body: prose("debugging", 2500) },
    { id: "testing/tdd", description: "Write the failing test first, then the code.", intents: ["test"], body: prose("testing", 2500) },
    { id: "frameworks/express/express-patterns", description: "Express middleware and routing patterns.", body: prose("express", 800) },
    { id: "misc/unknown-license", description: "Debug helper with unclear origin.", repository: "mystery" },
  ],
  { intents: { debug: ["debugging/systematic"], test: ["testing/tdd"] } },
);
const registry = registryOf(catalog);

// ── Feature 1 integration ────────────────────────────────────────────────

test("agent context: Feature 2 consumes Feature 1's repository profile instead of re-scanning", () => {
  const repo = repositoryProfileFromEngine(engine);
  assert.ok(repo.technologies.includes("express") && repo.technologies.includes("typescript"), JSON.stringify(repo));
});

test("agent context: skills + code in one budget; each part within its share", () => {
  const ctx = buildAgentContext(engine, "Fix the authentication bug in token validation and add tests", { registry, totalBudget: 8000, skillBudget: 1500, codeBudget: 4000, taskBudget: 200 });
  assert.equal(ctx.schemaVersion, "1.0");
  assert.ok(ctx.skills!.selected.some((s) => s.skillId === "debugging/systematic"));
  assert.ok(ctx.budget.skills.used <= 1500);
  assert.ok(ctx.budget.code.used <= ctx.budget.code.maximum);
  assert.ok(ctx.budget.task.used <= 200);
  assert.ok(estimateTokens(ctx.markdown) <= 8000);
  assert.equal(ctx.budget.code.reallocatedFromSkills, 1500 - ctx.budget.skills.used);
  const order = ["# Task", "# Active Skill Context", "# fehm context:"].map((h) => ctx.markdown.indexOf(h));
  assert.ok(order.every((i, k) => i >= 0 && (k === 0 || i > order[k - 1]!)), `sections in order: ${order}`);
  assert.ok(ctx.code.recommendedNodes.some((i) => i.path?.startsWith("src/auth/")), "Feature 1 still selects the code");
  assert.equal(ctx.skills!.profile.repository?.technologies.includes("express"), true);
});

test("agent context: skills can be disabled; the split is validated", () => {
  const ctx = buildAgentContext(engine, "Fix the authentication bug", { registry: null });
  assert.equal(ctx.skills, null);
  assert.doesNotMatch(ctx.markdown, /Active Skill Context/);
  assert.throws(() => buildAgentContext(engine, "x", { registry, totalBudget: 1000, skillBudget: 600, codeBudget: 600 }), /exceeds total/);
});

// ── Installation mode ────────────────────────────────────────────────────

test("installation: every platform/scope installs, is idempotent, and uninstalls only its skill", async () => {
  const home = tempDir();
  const cwd = tempDir();
  writeFileSync(join(cwd, "AGENTS.md"), "Keep my instructions.\n");
  for (const platform of Object.keys(integrationPlatforms)) {
    for (const project of [true, false]) {
      const o = { platform, project, home, cwd };
      const preview = await manageSkill(registry, "testing/tdd", "install", { ...o, dryRun: true });
      assert.equal(preview.state, "missing");
      const installed = await manageSkill(registry, "testing/tdd", "install", o);
      assert.ok(installed.path.startsWith(project ? cwd : home));
      assert.ok(installed.path.includes(installedSkillName("testing/tdd")));
      assert.ok(readFileSync(installed.path, "utf8").startsWith(registry.source("testing/tdd")), "installed verbatim");
      assert.equal((await manageSkill(registry, "testing/tdd", "install", o)).state, "current");
      await manageSkill(registry, "testing/tdd", "uninstall", o);
      assert.equal((await manageSkill(registry, "testing/tdd", "status", o)).state, "missing");
    }
  }
  assert.equal(readFileSync(join(cwd, "AGENTS.md"), "utf8"), "Keep my instructions.\n");
});

test("installation: customized files are preserved; symlinks and unknown licenses are refused", async () => {
  const cwd = tempDir();
  const o = { platform: "claude", project: true, cwd };
  const { path: file } = await manageSkill(registry, "testing/tdd", "install", o);
  writeFileSync(file, `${readFileSync(file, "utf8")}\nmy edit\n`);
  assert.equal((await manageSkill(registry, "testing/tdd", "status", o)).state, "customized");
  await assert.rejects(manageSkill(registry, "testing/tdd", "install", o), /Preserving customized/);
  await manageSkill(registry, "testing/tdd", "install", { ...o, force: true });
  assert.equal(readdirSync(dirname(file)).filter((f) => f.endsWith(".bak")).length, 1);

  const evil = tempDir();
  const outside = tempDir();
  mkdirSync(join(evil, ".claude"), { recursive: true });
  symlinkSync(outside, join(evil, ".claude", "skills"));
  await assert.rejects(manageSkill(registry, "testing/tdd", "install", { platform: "claude", project: true, cwd: evil }), /symlinked/);

  await assert.rejects(manageSkill(registry, "misc/unknown-license", "install", o), /license unknown/);
  await manageSkill(registry, "misc/unknown-license", "install", { ...o, allowUnknownLicense: true });
});

// ── CLI ──────────────────────────────────────────────────────────────────

const state = tempDir();
function cli(...args: string[]) {
  const r = spawnSync(process.execPath, ["--import", "tsx", join(REPO_ROOT, "src/cli.ts"), ...args, "--skills", catalog, "--state-dir", state], { cwd: REPO_ROOT, encoding: "utf8" });
  return { code: r.status, out: r.stdout, err: r.stderr, json: () => JSON.parse(r.stdout) };
}

test("cli: skills index/list/search/show/route/feedback/freshness/eval and agent-context", () => {
  assert.equal(cli("skills", "index", "--json").json().report.mode, "full");
  assert.equal(cli("skills", "index", "--json").json().report.mode, "cache-hit");
  assert.equal(cli("skills", "list", "--json").json().length, 4);
  assert.equal(cli("skills", "search", "root cause of crashes", "--json").json()[0].id, "debugging/systematic");
  const show = cli("skills", "show", "testing/tdd", "--level", "summary", "--json").json();
  assert.equal(show.loaded.level, "summary");
  assert.equal(show.record.metadataProvenance.tasks, "catalog");
  assert.equal(cli("skills", "show", "nope").code, 2);
  const route = cli("skills", "route", "Fix the crash bug and add tests", "--root", corpus, "--json").json();
  assert.equal(route.selected[0].skillId, "debugging/systematic");
  assert.ok(route.profile.repository.technologies.includes("express"));
  assert.match(cli("skills", "route", "Fix the crash bug", "--no-repo").out, /primary\s+debugging\/systematic/);
  assert.equal(cli("skills", "feedback", "testing/tdd", "useful", "--task", "add tests", "--root", corpus, "--json").json().feedback, "useful");
  assert.equal(cli("skills", "freshness", "--json").json().upstream.length, 0);
  const ctx = cli("agent-context", "Fix the authentication bug", "--root", corpus, "--json").json();
  assert.ok(ctx.skills.selected.length >= 1 && ctx.code.recommendedNodes.length >= 1);
  assert.match(cli("skills", "eval", "--file", join(REPO_ROOT, "eval/skills-bench.json")).out, /F1/);
});

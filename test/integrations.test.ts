import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { integrationPlatforms, manageIntegration } from "../src/integrations.js";

test("assistant installation selects each scope, is idempotent, and uninstalls only its skill", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fehm-integrations-"));
  try {
    const home = path.join(root, "home");
    const cwd = path.join(root, "repo");
    await mkdir(cwd, { recursive: true });
    await writeFile(path.join(cwd, "AGENTS.md"), "Keep my existing instructions.\n");
    for (const platform of Object.keys(integrationPlatforms)) {
      for (const project of [true, false]) {
        const options = { platform, project, home, cwd };
        const preview = await manageIntegration("install", { ...options, dryRun: true });
        assert.equal(preview.state, "missing");
        await assert.rejects(readFile(preview.path), { code: "ENOENT" });
        const installed = await manageIntegration("install", options);
        assert.ok(installed.path.startsWith(project ? cwd : home));
        const content = await readFile(installed.path, "utf8");
        assert.match(content, /name: fehm/);
        assert.match(content, /fehm query/);
        assert.equal((await manageIntegration("install", options)).state, "current");
        assert.equal(await readFile(installed.path, "utf8"), content);
        assert.equal((await manageIntegration("status", options)).state, "current");
        await manageIntegration("uninstall", options);
        assert.equal((await manageIntegration("status", options)).state, "missing");
        await manageIntegration("uninstall", options);
      }
    }
    assert.equal(await readFile(path.join(cwd, "AGENTS.md"), "utf8"), "Keep my existing instructions.\n");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("customized skills survive install/uninstall unless explicitly backed up with force", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "fehm-custom-skill-"));
  try {
    const options = { platform: "claude", project: true, cwd };
    const { path: file } = await manageIntegration("install", options);
    const customized = (await readFile(file, "utf8")).replace("# Fehm", "# My Fehm");
    await writeFile(file, customized);
    assert.equal((await manageIntegration("status", options)).state, "customized");
    for (const action of ["install", "uninstall"] as const) {
      await assert.rejects(manageIntegration(action, options), /Preserving customized/);
    }
    await manageIntegration("install", { ...options, force: true });
    const backups = (await readdir(path.dirname(file))).filter(f => f.endsWith(".bak"));
    assert.equal(backups.length, 1);
    assert.equal(await readFile(path.join(path.dirname(file), backups[0]!), "utf8"), customized);
    await assert.rejects(manageIntegration("install", { ...options, platform: "../../escape" }), /Unknown platform/);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

test("installer refuses symlinked paths rather than writing outside chosen scope", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "fehm-symlink-skill-"));
  try {
    await mkdir(path.join(cwd, "other"));
    await symlink(path.join(cwd, "other"), path.join(cwd, ".claude"), "dir");
    await assert.rejects(manageIntegration("install", { platform: "claude", project: true, cwd }), /symlinked/);
    assert.deepEqual(await readdir(path.join(cwd, "other")), []);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

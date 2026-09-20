import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { reviewPlan, runOpenCodeReview } from "../src/open-code-review.js";

test("OCR preview never executes and rejects ambiguous or unsafe selectors", async () => {
  const plan = reviewPlan(["--from", "main", "--to", "feature;echo secret"]);
  assert.equal(plan.execute, false);
  assert.deepEqual(plan.args, ["review", "--from", "main", "--to", "feature;echo secret", "--format", "json"]);
  assert.equal(JSON.parse(await runOpenCodeReview(plan)).execute, false);
  for (const args of [["--scan", "--context", "task"], ["--scan", "--path", "src,../secret"], ["--from", "main"], ["--scan", "--commit", "abc"], ["--path", "src"], ["--scan", "--path", "../outside"], ["--timeout", "Infinity"], ["--repo"], ["--unknown"], ["--scan", "--scan"]]) {
    assert.throws(() => reviewPlan(args));
  }
});

test("OCR execution passes literal arguments and bounds errors without exposing provider output", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fehm-ocr-"));
  try {
    const fixture = path.join(root, "fixture.cjs");
    await writeFile(fixture, 'process.stdout.write(JSON.stringify(process.argv.slice(2)))');
    const plan = { ...reviewPlan(["--repo", root, "--allow-provider"]), executable: process.execPath, args: [fixture, "branch;echo secret"] };
    assert.equal(await runOpenCodeReview(plan), '["branch;echo secret"]');
    await writeFile(fixture, 'process.stderr.write("PRIVATE_API_KEY"); process.exit(2)');
    await assert.rejects(runOpenCodeReview(plan), error => error instanceof Error && /Open Code Review failed/.test(error.message) && !error.message.includes("PRIVATE_API_KEY"));
    await writeFile(fixture, 'setInterval(()=>{},100)');
    await assert.rejects(runOpenCodeReview({ ...plan, timeoutMs: 50 }), /timed out/);
    await assert.rejects(runOpenCodeReview({ ...plan, executable: path.join(root, "missing") }), /not installed/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("graph-linked review preserves external provenance and rejects unsafe locations", async () => {
  const { linkReviewFindings } = await import('../src/review-findings.js');
  const { buildIndex, writeIndex } = await import('../src/indexer.js');
  const { createConfig } = await import('../src/config.js');
  const root = await mkdtemp(path.join(tmpdir(), 'fehm-linked-review-'));
  try {
    await writeFile(path.join(root, 'auth.ts'), 'export function authenticate() { return true; }\n');
    const config = createConfig(root);
    const graph = await buildIndex(config);
    await writeIndex(graph, config.outputDirectory);
    const comment = { path: 'auth.ts', start_line: 1, end_line: 1, content: 'Check this behavior', severity: 'high' };
    const report = linkReviewFindings(JSON.stringify({ status: 'partial', comments: [comment], warnings: [{ message: 'another file failed' }] }), graph);
    assert.equal(report.upstreamStatus, 'partial');
    assert.equal(report.findings[0]?.verified, false);
    assert.ok(report.findings[0]?.nodeIds.length);
    assert.equal(report.upstream.warnings.length, 1);
    for (const unsafe of ['../secrets', '/etc/passwd', 'C:\\secrets', '..\\secrets']) {
      assert.throws(() => linkReviewFindings(JSON.stringify({ status: 'success', comments: [{ ...comment, path: unsafe }] }), graph), /Unsafe/);
    }
    assert.throws(() => linkReviewFindings(JSON.stringify({ status: 'success', comments: [{ ...comment, start_line: 0 }] }), graph), /Invalid/);
    const before = JSON.stringify(graph);
    linkReviewFindings(JSON.stringify({ status: 'success', comments: [{ ...comment, path: 'missing.ts' }] }), graph);
    assert.equal(JSON.stringify(graph), before);

    const fixture = path.join(root, 'engine.cjs');
    await writeFile(fixture, `const fs=require('fs'); const args=process.argv.slice(2);const p=args[args.indexOf('--background-file')+1];const context=fs.readFileSync(p,'utf8');process.stdout.write(JSON.stringify({status:'success',comments:[${JSON.stringify(comment)}],context,temporary:p}));`);
    const plan = { ...reviewPlan(['--repo', root, '--allow-provider', '--context', 'authenticate', '--graph-report']), executable: process.execPath };
    plan.args = [fixture];
    const linked = JSON.parse(await runOpenCodeReview(plan));
    assert.match(linked.upstream.context, /authenticate/);
    await assert.rejects(import('node:fs/promises').then(fs => fs.stat(linked.upstream.temporary)), { code: 'ENOENT' });
    assert.equal(linked.findings[0].provenance, 'Open Code Review');
    assert.equal(linked.sourceFreshness.state, 'unchanged');
    await writeFile(fixture, `require('fs').writeFileSync('auth.ts', 'export function authenticate() { return false; }'); process.stdout.write(JSON.stringify({status:'success',comments:[${JSON.stringify(comment)}]}));`);
    const changed = JSON.parse(await runOpenCodeReview({ ...plan, contextQuery: undefined }));
    assert.equal(changed.sourceFreshness.state, 'changed');
  } finally { await rm(root, { recursive: true, force: true }); }
});

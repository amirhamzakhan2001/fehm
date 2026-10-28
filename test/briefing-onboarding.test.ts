import assert from "node:assert/strict";
import { test } from "node:test";
import { FehmEngine } from "../src/engine.js";
import { buildCodebaseBriefing } from "../src/codebase-briefing/briefing.js";
import { ArchitectureService } from "../src/visualization/architecture/service.js";
import { viewSpec, layoutWithRepair } from "../src/architecture/views.js";
import { REPORT_GROUPS, basisLabel, itemsIn, meetingQuestions, readingOrder } from "../src/visualization/briefing/ui/onboarding.js";
import { SECTION_IDS, type Claim } from "../src/codebase-briefing/types.js";
import { corpusCopy, makeRepo, tempDir } from "./helpers.js";

test("context projection retains external evidence and never turns modules into services", () => {
  const engine = FehmEngine.open(corpusCopy(), { stateDirectory: tempDir() });
  const service = new ArchitectureService({ dryRun: true });
  const model = service.model(engine);
  const spec = viewSpec(model, "system", "context");
  assert.ok(!("error" in spec));
  if ("error" in spec) return;
  assert.equal(spec.nodes.filter((n) => n.tier === 1).length, 1);
  assert.equal(spec.nodes.find((n) => n.tier === 1)?.id, "context:system");
  assert.ok(spec.relationships.some((r) => r.type === "reads"));
  assert.ok(spec.relationships.some((r) => r.type === "writes"));
  for (const rel of spec.relationships) {
    assert.notEqual(rel.source, rel.target);
    assert.ok(rel.source === "context:system" || rel.target === "context:system");
    assert.ok(rel.evidence.length);
    for (const evidence of rel.evidence) assert.ok(model.relationships.some((r) => r.type === rel.type && r.evidence.includes(evidence)));
  }
  assert.ok(layoutWithRepair(spec.input).report.valid);
  const published = service.view(engine, "system", "context");
  assert.ok(!("error" in published));
  assert.equal(service.view(engine, "system", "context"), published, "context layout is cached");
});

test("onboarding preserves every section and derives questions and reading order from evidence", () => {
  const engine = FehmEngine.open(corpusCopy(), { stateDirectory: tempDir() });
  const b = buildCodebaseBriefing(engine, { dryRun: true });
  assert.deepEqual(REPORT_GROUPS.flatMap((g) => g.sections).sort(), [...SECTION_IDS].sort());
  for (const question of meetingQuestions(b)) assert.ok(b.unknowns.some((u) => u.section === question.section && question.text.includes(u.text)));
  for (const reading of readingOrder(b)) assert.ok(engine.graph.nodes().some((node) => node.path === reading.path));
  assert.ok(itemsIn(b, "api").some((item) => item.title === "POST /login"));
});

test("confidence labels do not turn static patterns into executed observations", () => {
  const claim: Claim = { id: "c", text: "test", state: "confirmed", basis: "observed", confidence: 1, evidence: [{ path: "a.ts", source: "index", provenance: "heuristic" }] };
  assert.equal(basisLabel(claim), "Static pattern");
  assert.equal(basisLabel({ ...claim, basis: "declared", evidence: [{ path: "README.md", source: "documentation" }] }), "Documented");
  assert.equal(basisLabel({ ...claim, basis: "declared", evidence: [{ path: "package.json", source: "manifest" }] }), "Declared configuration");
  assert.equal(basisLabel({ ...claim, basis: "inferred" }), "Inferred");
  assert.equal(basisLabel({ ...claim, state: "unknown" }), "Unknown");
});

test("API reference retains routes beyond the previous group and item caps", () => {
  const engine = FehmEngine.open(makeRepo({
    "package.json": '{"name":"route-fixture"}',
    "app.ts": `import express from 'express';\nconst app = express();\n${Array.from({ length: 25 }, (_, i) => `app.get('/resource${i}', (req, res) => res.send('ok'));`).join("\n")}\n${Array.from({ length: 25 }, (_, i) => `app.get('/shared/${i}', (req, res) => res.send('ok'));`).join("\n")}`,
  }), { stateDirectory: tempDir() });
  const b = buildCodebaseBriefing(engine, { dryRun: true });
  assert.equal(itemsIn(b, "api").length, 50);
});

test('continuous report covers each analysis topic exactly once across five stages', async () => {
  const { REPORT_STAGES } = await import('../src/visualization/briefing/ui/report.js');
  assert.deepEqual(REPORT_STAGES.map(stage => stage.id), ['understand', 'explore', 'trace', 'evaluate', 'change']);
  assert.deepEqual(REPORT_STAGES.flatMap(stage => stage.sections).sort(), [...SECTION_IDS].sort());
  assert.ok(REPORT_STAGES.find(stage => stage.id === 'explore')?.sections.includes('api'));
  assert.ok(REPORT_STAGES.find(stage => stage.id === 'explore')?.sections.includes('database'));
});

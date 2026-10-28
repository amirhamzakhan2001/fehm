import assert from 'node:assert/strict';
import { test } from 'node:test';
import { driftBasis, driftPriority, promptPurpose, changeSummary } from '../src/visualization/shared/ui/assessment.js';
import { entityGitHistory } from '../src/git-memory/history.js';
import type { DriftFinding } from '../src/drift/types.js';
import type { GitMemoryReport, MemoryCommit } from '../src/git-memory/types.js';
import { buildPromptReport } from '../src/prompts/report.js';
import { FehmEngine } from '../src/engine.js';
import { makeRepo, tempDir } from './helpers.js';

test('assessment prioritizes impact then configured rules, excluding reviewed/resolved findings', () => {
  const finding = (id: string, extra: Partial<DriftFinding> = {}) => ({id, attention:'high', confidence:'high', basis:'project-pattern', status:'undated', ...extra}) as DriftFinding;
  const values = [finding('inferred'), finding('rule', {basis:'explicit-rule'}), finding('urgent',{attention:'critical'}), finding('resolved',{status:'resolved'}), finding('reviewed',{decision:{kind:'accepted',reason:'intentional',by:'tester',at:'now',scope:'local'}})];
  assert.deepEqual(driftPriority(values).map(f => f.id), ['urgent','rule','inferred']);
  assert.match(driftBasis(values[0]!), /Inferred concern/);
  assert.match(driftBasis(values[4]!), /not a verified fix/);
  assert.equal(values.length,5);
});

test('prompt explanation preserves uncertainty and does not infer production usage', () => {
  const root=makeRepo({'main.ts':'const SYSTEM_PROMPT = getRuntimeInstructions();'});
  const p=buildPromptReport({engine:FehmEngine.open(root,{stateDirectory:tempDir()})}).prompts[0]!;
  assert.ok(p); assert.match(promptPurpose(p), /runtime use is not established/); assert.match(promptPurpose(p), /could not be reconstructed/);
});

test('file history retains actual changes when no semantic event was detected', () => {
  const commit = {id:'c1',parents:[],author:'author',email:'a@b',at:'2026-01-01',message:'Update asset',files:[{path:'assets/logo.bin',status:'M',additions:null,deletions:null}],events:[],classifications:[],warnings:[],revertOf:null} satisfies MemoryCommit;
  const report = {commits:[commit],coverage:{}} as GitMemoryReport;
  assert.deepEqual(entityGitHistory(report,'assets/logo.bin').commits,[commit]);
  assert.deepEqual(entityGitHistory(report,'assets').commits,[commit]);
  assert.deepEqual(entityGitHistory(report,'assets/logo.bin','unknownSymbol').commits,[]);
  assert.match(changeSummary(commit),/1 file changed/);
  assert.match(changeSummary(commit),/author’s intent/);
});

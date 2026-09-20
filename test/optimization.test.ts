import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import ts from "typescript";
import { cacheCompilerReads } from "../src/compiler-host.js";
import { mapConcurrent } from "../src/concurrency.js";

test("bounded work preserves input order even when completion is reversed", async () => {
  let active = 0, maximum = 0;
  const release: Array<() => void> = [];
  const pending = mapConcurrent([0, 1, 2, 3], 2, async value => {
    active++; maximum = Math.max(maximum, active);
    await new Promise<void>(resolve => { release[value] = resolve; });
    active--; return value * 2;
  });
  assert.equal(active, 2);
  release[1]!(); await new Promise(resolve => setImmediate(resolve));
  release[2]!(); await new Promise(resolve => setImmediate(resolve));
  release[3]!(); release[0]!();
  assert.deepEqual(await pending, [0, 2, 4, 6]);
  assert.equal(maximum, 2);
  assert.deepEqual(await mapConcurrent([], 4, async value => value), []);
  await assert.rejects(mapConcurrent([1], 0, async value => value));
});

test("failed work drains existing tasks and stops scheduling further items", async () => {
  const started: number[] = [];
  let drained = false;
  await assert.rejects(mapConcurrent([0, 1, 2, 3], 2, async value => {
    started.push(value);
    if (value === 0) throw new Error("failure");
    await new Promise(resolve => setImmediate(resolve)); drained = true;
  }), /failure/);
  assert.deepEqual(started, [0, 1]);
  assert.equal(drained, true);
});

test("compiler host reads each fallback path once and refreshes on the next analysis", () => {
  let disk = "export const value = 1", reads = 0, checks = 0;
  const makeHost = () => {
    const host = ts.createCompilerHost({});
    host.readFile = name => { reads++; return name.endsWith('missing') ? undefined : disk; };
    host.fileExists = name => { checks++; return !name.endsWith('missing'); };
    cacheCompilerReads(host, new Map([[path.resolve('scanned.ts'), '']]));
    return host;
  };
  const host = makeHost();
  assert.equal(host.readFile('scanned.ts'), '');
  assert.equal(host.fileExists('scanned.ts'), true);
  assert.equal(reads, 0); assert.equal(checks, 0);
  for (let i = 0; i < 20; i++) {
    assert.equal(host.readFile('dep.ts'), 'export const value = 1');
    assert.equal(host.fileExists('dep.ts'), true);
    assert.equal(host.readFile('missing'), undefined);
    assert.equal(host.fileExists('missing'), false);
  }
  assert.equal(reads, 2); assert.equal(checks, 2);
  disk = 'export const value = 2';
  assert.equal(makeHost().readFile('dep.ts'), disk);
});

import assert from "node:assert/strict";
import test from "node:test";
import { fileFirstRoundRobin } from "../src/context-selection.js";

test("file selection preserves leaders, within-file order, identity and limits", () => {
  const ranked = [
    { group: "a", value: { id: 1 } },
    { group: "a", value: { id: 2 } },
    { group: "b", value: { id: 3 } },
    { group: "a", value: { id: 4 } },
    { group: "c", value: { id: 5 } },
  ];
  const before = structuredClone(ranked);
  assert.deepEqual(fileFirstRoundRobin(ranked).map(x => x.id), [1, 3, 5, 2, 4]);
  assert.deepEqual(fileFirstRoundRobin(ranked, 2).map(x => x.id), [1, 3]);
  assert.equal(fileFirstRoundRobin(ranked)[0], ranked[0]!.value);
  assert.deepEqual(ranked, before);
  assert.deepEqual(fileFirstRoundRobin(ranked, 0), []);
  assert.deepEqual(fileFirstRoundRobin([]), []);
});

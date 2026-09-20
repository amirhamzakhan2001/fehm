import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createConfig } from "../src/config.js";
import { scanRepository } from "../src/scanner.js";

test("scans project source without Python virtual environments and cache artifacts", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "fehm-scan-python-"));
  try {
    for (const directory of ["src", ".venv/lib/site-packages/example", "src/__pycache__"]) {
      await mkdir(path.join(root, directory), { recursive: true });
      await writeFile(path.join(root, directory, "module.py"), "def identify():\n    return 1\n");
    }
    const result = await scanRepository(createConfig(root));
    assert.deepEqual(result.files.map(file => file.relativePath), ["src/module.py"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

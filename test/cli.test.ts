import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("prints help successfully for installed users", async () => {
  const result = await execFileAsync(process.execPath, ["--import", "tsx", "src/cli.ts", "--help"], {
    cwd: process.cwd(),
    timeout: 30_000,
  });
  assert.match(result.stdout, /fehm — local-first codebase intelligence/);
  assert.match(result.stdout, /fehm scan/);
  assert.match(result.stdout, /fehm mcp/);
  assert.equal(result.stderr, "");
});

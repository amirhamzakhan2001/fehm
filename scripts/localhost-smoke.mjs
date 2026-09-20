import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { once } from "node:events";
import { request } from "node:http";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { buildIndex, writeIndex } from "../dist/indexer.js";
import { createConfig } from "../dist/config.js";
const exec = promisify(execFile);
const root = await mkdtemp(path.join(os.tmpdir(), "fehm-localhost-"));
const cli = path.resolve("dist/cli.js");
const environment = { ...process.env };
for (const key of ["FEHM_AUTH_TOKEN", "REPOMIND_AUTH_TOKEN", "FEHM_HOST", "REPOMIND_HOST", "PORT"]) delete environment[key];
let child;
let childExit;
try {
  const roots = [path.join(root, "alpha"), path.join(root, "beta")];
  const graphPaths = [];
  for (const [index, directory] of roots.entries()) {
    await mkdir(path.join(directory, "src"), { recursive: true });
    await writeFile(path.join(directory, "src", "main.ts"), `export const project${index} = true;\n`);
    const config = createConfig(directory, path.join(directory, ".fehm", "custom"));
    graphPaths.push(await writeIndex(await buildIndex(config), config.outputDirectory));
  }
  await assert.rejects(exec(process.execPath, [cli, "serve", graphPaths[0], "--host", "0.0.0.0", "--port", "0"], { env: environment, timeout: 10000 }), (error) => /refusing to expose an unauthenticated cockpit/.test(error.stderr));
  await assert.rejects(exec(process.execPath, [cli, "serve", graphPaths[0], "--port", "0"], { env: { ...environment, FEHM_AUTH_TOKEN: "short" }, timeout: 10000 }), (error) => /at least 32 characters/.test(error.stderr));
  child = spawn(process.execPath, [cli, "serve", ...graphPaths, "--watch", "--interval", "250", "--port", "0"], { env: environment, stdio: ["ignore", "pipe", "pipe"] });
  childExit = once(child, "exit");
  let output = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (value) => { stderr += value; });
  const base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`CLI startup timed out: ${stderr}`)), 15000);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`CLI exited ${code}: ${stderr}`)); });
    child.stdout.on("data", (value) => {
      output += value;
      const found = /fehm cockpit: (http:\/\/127\.0\.0\.1:\d+)/.exec(output);
      if (found) { clearTimeout(timer); resolve(found[1]); }
    });
  });
  for (const route of ["/", "/projects/alpha", "/projects/beta", "/app.js", "/styles.css"]) {
    const response = await fetch(base + route);
    assert.equal(response.status, 200, route);
    assert.ok(response.headers.get("content-security-policy"));
  }
  const reboundStatus = await new Promise((resolve, reject) => {
    const call = request(base + "/api/overview", { headers: { host: "rebound.example" } }, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode));
    });
    call.on("error", reject);
    call.end();
  });
  assert.equal(reboundStatus, 403);
  const listing = await (await fetch(base + "/api/projects")).json();
  assert.deepEqual(listing.projects.map((project) => project.id), ["alpha", "beta"]);
  const alpha = await (await fetch(base + "/api/overview?project=alpha")).json();
  const beta = await (await fetch(base + "/api/overview?project=beta")).json();
  assert.equal(alpha.repository.name, "alpha");
  assert.equal(beta.repository.name, "beta");
  assert.equal((await fetch(base + "/api/overview?project=missing")).status, 404);
  const practices = await (await fetch(base + "/api/practices?project=alpha")).json();
  assert.equal(practices.policySource, "advisory");
  assert.equal(practices.findings.length, 31);
  for (const query of [null, 42, {}, [], ""]) {
    assert.equal((await fetch(base + "/api/context", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query }) })).status, 400);
  }
  await writeFile(path.join(roots[0], "src", "main.ts"), "export const watchedUpdate = true;\n");
  let refreshed = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    await delay(250);
    const graph = await (await fetch(base + "/api/graph?project=alpha&level=symbols")).json();
    if (graph.nodes.some((node) => node.name === "watchedUpdate")) { refreshed = true; break; }
  }
  assert.equal(refreshed, true, "watch must refresh the graph supplied from a custom output directory");
  assert.ok((await readFile(graphPaths[0], "utf8")).includes("watchedUpdate"));
  child.kill("SIGTERM");
  const [code] = await childExit;
  assert.equal(code, 0, stderr);
  child = undefined;
  console.log("Localhost smoke passed: CLI loopback defaults, remote-bind refusal, token validation, hostname guard, static assets, multi-project routing, practices API, query validation, custom-output watch refresh, and graceful shutdown.");
} finally {
  if (child && child.exitCode === null) { child.kill("SIGTERM"); await childExit; }
  await rm(root, { recursive: true, force: true });
}

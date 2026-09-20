import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import test from "node:test";

async function harness(fetcher: typeof fetch) {
  const script = (await readFile("public/app.js", "utf8")).replace("init().catch(showRequestError);", "");
  const storage = new Map<string, string>();
  const sandbox = {
    Headers, DOMException, fetch: fetcher,
    sessionStorage: { getItem: (key: string) => storage.get(key), setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) },
    window: { addEventListener() {}, prompt: () => null },
    exported: {} as { api: (url: string) => Promise<unknown>; state: { projectId: string; viewEpoch: number } },
  };
  runInNewContext(`${script}\nexported = { api, state };`, sandbox);
  return sandbox.exported;
}

test("cockpit scopes requests and discards responses from a previous project or view", async () => {
  let complete: (response: Response) => void = () => {};
  const urls: string[] = [];
  const app = await harness(((url: string) => { urls.push(url); return new Promise<Response>((resolve) => { complete = resolve; }); }) as typeof fetch);
  app.state.projectId = "alpha";
  const old = app.api("/api/practices");
  app.state.projectId = "beta";
  complete(new Response(JSON.stringify({ project: "alpha" })));
  await assert.rejects(old, (error: Error) => error.name === "AbortError");
  assert.equal(urls[0], "/api/practices?project=alpha");
  const oldView = app.api("/api/overview");
  app.state.viewEpoch++;
  complete(new Response("{}"));
  await assert.rejects(oldView, (error: Error) => error.name === "AbortError");
  const current = app.api("/api/practices");
  complete(new Response('{"project":"beta"}'));
  assert.deepEqual(await current, { project: "beta" });
});

test("cockpit surfaces API failures and cancelled authentication", async () => {
  const app = await harness((async () => new Response('{"error":"unauthorized"}', { status: 401 })) as typeof fetch);
  await assert.rejects(app.api("/api/projects"), /unauthorized/);
});

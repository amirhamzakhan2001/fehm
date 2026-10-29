import assert from "node:assert/strict";
import http from "node:http";
import type net from "node:net";
import { test } from "node:test";
import { startServer } from "../src/server.js";
import { dashboardHref, FEATURES, featureNav, HOME_ID } from "../src/visualization/features.js";
import { makeRepo, tempDir } from "./helpers.js";

test("feature registry: ids are unique and URL-safe, paths are unique page routes", () => {
  const ids = FEATURES.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(!ids.includes(HOME_ID), "the home id is reserved");
  for (const f of FEATURES) {
    assert.match(f.id, /^[a-z][a-z0-9-]*$/, f.id);
    assert.match(f.path, /^\/[a-z][a-z0-9-]*$/, f.path);
    assert.ok(f.title && f.summary && f.code, f.id);
  }
  assert.equal(new Set(FEATURES.map((f) => f.path)).size, FEATURES.length);
  // A page's own header never links to itself.
  for (const f of FEATURES) assert.doesNotMatch(featureNav(f.id), new RegExp(`href="${dashboardHref(f.id).replace(/[/#]/g, "\\$&")}"`));
});

test("server: the dashboard lists every feature and every feature page is served and frameable", async () => {
  const root = makeRepo({ "src/a.ts": "export function a() { return 1; }\n" });
  const server = await startServer(root, 0, { stateDirectory: tempDir() });
  const port = (server.address() as net.AddressInfo).port;
  const get = (path: string) =>
    new Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }>((resolveP, reject) => {
      http.get({ host: "127.0.0.1", port, path }, (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolveP({ status: res.statusCode ?? 0, body, headers: res.headers }));
      }).on("error", reject);
    });
  try {
    const home = await get("/");
    assert.equal(home.status, 200);
    assert.match(String(home.headers["content-security-policy"]), /script-src 'self'/);
    assert.match(home.body, /\/dashboard\/assets\/dashboard\/ui\/main\.js/);
    assert.equal((await get("/dashboard/assets/dashboard/ui/main.js")).status, 200);
    assert.equal((await get("/dashboard/assets/dashboard/routes.js")).status, 404, "server-side modules are not exposed");

    for (const f of FEATURES) {
      assert.match(home.body, new RegExp(`data-view="${f.id}" data-path="${f.path}"`), `sidebar entry for ${f.id}`);
      const page = await get(f.path);
      assert.equal(page.status, 200, f.path);
      assert.match(String(page.headers["content-type"]), /text\/html/);
      assert.match(String(page.headers["content-security-policy"]), /frame-ancestors 'self'/, `${f.path} can be framed by the dashboard`);
      assert.match(page.body, /class="fehm-nav"/, `${f.path} carries the shared feature nav`);
      assert.doesNotMatch(page.body, /<html lang="en" class="embedded">/);
      assert.match((await get(`${f.path}?embedded`)).body, /<html lang="en" class="embedded">/, `${f.path} has an embedded variant`);
    }

    const engineMain = await get("/engine/assets/engine/ui/main.js");
    assert.equal(engineMain.status, 200);
    assert.doesNotMatch(engineMain.body, /^\s*import\s+\S.*from\s+"(node:|typescript)/m, "browser module must not import Node modules");
    assert.equal((await get("/nope")).status, 404);
  } finally {
    server.close();
  }
});

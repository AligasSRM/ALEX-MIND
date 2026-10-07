import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestHarness } from "wrangler";

const server = createTestHarness({
  workers: [
    {
      configPath: "./wrangler.jsonc",
      secrets: { B2_APP_KEY: "test-app-key", CONTROL_ACTION_KEY: "test-control-key" },
    },
  ],
});

before(async () => {
  await server.listen();
  await server.getWorker().applyD1Migrations("CENTRAL_DB");
});

after(async () => { await server.close(); });

for (const path of ["/control/status", "/control/check"]) {
  test("ALEX-MIND " + path + " is GREEN", async () => {
    const response = await server.fetch("https://alex-mind.test" + path);
    const raw = await response.text();
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      body = { status: "NON_JSON", raw };
    }
    assert.equal(response.status, 200, "HTTP body: " + raw);
    assert.equal(body.status, "GREEN", "Response body: " + raw);
    assert.equal(body.read_only, true, "Response body: " + raw);
  });
}


test("ALEX-MIND Control UI is served", async () => {
  const response = await server.fetch("https://alex-mind.test/");
  const raw = await response.text();
  assert.equal(response.status, 200, "UI response: " + raw);
  assert.match(raw, /ALEX-MIND Control/);
  assert.match(raw, /\/control\/status/);
});


test("ALEX-MIND sync policy control action requires authorization", async () => {
  const url = "https://alex-mind.test/sync-policy";
  const denied = await server.fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ source_name: "Gmail A", vault_sync: false }) });
  assert.equal(denied.status, 403);
  const wrongKey = await server.fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-alex-control-key": "wrong-key" }, body: JSON.stringify({ source_name: "Gmail A", vault_sync: false }) });
  assert.equal(wrongKey.status, 403);
  const allowed = await server.fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-alex-control-key": "test-control-key" }, body: JSON.stringify({ source_name: "Gmail A", vault_sync: false }) });
  const body = await allowed.json();
  assert.equal(allowed.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.vault_sync, 0);
});

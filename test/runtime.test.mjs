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
  const worker = server.getWorker();
  await worker.applyD1Migrations("CENTRAL_DB");
  const env = await worker.getEnv();
  await env.CENTRAL_DB.batch([
    env.CENTRAL_DB.prepare("ALTER TABLE sync_policies ADD COLUMN status TEXT NOT NULL DEFAULT 'active'"),
    env.CENTRAL_DB.prepare("ALTER TABLE sync_policies ADD COLUMN last_sync_at TEXT"),
    env.CENTRAL_DB.prepare("ALTER TABLE sync_policies ADD COLUMN last_sync_status TEXT"),
  ]);
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
  const denied = await server.fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ source_name: "GitHub", vault_sync: false }) });
  assert.equal(denied.status, 403);
  const wrongKey = await server.fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-alex-control-key": "wrong-key" }, body: JSON.stringify({ source_name: "GitHub", vault_sync: false }) });
  assert.equal(wrongKey.status, 403);
  const allowed = await server.fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-alex-control-key": "test-control-key" }, body: JSON.stringify({ source_name: "GitHub", vault_sync: false }) });
  const raw = await allowed.text();
  let body;
  try { body = JSON.parse(raw); } catch { body = { raw }; }
  assert.equal(allowed.status, 200, "Allowed response: " + raw);
  assert.equal(body.ok, true, "Allowed response: " + raw);
  assert.equal(body.result.vault_sync, 0);
  assert.equal(body.operation.state, "completed");
  assert.equal(body.operation.events.length >= 4, true);
});


test("ALEX-MIND control orchestrator completes sync_policy with idempotency", async () => {
  const url = "https://alex-mind.test/control/operations";
  const payload = {
    action: "sync_policy",
    idempotency_key: "phase25-idempotency-1",
    source_name: "GitHub",
    vault_sync: true,
    phone_sync: false,
  };
  const headers = {
    "content-type": "application/json",
    "x-alex-control-key": "test-control-key",
  };

  const first = await server.fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const firstRaw = await first.text();
  const firstBody = JSON.parse(firstRaw);
  assert.equal(first.status, 200, firstRaw);
  assert.equal(firstBody.status, "GREEN");
  assert.equal(firstBody.operation.state, "completed");
  assert.equal(firstBody.operation.action, "sync_policy");
  assert.equal(firstBody.operation.authorization, "authorized");
  assert.equal(firstBody.operation.policy, "allow");
  assert.equal(firstBody.operation.audit_ref.startsWith("audit-op-"), true);

  const replay = await server.fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const replayBody = JSON.parse(await replay.text());
  assert.equal(replay.status, 200);
  assert.equal(replayBody.replay, true);
  assert.equal(replayBody.operation.operation_id, firstBody.operation.operation_id);

  const conflict = await server.fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ ...payload, vault_sync: false }),
  });
  assert.equal(conflict.status, 409);
  const conflictBody = JSON.parse(await conflict.text());
  assert.equal(conflictBody.status, "CONFLICT");
});

test("ALEX-MIND control orchestrator blocks unsupported actions fail-closed", async () => {
  const response = await server.fetch("https://alex-mind.test/control/operations", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-alex-control-key": "test-control-key",
    },
    body: JSON.stringify({
      action: "delete_everything",
      idempotency_key: "phase25-unsupported-1",
      source_name: "GitHub",
    }),
  });
  const body = JSON.parse(await response.text());
  assert.equal(response.status, 409);
  assert.equal(body.status, "BLOCKED");
  assert.equal(body.operation.state, "blocked");
  assert.equal(body.operation.policy, "blocked");
  assert.equal(body.operation.failure_category, "unsupported_action");
});

test("ALEX-MIND control orchestrator rejects unauthorized operation requests", async () => {
  const response = await server.fetch("https://alex-mind.test/control/operations", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-alex-control-key": "wrong-key",
    },
    body: JSON.stringify({
      action: "sync_policy",
      idempotency_key: "phase25-denied-1",
      source_name: "GitHub",
    }),
  });
  assert.equal(response.status, 403);
  const body = JSON.parse(await response.text());
  assert.equal(body.status, "DENIED");
});

test("ALEX-MIND control operation can be read with its audit events", async () => {
  const create = await server.fetch("https://alex-mind.test/control/operations", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-alex-control-key": "test-control-key",
    },
    body: JSON.stringify({
      action: "sync_policy",
      idempotency_key: "phase25-read-1",
      source_name: "GitHub",
      vault_sync: true,
    }),
  });
  const created = JSON.parse(await create.text());
  const operationId = created.operation.operation_id;

  const read = await server.fetch(
    "https://alex-mind.test/control/operations?operation_id=" + encodeURIComponent(operationId),
  );
  const body = JSON.parse(await read.text());
  assert.equal(read.status, 200);
  assert.equal(body.operation.operation_id, operationId);
  assert.equal(body.operation.events.some((event) => event.event_type === "completed"), true);
});

test("ALEX-MIND reconciliation endpoint stays fail-closed when no reconciliation is required", async () => {
  const create = await server.fetch("https://alex-mind.test/control/operations", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-alex-control-key": "test-control-key",
    },
    body: JSON.stringify({
      action: "sync_policy",
      idempotency_key: "phase25-reconcile-1",
      source_name: "GitHub",
      vault_sync: true,
    }),
  });
  const created = JSON.parse(await create.text());
  const operationId = created.operation.operation_id;

  const reconcile = await server.fetch(
    "https://alex-mind.test/control/operations/" + encodeURIComponent(operationId) + "/reconcile",
    {
      method: "POST",
      headers: { "x-alex-control-key": "test-control-key" },
    },
  );
  const body = JSON.parse(await reconcile.text());
  assert.equal(reconcile.status, 409);
  assert.equal(body.status, "BLOCKED");
});

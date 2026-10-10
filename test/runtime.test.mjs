import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestHarness } from "wrangler";
import { purgeB2ObjectVersions } from "../worker.js";

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


for (const action of ["trash", "restore", "purge"]) {
  test("ALEX-MIND object " + action + " requires control authorization", async () => {
    const response = await server.fetch(
      "https://alex-mind.test/objects/nonexistent-object/" + action,
      { method: "POST" },
    );
    assert.equal(response.status, 403);
    const body = JSON.parse(await response.text());
    assert.equal(body.status, "DENIED");
    assert.equal(body.error, "control action unauthorized");
  });
}

test("ALEX-MIND object trash lifecycle refuses unknown objects after authorization", async () => {
  const response = await server.fetch(
    "https://alex-mind.test/objects/nonexistent-object/trash",
    {
      method: "POST",
      headers: { "x-alex-control-key": "test-control-key" },
    },
  );
  assert.equal(response.status, 404);
  const body = JSON.parse(await response.text());
  assert.equal(body.error, "object not found");
});


test("ALEX-MIND vault object can be trashed and restored without deleting stored bytes", async () => {
  const worker = server.getWorker();
  const env = await worker.getEnv();
  await env.CENTRAL_DB.prepare(
    "INSERT INTO objects (object_id,source_id,vault_id,storage_provider,storage_bucket,storage_key,status,name,kind,mime_type,size_bytes,checksum,checksum_algorithm,created_at,updated_at,stored_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
  ).bind(
    "trash-restore-test", 1, "alex-central-vault", "backblaze-b2",
    "alex-central-vault", "objects/test/trash-restore-test", "stored",
    "trash restore test", "test", "text/plain", 12, "test-checksum",
    "SHA-256", new Date().toISOString(), new Date().toISOString(), new Date().toISOString()
  ).run();

  const headers = { "x-alex-control-key": "test-control-key" };
  const trashed = await server.fetch(
    "https://alex-mind.test/objects/trash-restore-test/trash",
    { method: "POST", headers }
  );
  assert.equal(trashed.status, 200, await trashed.clone().text());
  const trashBody = await trashed.json();
  assert.equal(trashBody.action, "trash");
  assert.equal(trashBody.bytes_deleted, 0);
  assert.equal(trashBody.storage_delete_performed, false);

  const afterTrash = await env.CENTRAL_DB.prepare(
    "SELECT status,storage_key,trashed_at FROM objects WHERE object_id=?"
  ).bind("trash-restore-test").first();
  assert.equal(afterTrash.status, "trashed");
  assert.equal(afterTrash.storage_key, "objects/test/trash-restore-test");
  assert.ok(afterTrash.trashed_at);

  const restored = await server.fetch(
    "https://alex-mind.test/objects/trash-restore-test/restore",
    { method: "POST", headers }
  );
  assert.equal(restored.status, 200, await restored.clone().text());
  const afterRestore = await env.CENTRAL_DB.prepare(
    "SELECT status,storage_key,trashed_at FROM objects WHERE object_id=?"
  ).bind("trash-restore-test").first();
  assert.equal(afterRestore.status, "stored");
  assert.equal(afterRestore.storage_key, "objects/test/trash-restore-test");
  assert.equal(afterRestore.trashed_at, null);
});

test("ALEX-MIND restoring an archived object preserves its archived state", async () => {
  const worker = server.getWorker();
  const env = await worker.getEnv();
  const archivedAt = new Date(Date.now() - 60_000).toISOString();
  await env.CENTRAL_DB.prepare(
    "INSERT INTO objects (object_id,source_id,vault_id,storage_provider,storage_bucket,storage_key,status,name,kind,mime_type,size_bytes,checksum,checksum_algorithm,created_at,updated_at,stored_at,archived_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
  ).bind(
    "archived-trash-restore-test", 1, "alex-central-vault", "backblaze-b2",
    "alex-central-vault", "objects/test/archived-trash-restore-test", "archived",
    "archived trash restore test", "test", "text/plain", 12, "test-checksum",
    "SHA-256", archivedAt, archivedAt, archivedAt, archivedAt
  ).run();

  const headers = { "x-alex-control-key": "test-control-key" };
  const trashed = await server.fetch(
    "https://alex-mind.test/objects/archived-trash-restore-test/trash",
    { method: "POST", headers }
  );
  assert.equal(trashed.status, 200, await trashed.clone().text());

  const restored = await server.fetch(
    "https://alex-mind.test/objects/archived-trash-restore-test/restore",
    { method: "POST", headers }
  );
  assert.equal(restored.status, 200, await restored.clone().text());
  const body = await restored.json();
  assert.equal(body.restored_status, "archived");

  const row = await env.CENTRAL_DB.prepare(
    "SELECT status,archived_at,trashed_at FROM objects WHERE object_id=?"
  ).bind("archived-trash-restore-test").first();
  assert.equal(row.status, "archived");
  assert.equal(row.archived_at, archivedAt);
  assert.equal(row.trashed_at, null);
});


test("ALEX-MIND successful permanent purge retains the non-null storage key as an audit tombstone", async () => {
  const worker = server.getWorker();
  const env = await worker.getEnv();
  await env.CENTRAL_DB.prepare(
    "INSERT INTO objects (object_id,source_id,vault_id,storage_provider,storage_bucket,storage_key,status,name,kind,mime_type,size_bytes,checksum,checksum_algorithm,created_at,updated_at,stored_at,trashed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
  ).bind(
    "purge-route-test", 1, "alex-central-vault", "backblaze-b2",
    "alex-central-vault", "objects/test/purge-route-test", "trashed",
    "purge route test", "test", "text/plain", 12, "test-checksum",
    "SHA-256", new Date().toISOString(), new Date().toISOString(),
    new Date().toISOString(), new Date().toISOString()
  ).run();

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    const method = init.method || "GET";
    if (method === "GET" && url.searchParams.has("versions")) {
      return new Response(
        "<ListVersionsResult><IsTruncated>false</IsTruncated>" +
        "<Version><Key>objects/test/purge-route-test</Key><VersionId>purge-version-1</VersionId><Size>12</Size></Version>" +
        "</ListVersionsResult>",
        { status: 200 },
      );
    }
    if (method === "DELETE" && url.searchParams.has("versionId")) {
      return new Response(null, { status: 204 });
    }
    return new Response("unexpected mocked request", { status: 500 });
  };

  try {
    const response = await server.fetch(
      "https://alex-mind.test/objects/purge-route-test/purge",
      { method: "POST", headers: { "x-alex-control-key": "test-control-key" } }
    );
    const raw = await response.text();
    assert.equal(response.status, 200, raw);
    const body = JSON.parse(raw);
    assert.equal(body.status, "GREEN");
    assert.equal(body.versions_deleted, 1);
    assert.equal(body.bytes_deleted, 12);

    const row = await env.CENTRAL_DB.prepare(
      "SELECT status,storage_key FROM objects WHERE object_id=?"
    ).bind("purge-route-test").first();
    assert.equal(row.status, "deleted");
    assert.equal(row.storage_key, "objects/test/purge-route-test");
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("ALEX-MIND permanent purge refuses a mismatched storage provider before deletion", async () => {
  const worker = server.getWorker();
  const env = await worker.getEnv();
  await env.CENTRAL_DB.prepare(
    "INSERT INTO objects (object_id,source_id,vault_id,storage_provider,storage_bucket,storage_key,status,name,kind,mime_type,size_bytes,checksum,checksum_algorithm,created_at,updated_at,stored_at,trashed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
  ).bind(
    "purge-guard-test", 1, "alex-central-vault", "unexpected-provider",
    "alex-central-vault", "objects/test/purge-guard-test", "trashed",
    "purge guard test", "test", "text/plain", 5, "test-checksum",
    "SHA-256", new Date().toISOString(), new Date().toISOString(),
    new Date().toISOString(), new Date().toISOString()
  ).run();

  const response = await server.fetch(
    "https://alex-mind.test/objects/purge-guard-test/purge",
    { method: "POST", headers: { "x-alex-control-key": "test-control-key" } }
  );
  assert.equal(response.status, 409, await response.clone().text());
  const body = await response.json();
  assert.equal(body.status, "BLOCKED");
  assert.match(body.error, /storage provider\/key mismatch/);

  const stillPresent = await env.CENTRAL_DB.prepare(
    "SELECT status,storage_key FROM objects WHERE object_id=?"
  ).bind("purge-guard-test").first();
  assert.equal(stillPresent.status, "trashed");
  assert.equal(stillPresent.storage_key, "objects/test/purge-guard-test");
});


test("B2 purge deletes exact object versions and delete markers, not prefix siblings", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    const method = init.method || "GET";
    calls.push({ method, url });
    if (method === "GET" && url.searchParams.has("versions")) {
      return new Response(
        "<ListVersionsResult>" +
          "<IsTruncated>false</IsTruncated>" +
          "<Version><Key>objects/test/purge-helper</Key><VersionId>version-1</VersionId><Size>7</Size></Version>" +
          "<DeleteMarker><Key>objects/test/purge-helper</Key><VersionId>marker-1</VersionId></DeleteMarker>" +
          "<Version><Key>objects/test/purge-helper-sibling</Key><VersionId>sibling-1</VersionId><Size>100</Size></Version>" +
        "</ListVersionsResult>",
        { status: 200 },
      );
    }
    if (method === "DELETE" && url.searchParams.has("versionId")) {
      return new Response(null, { status: 204 });
    }
    return new Response("unexpected mocked request", { status: 500 });
  };

  try {
    const result = await purgeB2ObjectVersions(
      { B2_KEY_ID: "test-key-id", B2_APP_KEY: "test-app-key" },
      "objects/test/purge-helper",
    );
    assert.deepEqual(result, {
      bytesDeleted: 7,
      versionsDeleted: 2,
      versionsFound: 2,
    });
    assert.equal(calls.length, 3);
    assert.equal(calls[0].method, "GET");
    assert.deepEqual(
      calls.slice(1).map((call) => call.url.searchParams.get("versionId")).sort(),
      ["marker-1", "version-1"],
    );
    assert.equal(calls.slice(1).every((call) => call.url.pathname.endsWith("/objects/test/purge-helper")), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

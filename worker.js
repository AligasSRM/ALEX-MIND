import { authRoutes } from "./auth.js";
const B2_ENDPOINT = "https://s3.eu-central-003.backblazeb2.com";
const B2_BUCKET = "alex-central-vault";
const B2_REGION = "eu-central-003";
const B2_SERVICE = "s3";
const GROOM_RETENTION_DAYS = 90;
const GROOM_LIMIT = 100;

function textBytes(value) {
  return new TextEncoder().encode(String(value));
}

function toBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (typeof value === "string") return textBytes(value);
  if (value == null) return new Uint8Array();
  return new Uint8Array(value);
}

async function sha256Hex(value) {
  const bytes = toBytes(value);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmac(keyBytes, value) {
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, textBytes(value)));
}

async function hmacHex(keyBytes, value) {
  return [...await hmac(keyBytes, value)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function awsEncode(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) =>
    "%" + c.charCodeAt(0).toString(16).toUpperCase()
  );
}

function errorText(error) {
  return String(error?.message || error);
}

async function controlActionAuthorized(request, env) {
  if (!env.CONTROL_ACTION_KEY) return null;
  const provided = request.headers.get("x-alex-control-key") || "";
  const expected = await sha256Hex(env.CONTROL_ACTION_KEY);
  const received = await sha256Hex(provided);
  return expected === received;
}

async function b2Request(env, method, key, body = new Uint8Array(), contentType) {
  if (!env.B2_KEY_ID || !env.B2_APP_KEY) {
    throw new Error("B2 secrets not configured");
  }

  const bytes = toBytes(body);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = await sha256Hex(bytes);
  const host = new URL(B2_ENDPOINT).host;
  const path = "/" + B2_BUCKET + "/" + key.split("/").map(awsEncode).join("/");

  const headers = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  if (contentType) headers["content-type"] = contentType;

  const names = Object.keys(headers).sort();
  const signedHeaders = names.join(";");
  const canonicalHeaders = names
    .map((name) => name + ":" + headers[name].trim() + "\n")
    .join("");
  const canonicalRequest = [
    method,
    path,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const scope = dateStamp + "/" + B2_REGION + "/" + B2_SERVICE + "/aws4_request";
  const kDate = await hmac(textBytes("AWS4" + env.B2_APP_KEY), dateStamp);
  const kRegion = await hmac(kDate, B2_REGION);
  const kService = await hmac(kRegion, B2_SERVICE);
  const kSigning = await hmac(kService, "aws4_request");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  headers.authorization =
    "AWS4-HMAC-SHA256 Credential=" + env.B2_KEY_ID + "/" + scope +
    ", SignedHeaders=" + signedHeaders +
    ", Signature=" + await hmacHex(kSigning, stringToSign);

  return fetch(B2_ENDPOINT + path, {
    method,
    headers,
    body: bytes.length ? bytes : undefined,
  });
}

async function objectSchema(env) {
  const result = await env.CENTRAL_DB
    .prepare("PRAGMA table_info(objects)")
    .all();
  return result.results || [];
}

async function groomObjects(env, dryRun = false) {
  if (!env.CENTRAL_DB) throw new Error("D1 binding missing");
  if (!env.CENTRAL_KV) throw new Error("KV binding missing");

  const cutoff = new Date(
    Date.now() - GROOM_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const query = await env.CENTRAL_DB.prepare(
    "SELECT object_id,source_id,vault_id,storage_key,status,updated_at " +
    "FROM objects " +
    "WHERE status='stored' AND archived_at IS NULL AND updated_at < ? " +
    "ORDER BY updated_at ASC LIMIT ?",
  ).bind(cutoff, GROOM_LIMIT).all();

  const candidates = query.results || [];

  if (dryRun) {
    return {
      ok: true,
      status: "GREEN",
      dry_run: true,
      retention_days: GROOM_RETENTION_DAYS,
      bounded_to: GROOM_LIMIT,
      candidate_count: candidates.length,
      candidates,
    };
  }

  let archivedCount = 0;
  if (candidates.length) {
    const ids = candidates.map((row) => row.object_id);
    const placeholders = ids.map(() => "?").join(",");
    const result = await env.CENTRAL_DB.prepare(
      "UPDATE objects SET status='archived', archived_at=CURRENT_TIMESTAMP, " +
      "updated_at=CURRENT_TIMESTAMP " +
      "WHERE object_id IN (" + placeholders + ") " +
      "AND status='stored' AND archived_at IS NULL",
    ).bind(...ids).run();
    archivedCount = result.meta?.changes || 0;
  }

  const output = {
    ok: true,
    status: "GREEN",
    dry_run: false,
    retention_days: GROOM_RETENTION_DAYS,
    bounded_to: GROOM_LIMIT,
    archived_count: archivedCount,
    storage_bytes_deleted: 0,
    storage_delete_performed: false,
    ran_at: new Date().toISOString(),
  };

  await env.CENTRAL_KV.put("groom/last", JSON.stringify(output));
  return output;
}

async function storeObject(env, input) {
  const source = await env.CENTRAL_DB
    .prepare("SELECT id FROM sources WHERE source_name=? AND status='active' LIMIT 1")
    .bind(input.sourceName)
    .first();

  if (!source) throw new Error("source not registered");

  const policy = await env.CENTRAL_DB
    .prepare("SELECT vault_sync FROM sync_policies WHERE source_id=?")
    .bind(source.id)
    .first();

  if (!policy?.vault_sync) throw new Error("vault sync disabled");

  const body = toBytes(input.body);
  const checksum = await sha256Hex(body);
  const key =
    "objects/" +
    input.sourceName.replace(/[^a-zA-Z0-9_-]/g, "_") +
    "/" +
    input.objectId;
  const contentType = input.contentType || "application/octet-stream";

  const put = await b2Request(env, "PUT", key, body, contentType);
  if (!put.ok) throw new Error("B2_WRITE_FAILED:" + put.status);

  const get = await b2Request(env, "GET", key);
  if (!get.ok) throw new Error("B2_READ_FAILED:" + get.status);

  const verifiedBytes = new Uint8Array(await get.arrayBuffer());
  if (await sha256Hex(verifiedBytes) !== checksum) {
    throw new Error("B2_VERIFY_FAILED");
  }

  const now = new Date().toISOString();
  const values = {
    object_id: input.objectId,
    source_id: source.id,
    vault_id: input.vaultId,
    storage_provider: "backblaze-b2",
    storage_bucket: B2_BUCKET,
    storage_key: key,
    status: "stored",
    name: input.name,
    kind: input.kind,
    mime_type: contentType,
    size_bytes: body.byteLength,
    checksum,
    checksum_algorithm: "SHA-256",
    external_id: input.externalId,
    project_slug: input.projectSlug,
    created_at: now,
    updated_at: now,
    stored_at: now,
  };

  const schema = await objectSchema(env);
  const columns = schema
    .map((column) => column.name)
    .filter((name) => Object.prototype.hasOwnProperty.call(values, name));

  if (!columns.length) throw new Error("objects table has no compatible columns");

  const sql =
    "INSERT INTO objects (" + columns.join(",") + ") VALUES (" +
    columns.map(() => "?").join(",") + ")";

  try {
    await env.CENTRAL_DB
      .prepare(sql)
      .bind(...columns.map((column) => values[column] ?? null))
      .run();
  } catch (error) {
    console.error("OBJECT_INSERT_FAILED", error);
    throw new Error("D1_OBJECT_INSERT_FAILED:" + errorText(error));
  }

  await env.CENTRAL_KV.put(
    "object/last",
    JSON.stringify({
      object_id: input.objectId,
      source_name: input.sourceName,
      vault_id: input.vaultId,
      storage_key: key,
      stored_at: now,
    }),
  );

  return {
    ok: true,
    status: "GREEN",
    object_id: input.objectId,
    storage_key: key,
    size_bytes: body.byteLength,
    checksum,
    verified: true,
  };
}


function operationNow() {
  return new Date().toISOString();
}

function controlOperationResponse(row, events = []) {
  return {
    operation_id: row.operation_id,
    idempotency_key: row.idempotency_key,
    action: row.action,
    source_name: row.source_name,
    target: row.target_type
      ? { type: row.target_type, id: row.target_id }
      : null,
    authorization: row.authorization_state,
    policy: row.policy_decision,
    state: row.state,
    attempt: row.attempt,
    failure_category: row.failure_category,
    recovery_state: row.recovery_state,
    result: row.result_json ? JSON.parse(row.result_json) : null,
    audit_ref: row.audit_ref,
    requested_at: row.requested_at,
    authorized_at: row.authorized_at,
    started_at: row.started_at,
    verified_at: row.verified_at,
    completed_at: row.completed_at,
    updated_at: row.updated_at,
    events,
  };
}

async function recordControlEvent(env, operationId, eventType, state, details = {}) {
  await env.CENTRAL_DB.prepare(
    "INSERT INTO control_operation_events " +
    "(event_id,operation_id,event_type,state,details_json,created_at) VALUES (?,?,?,?,?,?)"
  ).bind(
    crypto.randomUUID(),
    operationId,
    eventType,
    state,
    JSON.stringify(details),
    operationNow(),
  ).run();
}

async function getControlOperation(env, operationId) {
  const row = await env.CENTRAL_DB.prepare(
    "SELECT * FROM control_operations WHERE operation_id=? LIMIT 1"
  ).bind(operationId).first();
  if (!row) return null;
  const events = await env.CENTRAL_DB.prepare(
    "SELECT event_id,event_type,state,details_json,created_at " +
    "FROM control_operation_events WHERE operation_id=? ORDER BY created_at,event_id"
  ).bind(operationId).all();
  return controlOperationResponse(row, (events.results || []).map((event) => ({
    event_id: event.event_id,
    event_type: event.event_type,
    state: event.state,
    details: event.details_json ? JSON.parse(event.details_json) : {},
    created_at: event.created_at,
  })));
}

async function executeSyncPolicyAction(env, payload) {
  const name = String(payload.source_name || "").trim();
  if (!name) {
    return { ok: false, status: "FAILED", http_status: 400, error: "source_name required" };
  }

  const vaultSync = payload.vault_sync === false ? 0 : 1;
  const phoneSync = payload.phone_sync === true ? 1 : 0;
  const result = await env.CENTRAL_DB.prepare(
    "UPDATE sync_policies SET vault_sync=?,phone_sync=?,updated_at=CURRENT_TIMESTAMP " +
    "WHERE source_id=(SELECT id FROM sources WHERE source_name=? LIMIT 1)"
  ).bind(vaultSync, phoneSync, name).run();

  if (!result.meta?.changes) {
    return { ok: false, status: "FAILED", http_status: 404, error: "source not found" };
  }

  return {
    ok: true,
    status: "GREEN",
    source_name: name,
    vault_sync: vaultSync,
    phone_sync: phoneSync,
  };
}

async function createControlOperation(env, payload, request) {
  const authorized = await controlActionAuthorized(request, env);
  if (authorized === null) {
    return { response: Response.json(
      { ok: false, status: "FAILED", error: "control action authorization not configured" },
      { status: 503 },
    ) };
  }
  if (!authorized) {
    return { response: Response.json(
      { ok: false, status: "DENIED", error: "control action unauthorized" },
      { status: 403 },
    ) };
  }

  const action = String(payload.action || "").trim();
  const idempotencyKey = String(
    payload.idempotency_key || request.headers.get("idempotency-key") || ""
  ).trim();
  if (!action || !idempotencyKey) {
    return { response: Response.json(
      { ok: false, status: "FAILED", error: "action and idempotency_key required" },
      { status: 400 },
    ) };
  }
  if (idempotencyKey.length > 200) {
    return { response: Response.json(
      { ok: false, status: "FAILED", error: "idempotency_key too long" },
      { status: 400 },
    ) };
  }

  const sourceName = String(payload.source_name || "").trim() || null;
  const requestHash = await sha256Hex(JSON.stringify({
    action,
    source_name: sourceName,
    vault_sync: payload.vault_sync === false ? false : true,
    phone_sync: payload.phone_sync === true ? true : false,
  }));

  const existing = await env.CENTRAL_DB.prepare(
    "SELECT * FROM control_operations WHERE idempotency_key=? LIMIT 1"
  ).bind(idempotencyKey).first();
  if (existing) {
    if (existing.request_hash !== requestHash) {
      return { response: Response.json(
        { ok: false, status: "CONFLICT", error: "idempotency key reused for different request" },
        { status: 409 },
      ) };
    }
    const existingFull = await getControlOperation(env, existing.operation_id);
    return {
      response: Response.json(
        { ok: true, status: existing.state === "completed" ? "GREEN" : "IN_PROGRESS", replay: true, operation: existingFull },
        { status: existing.state === "completed" ? 200 : 202 },
      ),
    };
  }

  const operationId = "op-" + crypto.randomUUID();
  const auditRef = "audit-" + operationId;
  const now = operationNow();
  const supported = action === "sync_policy";
  const source = sourceName
    ? await env.CENTRAL_DB.prepare(
        "SELECT id,source_name,status FROM sources WHERE source_name=? LIMIT 1"
      ).bind(sourceName).first()
    : null;

  let policyDecision = "allow";
  let initialState = "requested";
  let authorizationState = "authorized";
  let failureCategory = null;
  let recoveryState = null;

  if (!supported) {
    policyDecision = "blocked";
    initialState = "blocked";
    authorizationState = "authorized";
    failureCategory = "unsupported_action";
  } else if (!source || source.status !== "active") {
    policyDecision = "blocked";
    initialState = "blocked";
    failureCategory = "target_not_found";
  } else {
    // sync_policy manages the policy itself; its resulting value is not a
    // prerequisite for changing that same policy. Authorization + target
    // resolution remain mandatory gates.
    policyDecision = "allow";
  }

  await env.CENTRAL_DB.batch([
    env.CENTRAL_DB.prepare(
      "INSERT INTO control_operations " +
      "(operation_id,idempotency_key,request_hash,action,source_name,target_type,target_id," +
      "authorization_state,policy_decision,state,attempt,failure_category,recovery_state," +
      "result_json,audit_ref,requested_at,created_at,updated_at) " +
      "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
    ).bind(
      operationId,
      idempotencyKey,
      requestHash,
      action,
      sourceName,
      sourceName ? "source" : null,
      sourceName,
      authorizationState,
      policyDecision,
      initialState,
      0,
      failureCategory,
      recoveryState,
      null,
      auditRef,
      now,
      now,
      now,
    ),
    env.CENTRAL_DB.prepare(
      "INSERT INTO control_operation_events " +
      "(event_id,operation_id,event_type,state,details_json,created_at) VALUES (?,?,?,?,?,?)"
    ).bind(
      crypto.randomUUID(),
      operationId,
      "requested",
      initialState,
      JSON.stringify({ action, source_name: sourceName, policy_decision: policyDecision }),
      now,
    ),
  ]);

  if (initialState === "blocked") {
    const blocked = await getControlOperation(env, operationId);
    return {
      response: Response.json(
        { ok: false, status: "BLOCKED", operation: blocked },
        { status: 409 },
      ),
    };
  }

  await env.CENTRAL_DB.batch([
    env.CENTRAL_DB.prepare(
      "UPDATE control_operations SET state='authorized',authorized_at=?,updated_at=? WHERE operation_id=?"
    ).bind(now, now, operationId),
    env.CENTRAL_DB.prepare(
      "INSERT INTO control_operation_events " +
      "(event_id,operation_id,event_type,state,details_json,created_at) VALUES (?,?,?,?,?,?)"
    ).bind(
      crypto.randomUUID(),
      operationId,
      "authorized",
      "authorized",
      JSON.stringify({ policy_decision: policyDecision }),
      now,
    ),
  ]);

  await env.CENTRAL_DB.batch([
    env.CENTRAL_DB.prepare(
      "UPDATE control_operations SET state='running',attempt=attempt+1,started_at=?,updated_at=? WHERE operation_id=?"
    ).bind(operationNow(), operationNow(), operationId),
    env.CENTRAL_DB.prepare(
      "INSERT INTO control_operation_events " +
      "(event_id,operation_id,event_type,state,details_json,created_at) VALUES (?,?,?,?,?,?)"
    ).bind(
      crypto.randomUUID(),
      operationId,
      "started",
      "running",
      JSON.stringify({ attempt: 1 }),
      operationNow(),
    ),
  ]);

  let result;
  try {
    if (action === "sync_policy") {
      result = await executeSyncPolicyAction(env, payload);
    } else {
      throw new Error("unsupported action");
    }

    if (!result.ok) {
      const failedAt = operationNow();
      await env.CENTRAL_DB.batch([
        env.CENTRAL_DB.prepare(
          "UPDATE control_operations SET state='failed',failure_category=?,result_json=?,completed_at=?,updated_at=? WHERE operation_id=?"
        ).bind("execution", JSON.stringify(result), failedAt, failedAt, operationId),
        env.CENTRAL_DB.prepare(
          "INSERT INTO control_operation_events " +
          "(event_id,operation_id,event_type,state,details_json,created_at) VALUES (?,?,?,?,?,?)"
        ).bind(
          crypto.randomUUID(),
          operationId,
          "failed",
          "failed",
          JSON.stringify({ category: "execution", error: result.error }),
          failedAt,
        ),
      ]);
      const failed = await getControlOperation(env, operationId);
      return { response: Response.json(
        { ok: false, status: "FAILED", operation: failed },
        { status: result.http_status || 500 },
      ) };
    }

    const verifyAt = operationNow();
    await env.CENTRAL_DB.batch([
      env.CENTRAL_DB.prepare(
        "UPDATE control_operations SET state='verifying',verified_at=?,result_json=?,updated_at=? WHERE operation_id=?"
      ).bind(verifyAt, JSON.stringify(result), verifyAt, operationId),
      env.CENTRAL_DB.prepare(
        "INSERT INTO control_operation_events " +
        "(event_id,operation_id,event_type,state,details_json,created_at) VALUES (?,?,?,?,?,?)"
      ).bind(
        crypto.randomUUID(),
        operationId,
        "verified",
        "verifying",
        JSON.stringify({ verification: "provider_result_confirmed" }),
        verifyAt,
      ),
    ]);

    const completedAt = operationNow();
    await env.CENTRAL_DB.batch([
      env.CENTRAL_DB.prepare(
        "UPDATE control_operations SET state='completed',completed_at=?,updated_at=? WHERE operation_id=?"
      ).bind(completedAt, completedAt, operationId),
      env.CENTRAL_DB.prepare(
        "INSERT INTO control_operation_events " +
        "(event_id,operation_id,event_type,state,details_json,created_at) VALUES (?,?,?,?,?,?)"
      ).bind(
        crypto.randomUUID(),
        operationId,
        "completed",
        "completed",
        JSON.stringify({ verified: true }),
        completedAt,
      ),
    ]);

    const completed = await getControlOperation(env, operationId);
    return {
      response: Response.json(
        { ok: true, status: "GREEN", operation: completed, result },
        { status: 200 },
      ),
    };
  } catch (error) {
    const failedAt = operationNow();
    await env.CENTRAL_DB.batch([
      env.CENTRAL_DB.prepare(
        "UPDATE control_operations SET state='failed',failure_category=?,result_json=?,completed_at=?,updated_at=? WHERE operation_id=?"
      ).bind("execution_exception", JSON.stringify({ error: errorText(error) }), failedAt, failedAt, operationId),
      env.CENTRAL_DB.prepare(
        "INSERT INTO control_operation_events " +
        "(event_id,operation_id,event_type,state,details_json,created_at) VALUES (?,?,?,?,?,?)"
      ).bind(
        crypto.randomUUID(),
        operationId,
        "failed",
        "failed",
        JSON.stringify({ category: "execution_exception" }),
        failedAt,
      ),
    ]);
    const failed = await getControlOperation(env, operationId);
    return {
      response: Response.json(
        { ok: false, status: "FAILED", operation: failed },
        { status: 500 },
      ),
    };
  }
}

async function reconcileControlOperation(env, operationId, request) {
  const authorized = await controlActionAuthorized(request, env);
  if (authorized === null) {
    return Response.json(
      { ok: false, status: "FAILED", error: "control action authorization not configured" },
      { status: 503 },
    );
  }
  if (!authorized) {
    return Response.json(
      { ok: false, status: "DENIED", error: "control action unauthorized" },
      { status: 403 },
    );
  }

  const row = await env.CENTRAL_DB.prepare(
    "SELECT * FROM control_operations WHERE operation_id=? LIMIT 1"
  ).bind(operationId).first();
  if (!row) {
    return Response.json({ ok: false, status: "FAILED", error: "operation not found" }, { status: 404 });
  }
  if (row.state !== "reconciliation_required" && row.recovery_state !== "reconciliation_required") {
    return Response.json(
      { ok: false, status: "BLOCKED", error: "operation does not require reconciliation", operation: await getControlOperation(env, operationId) },
      { status: 409 },
    );
  }

  return Response.json(
    { ok: false, status: "BLOCKED", error: "no safe reconciliation handler registered for action", operation: await getControlOperation(env, operationId) },
    { status: 409 },
  );
}

async function controlStatusResponse(env) {
  const checks = {
    d1: false,
    kv: false,
    b2: false,
  };

  try {
    await env.CENTRAL_DB.prepare("SELECT 1 AS ok").first();
    checks.d1 = true;
  } catch (_) {}

  try {
    await env.CENTRAL_KV.get("control/ping");
    checks.kv = true;
  } catch (_) {}

  checks.b2 = !!(env.B2_KEY_ID && env.B2_APP_KEY);

  const sources = await env.CENTRAL_DB.prepare(
    "SELECT s.source_name,s.source_type,s.status,p.vault_sync,p.phone_sync " +
    "FROM sources s JOIN sync_policies p ON p.source_id=s.id ORDER BY s.id"
  ).all();

  const body = {
    system: "ALEX-MIND",
    control_plane: "ONLINE",
    status: checks.d1 && checks.kv && checks.b2 ? "GREEN" : "FAILED",
    checks,
    core: {
      database: checks.d1,
      state: checks.kv,
      storage: checks.b2,
    },
    sources: sources.results || [],
    read_only: true,
    checked_at: new Date().toISOString(),
  };

  await env.CENTRAL_KV.put(
    "control/last",
    JSON.stringify({
      status: body.status,
      checked_at: body.checked_at,
    }),
  );

  return Response.json(body);
}

export default {
  async scheduled(_controller, env) {
    try {
      const result = await groomObjects(env, false);
      console.log("SCHEDULED_GROOM", JSON.stringify(result));
    } catch (error) {
      console.error("SCHEDULED_GROOM_ERROR", error);
    }
  },

  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      const authResponse = await authRoutes(request, env);
      if (authResponse) return authResponse;

      if (url.pathname === "/control/status" && request.method === "GET") {
        return controlStatusResponse(env);
      }

      if (url.pathname === "/control/check" && request.method === "GET") {
        return controlStatusResponse(env);
      }

      if (url.pathname === "/health") {
        const tables = await env.CENTRAL_DB
          .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
          .all();
        return Response.json({
          system: "ALEX CENTRAL VAULT",
          status: "GREEN",
          d1: { connected: true, tables: tables.results?.map((row) => row.name) || [] },
          kv: { connected: true },
        });
      }

      if (url.pathname === "/status") {
        const result = await env.CENTRAL_DB.prepare(
          "SELECT s.id,s.source_type,s.source_name,s.status," +
          "p.vault_sync,p.phone_sync,p.last_sync_at,p.last_sync_status " +
          "FROM sources s JOIN sync_policies p ON p.source_id=s.id ORDER BY s.id",
        ).all();
        return Response.json({
          system: "ALEX CENTRAL VAULT",
          status: "GREEN",
          sources: result.results || [],
        });
      }

      if (url.pathname === "/storage/status") {
        return Response.json({
          ok: true,
          backend: "backblaze-b2",
          bucket: B2_BUCKET,
          endpoint: B2_ENDPOINT,
          configured: !!(env.B2_KEY_ID && env.B2_APP_KEY),
          credentials_exposed: false,
        });
      }

      if (url.pathname === "/sync-policy" && request.method === "GET") {
        const name = url.searchParams.get("source_name");
        if (!name) {
          return Response.json({ ok: false, error: "source_name required" }, { status: 400 });
        }
        const policy = await env.CENTRAL_DB.prepare(
          "SELECT s.id,s.source_type,s.source_name,p.vault_sync,p.phone_sync," +
          "p.status,p.last_sync_at,p.last_sync_status " +
          "FROM sources s JOIN sync_policies p ON p.source_id=s.id " +
          "WHERE s.source_name=? LIMIT 1",
        ).bind(name).first();
        return policy
          ? Response.json({ ok: true, policy })
          : Response.json({ ok: false, error: "source not found" }, { status: 404 });
      }

      if (url.pathname === "/control/operations" && request.method === "POST") {
        const payload = await request.json();
        return (await createControlOperation(env, payload, request)).response;
      }

      if (url.pathname === "/control/operations" && request.method === "GET") {
        const authorized = await controlActionAuthorized(request, env);
        if (authorized === null) return Response.json({ ok: false, status: "FAILED", error: "control action authorization not configured" }, { status: 503 });
        if (!authorized) return Response.json({ ok: false, status: "DENIED", error: "control action unauthorized" }, { status: 403 });
        const operationId = url.searchParams.get("operation_id");
        if (operationId) {
          const operation = await getControlOperation(env, operationId);
          return operation
            ? Response.json({ ok: true, operation })
            : Response.json({ ok: false, error: "operation not found" }, { status: 404 });
        }
        const result = await env.CENTRAL_DB.prepare(
          "SELECT operation_id,idempotency_key,action,source_name,target_type,target_id," +
          "authorization_state,policy_decision,state,attempt,failure_category,recovery_state," +
          "requested_at,completed_at,updated_at FROM control_operations ORDER BY updated_at DESC LIMIT 50"
        ).all();
        return Response.json({ ok: true, operations: result.results || [] });
      }

      const reconcileMatch = url.pathname.match(/^\/control\/operations\/([^/]+)\/reconcile$/);
      if (reconcileMatch && request.method === "POST") {
        return reconcileControlOperation(env, decodeURIComponent(reconcileMatch[1]), request);
      }

      if (url.pathname === "/sync-policy" && request.method === "POST") {
        const payload = await request.json();
        const idempotencyKey =
          request.headers.get("idempotency-key") ||
          "legacy-sync-policy-" + crypto.randomUUID();
        const operation = await createControlOperation(
          env,
          { ...payload, action: "sync_policy", idempotency_key: idempotencyKey },
          request,
        );
        return operation.response;
      }

      if (url.pathname === "/debug/objects-schema" && request.method === "GET") {
        return Response.json({ ok: true, columns: await objectSchema(env) });
      }

      if (url.pathname === "/objects/test" && request.method === "GET") {
        const authorized = await controlActionAuthorized(request, env);
        if (authorized === null) return Response.json({ ok: false, status: "FAILED", error: "control action authorization not configured" }, { status: 503 });
        if (!authorized) return Response.json({ ok: false, status: "DENIED", error: "control action unauthorized" }, { status: 403 });
        return Response.json(await storeObject(env, {
          sourceName: "GitHub",
          vaultId: B2_BUCKET,
          objectId: "runtime-" + crypto.randomUUID(),
          name: "ALEX-MIND runtime object test",
          kind: "test",
          contentType: "text/plain",
          body: "ALEX MIND runtime object test",
        }));
      }

      if (url.pathname === "/objects/groom" && request.method === "POST") {
        const authorized = await controlActionAuthorized(request, env);
        if (authorized === null) return Response.json({ ok: false, status: "FAILED", error: "control action authorization not configured" }, { status: 503 });
        if (!authorized) return Response.json({ ok: false, status: "DENIED", error: "control action unauthorized" }, { status: 403 });
        return Response.json(await groomObjects(
          env,
          url.searchParams.get("dry_run") === "true",
        ));
      }

      if (url.pathname === "/objects" && request.method === "POST") {
        const authorized = await controlActionAuthorized(request, env);
        if (authorized === null) return Response.json({ ok: false, status: "FAILED", error: "control action authorization not configured" }, { status: 503 });
        if (!authorized) return Response.json({ ok: false, status: "DENIED", error: "control action unauthorized" }, { status: 403 });
        const input = {
          sourceName: String(request.headers.get("x-source-name") || "").trim(),
          vaultId: String(request.headers.get("x-vault-id") || "").trim(),
          objectId: String(request.headers.get("x-object-id") || crypto.randomUUID()).trim(),
          name: request.headers.get("x-object-name"),
          kind: request.headers.get("x-object-kind") || "file",
          externalId: request.headers.get("x-external-id"),
          projectSlug: request.headers.get("x-project-slug"),
          contentType: request.headers.get("content-type") || "application/octet-stream",
          body: await request.arrayBuffer(),
        };

        if (!input.sourceName || !input.vaultId) {
          return Response.json(
            { ok: false, error: "x-source-name and x-vault-id required" },
            { status: 400 },
          );
        }

        return Response.json(await storeObject(env, input));
      }

      return new Response("ALEX CENTRAL VAULT", { status: 200 });
    } catch (error) {
      console.error("ALEX_MIND_RUNTIME_ERROR", error);
      return Response.json(
        { ok: false, status: "FAILED", error: errorText(error) },
        { status: 500 },
      );
    }
  },
};

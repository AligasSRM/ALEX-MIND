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

      if (url.pathname === "/sync-policy" && request.method === "POST") {
        const payload = await request.json();
        const name = String(payload.source_name || "").trim();
        if (!name) {
          return Response.json({ ok: false, error: "source_name required" }, { status: 400 });
        }
        const result = await env.CENTRAL_DB.prepare(
          "UPDATE sync_policies SET vault_sync=?,phone_sync=?,updated_at=CURRENT_TIMESTAMP " +
          "WHERE source_id=(SELECT id FROM sources WHERE source_name=? LIMIT 1)",
        ).bind(
          payload.vault_sync === false ? 0 : 1,
          payload.phone_sync === true ? 1 : 0,
          name,
        ).run();

        return result.meta?.changes
          ? Response.json({
              ok: true,
              source_name: name,
              vault_sync: payload.vault_sync === false ? 0 : 1,
              phone_sync: payload.phone_sync === true ? 1 : 0,
            })
          : Response.json({ ok: false, error: "source not found" }, { status: 404 });
      }

      if (url.pathname === "/debug/objects-schema" && request.method === "GET") {
        return Response.json({ ok: true, columns: await objectSchema(env) });
      }

      if (url.pathname === "/objects/test" && request.method === "GET") {
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
        return Response.json(await groomObjects(
          env,
          url.searchParams.get("dry_run") === "true",
        ));
      }

      if (url.pathname === "/objects" && request.method === "POST") {
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

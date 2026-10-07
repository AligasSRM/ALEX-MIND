const PBKDF2_ITERATIONS = 600000;
const PASSWORD_MIN_LENGTH = 12;
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 30 * 60 * 1000;
const LOGIN_MAX_FAILURES = 8;
const LOGIN_LOCK_MS = 15 * 60 * 1000;

function authBytes(value) {
  return new TextEncoder().encode(String(value));
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(normalized);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function randomToken(bytes = 32) {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return bytesToBase64Url(value);
}

async function authSha256(value) {
  const digest = await crypto.subtle.digest("SHA-256", authBytes(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

async function derivePassword(password, saltBytes, iterations = PBKDF2_ITERATIONS) {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    authBytes(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: saltBytes, iterations },
    baseKey,
    256,
  );
  return new Uint8Array(bits);
}

async function hashPassword(password) {
  if (typeof password !== "string" || password.length < PASSWORD_MIN_LENGTH || password.length > 1024) {
    throw new Error("invalid password");
  }
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const derived = await derivePassword(password, salt);
  return "pbkdf2-sha256$" + PBKDF2_ITERATIONS + "$" +
    bytesToBase64Url(salt) + "$" + bytesToBase64Url(derived);
}

async function verifyPassword(password, encoded) {
  const parts = String(encoded || "").split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2-sha256") return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 100000 || iterations > 2000000) return false;
  let salt, expected;
  try {
    salt = base64UrlToBytes(parts[2]);
    expected = base64UrlToBytes(parts[3]);
  } catch {
    return false;
  }
  const actual = await derivePassword(password, salt, iterations);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function validEmail(email) {
  return email.length >= 3 && email.length <= 320 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function json(body, status = 200, headers = {}) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}

function parseCookies(request) {
  const header = request.headers.get("cookie") || "";
  const out = {};
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

function sessionCookie(value, maxAge) {
  return "__Host-alex_session=" + encodeURIComponent(value) +
    "; Max-Age=" + maxAge + "; Path=/; Secure; HttpOnly; SameSite=Strict";
}

function clearSessionCookie() {
  return sessionCookie("", 0);
}

function csrfCookie(value, maxAge = 60 * 60 * 8) {
  return "alex_csrf=" + encodeURIComponent(value) +
    "; Max-Age=" + maxAge + "; Path=/; Secure; SameSite=Strict";
}

function clearCsrfCookie() {
  return csrfCookie("", 0);
}

function requestOriginAllowed(request) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  return origin === new URL(request.url).origin;
}

async function requireCsrf(request) {
  if (!requestOriginAllowed(request)) return false;
  const cookies = parseCookies(request);
  const csrfCookieValue = cookies.alex_csrf || "";
  const csrfHeader = request.headers.get("x-csrf-token") || "";
  if (!csrfCookieValue || !csrfHeader) return false;
  const a = authBytes(csrfCookieValue);
  const b = authBytes(csrfHeader);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function recordSecurityEvent(env, userId, eventType, success = true, metadata = {}) {
  await env.CENTRAL_DB.prepare(
    "INSERT INTO security_events (event_id,user_id,event_type,success,metadata_json,created_at) VALUES (?,?,?,?,?,?)",
  ).bind(
    crypto.randomUUID(), userId || null, eventType, success ? 1 : 0,
    JSON.stringify(metadata), new Date().toISOString(),
  ).run();
}

async function createSession(env, userId) {
  const sessionId = crypto.randomUUID();
  const verifier = randomToken(32);
  const csrfToken = randomToken(32);
  const now = Date.now();
  const created = new Date(now).toISOString();
  const expires = new Date(now + SESSION_TTL_MS).toISOString();
  await env.CENTRAL_DB.prepare(
    "INSERT INTO user_sessions (session_id,user_id,verifier_hash,csrf_token_hash,created_at,expires_at,last_seen_at) VALUES (?,?,?,?,?,?,?)",
  ).bind(
    sessionId, userId, await authSha256(verifier), await authSha256(csrfToken),
    created, expires, created,
  ).run();
  return {
    cookie: sessionId + "." + verifier,
    csrfToken,
    expires,
  };
}

async function currentSession(env, request) {
  const cookies = parseCookies(request);
  const raw = cookies.__Host-alex_session || "";
  const separator = raw.indexOf(".");
  if (separator < 1) return null;
  const sessionId = raw.slice(0, separator);
  const verifier = raw.slice(separator + 1);
  if (!verifier) return null;
  const row = await env.CENTRAL_DB.prepare(
    "SELECT s.session_id,s.user_id,s.verifier_hash,s.csrf_token_hash,s.expires_at,s.revoked_at,u.email_display,u.email_verified_at,u.status " +
    "FROM user_sessions s JOIN users u ON u.user_id=s.user_id WHERE s.session_id=? LIMIT 1",
  ).bind(sessionId).first();
  if (!row || row.revoked_at || row.status !== "active" || new Date(row.expires_at).getTime() <= Date.now()) return null;
  if (await authSha256(verifier) !== row.verifier_hash) return null;
  return row;
}

async function requireSession(env, request) {
  const session = await currentSession(env, request);
  if (!session) return { response: json({ ok: false, error: "authentication required" }, 401) };
  return { session };
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

async function sendSecurityEmail(env, { to, subject, text, html }) {
  if (!env.EMAIL || !env.AUTH_EMAIL_FROM) {
    return false;
  }
  await env.EMAIL.send({ to, from: env.AUTH_EMAIL_FROM, subject, text, html });
  return true;
}

async function issueVerification(env, user) {
  const token = randomToken(32);
  const tokenHash = await authSha256(token);
  const expires = new Date(Date.now() + VERIFICATION_TTL_MS).toISOString();
  await env.CENTRAL_DB.prepare(
    "INSERT INTO email_verification_tokens (token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)",
  ).bind(tokenHash, user.user_id, expires, new Date().toISOString()).run();
  const base = env.AUTH_BASE_URL || "";
  const url = base + "/verify-email?token=" + encodeURIComponent(token);
  const sent = await sendSecurityEmail(env, {
    to: user.email_display,
    subject: "Verify your ALEX-MIND account",
    text: "Verify your ALEX-MIND account: " + url,
    html: "<p>Verify your ALEX-MIND account.</p><p><a href=\"" + url + "\">Verify email</a></p>",
  });
  return { sent, tokenIssued: true };
}

async function issuePasswordReset(env, user) {
  const token = randomToken(32);
  const tokenHash = await authSha256(token);
  const expires = new Date(Date.now() + RESET_TTL_MS).toISOString();
  await env.CENTRAL_DB.prepare(
    "INSERT INTO password_reset_tokens (token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)",
  ).bind(tokenHash, user.user_id, expires, new Date().toISOString()).run();
  const base = env.AUTH_BASE_URL || "";
  const url = base + "/reset-password?token=" + encodeURIComponent(token);
  const sent = await sendSecurityEmail(env, {
    to: user.email_display,
    subject: "Reset your ALEX-MIND password",
    text: "Reset your ALEX-MIND password: " + url,
    html: "<p>Reset your ALEX-MIND password.</p><p><a href=\"" + url + "\">Reset password</a></p>",
  });
  return { sent };
}

async function authRoutes(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (!path.startsWith("/api/auth/")) return null;

  if (request.method === "POST" && !await requireCsrf(request)) {
    // Login/signup/reset are deliberately exempt from the session CSRF token
    // because they do not carry an authenticated session. Origin is still checked.
    if (!requestOriginAllowed(request)) return json({ ok: false, error: "origin rejected" }, 403);
  }

  if (path === "/api/auth/csrf" && request.method === "GET") {
    const token = randomToken(32);
    return new Response(JSON.stringify({ ok: true, csrf_token: token }), {
      status: 200,
      headers: { "content-type": "application/json", "cache-control": "no-store", "Set-Cookie": csrfCookie(token) },
    });
  }

  if (path === "/api/auth/signup" && request.method === "POST") {
    const body = await readJson(request);
    const email = normalizeEmail(body?.email);
    const password = body?.password;
    if (!validEmail(email) || typeof password !== "string" || password.length < PASSWORD_MIN_LENGTH || password.length > 1024) {
      return json({ ok: false, error: "invalid signup data" }, 400);
    }
    const existing = await env.CENTRAL_DB.prepare("SELECT user_id,status FROM users WHERE email_normalized=? LIMIT 1").bind(email).first();
    if (existing) return json({ ok: false, error: "account already exists" }, 409);
    if (!env.EMAIL || !env.AUTH_EMAIL_FROM || !env.AUTH_BASE_URL) {
      return json({ ok: false, error: "account email delivery is not configured" }, 503);
    }
    const userId = "usr-" + crypto.randomUUID();
    const now = new Date().toISOString();
    const passwordHash = await hashPassword(password);
    const user = { user_id: userId, email_display: email };
    await env.CENTRAL_DB.batch([
      env.CENTRAL_DB.prepare("INSERT INTO users (user_id,email_normalized,email_display,status,created_at,updated_at) VALUES (?,?,?,?,?,?)").bind(userId,email,email,"pending",now,now),
      env.CENTRAL_DB.prepare("INSERT INTO user_credentials (user_id,password_hash,password_changed_at,created_at,updated_at) VALUES (?,?,?,?,?)").bind(userId,passwordHash,now,now,now),
    ]);
    try {
      await issueVerification(env, user);
    } catch (error) {
      await env.CENTRAL_DB.batch([
        env.CENTRAL_DB.prepare("DELETE FROM user_credentials WHERE user_id=?").bind(userId),
        env.CENTRAL_DB.prepare("DELETE FROM users WHERE user_id=?").bind(userId),
      ]);
      return json({ ok: false, error: "verification email could not be sent" }, 503);
    }
    await recordSecurityEvent(env,userId,"signup",true);
    return json({ ok:true, status:"VERIFICATION_REQUIRED", message:"Check your email to verify the account." },201);
  }

  if (path === "/api/auth/verify-email" && request.method === "GET") {
    const token = url.searchParams.get("token") || "";
    const tokenHash = await authSha256(token);
    const row = await env.CENTRAL_DB.prepare(
      "SELECT token_hash,user_id,expires_at,used_at FROM email_verification_tokens WHERE token_hash=? LIMIT 1",
    ).bind(tokenHash).first();
    if (!row || row.used_at || new Date(row.expires_at).getTime() <= Date.now()) {
      return json({ ok:false, error:"invalid or expired verification token" },400);
    }
    const now = new Date().toISOString();
    await env.CENTRAL_DB.batch([
      env.CENTRAL_DB.prepare("UPDATE email_verification_tokens SET used_at=? WHERE token_hash=?").bind(now,tokenHash),
      env.CENTRAL_DB.prepare("UPDATE users SET status='active',email_verified_at=?,updated_at=? WHERE user_id=?").bind(now,now,row.user_id),
    ]);
    await recordSecurityEvent(env,row.user_id,"email_verified",true);
    return json({ok:true,status:"VERIFIED"});
  }

  if (path === "/api/auth/login" && request.method === "POST") {
    const body = await readJson(request);
    const email = normalizeEmail(body?.email);
    const password = body?.password;
    const generic = json({ok:false,error:"invalid email or password"},401);
    const user = await env.CENTRAL_DB.prepare(
      "SELECT u.user_id,u.email_display,u.status,u.email_verified_at,c.password_hash,c.failed_attempts,c.locked_until FROM users u JOIN user_credentials c ON c.user_id=u.user_id WHERE u.email_normalized=? LIMIT 1",
    ).bind(email).first();
    if (!user) return generic;
    if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) return generic;
    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      const failures = Number(user.failed_attempts || 0) + 1;
      const lock = failures >= LOGIN_MAX_FAILURES ? new Date(Date.now()+LOGIN_LOCK_MS).toISOString() : null;
      await env.CENTRAL_DB.prepare("UPDATE user_credentials SET failed_attempts=?,locked_until=?,updated_at=? WHERE user_id=?").bind(failures,lock,new Date().toISOString(),user.user_id).run();
      await recordSecurityEvent(env,user.user_id,"login",false);
      return generic;
    }
    if (user.status !== "active" || !user.email_verified_at) return json({ok:false,error:"email verification required"},403);
    const now = new Date().toISOString();
    const session = await createSession(env,user.user_id);
    await env.CENTRAL_DB.prepare("UPDATE user_credentials SET failed_attempts=0,locked_until=NULL,updated_at=? WHERE user_id=?").bind(now,user.user_id).run();
    await env.CENTRAL_DB.prepare("UPDATE users SET last_login_at=?,updated_at=? WHERE user_id=?").bind(now,now,user.user_id).run();
    await recordSecurityEvent(env,user.user_id,"login",true);
    return new Response(JSON.stringify({ok:true,user:{user_id:user.user_id,email:user.email_display,email_verified:true},expires_at:session.expires}),{
      status:200,
      headers:{
        "content-type":"application/json","cache-control":"no-store",
        "Set-Cookie":sessionCookie(session.cookie,Math.floor(SESSION_TTL_MS/1000)),
      },
    });
  }

  if (path === "/api/auth/logout" && request.method === "POST") {
    const sessionResult = await requireSession(env,request);
    if (sessionResult.response) return sessionResult.response;
    if (!await requireCsrf(request)) return json({ok:false,error:"csrf rejected"},403);
    await env.CENTRAL_DB.prepare("UPDATE user_sessions SET revoked_at=? WHERE session_id=?").bind(new Date().toISOString(),sessionResult.session.session_id).run();
    await recordSecurityEvent(env,sessionResult.session.user_id,"logout",true);
    return new Response(JSON.stringify({ok:true}),{status:200,headers:{"content-type":"application/json","cache-control":"no-store","Set-Cookie":clearSessionCookie()}});
  }

  if (path === "/api/auth/me" && request.method === "GET") {
    const sessionResult = await requireSession(env,request);
    if (sessionResult.response) return sessionResult.response;
    return json({ok:true,user:{user_id:sessionResult.session.user_id,email:sessionResult.session.email_display,email_verified:!!sessionResult.session.email_verified_at}});
  }

  if (path === "/api/auth/forgot-password" && request.method === "POST") {
    const body = await readJson(request);
    const email = normalizeEmail(body?.email);
    const user = validEmail(email)
      ? await env.CENTRAL_DB.prepare("SELECT user_id,email_display,status FROM users WHERE email_normalized=? LIMIT 1").bind(email).first()
      : null;
    if (user && user.status !== "disabled") {
      await issuePasswordReset(env,user);
      await recordSecurityEvent(env,user.user_id,"password_reset_requested",true);
    }
    return json({ok:true,message:"If that account exists, a password reset email will be sent."});
  }

  if (path === "/api/auth/reset-password" && request.method === "POST") {
    const body = await readJson(request);
    const token = String(body?.token || "");
    const password = body?.password;
    if (!token || typeof password !== "string" || password.length < PASSWORD_MIN_LENGTH || password.length > 1024) {
      return json({ok:false,error:"invalid reset data"},400);
    }
    const tokenHash = await authSha256(token);
    const row = await env.CENTRAL_DB.prepare("SELECT token_hash,user_id,expires_at,used_at FROM password_reset_tokens WHERE token_hash=? LIMIT 1").bind(tokenHash).first();
    if (!row || row.used_at || new Date(row.expires_at).getTime() <= Date.now()) return json({ok:false,error:"invalid or expired reset token"},400);
    const now = new Date().toISOString();
    const passwordHash = await hashPassword(password);
    await env.CENTRAL_DB.batch([
      env.CENTRAL_DB.prepare("UPDATE user_credentials SET password_hash=?,password_changed_at=?,failed_attempts=0,locked_until=NULL,updated_at=? WHERE user_id=?").bind(passwordHash,now,now,row.user_id),
      env.CENTRAL_DB.prepare("UPDATE password_reset_tokens SET used_at=? WHERE token_hash=?").bind(now,tokenHash),
      env.CENTRAL_DB.prepare("UPDATE user_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL").bind(now,row.user_id),
    ]);
    await recordSecurityEvent(env,row.user_id,"password_reset_completed",true);
    return json({ok:true,message:"Password reset. Please log in again."});
  }

  if (path === "/api/auth/resend-verification" && request.method === "POST") {
    const body = await readJson(request);
    const email = normalizeEmail(body?.email);
    const user = validEmail(email)
      ? await env.CENTRAL_DB.prepare("SELECT user_id,email_display,status,email_verified_at FROM users WHERE email_normalized=? LIMIT 1").bind(email).first()
      : null;
    if (user && user.status !== "disabled" && !user.email_verified_at && env.EMAIL && env.AUTH_EMAIL_FROM && env.AUTH_BASE_URL) {
      await issueVerification(env,user);
    }
    return json({ok:true,message:"If the account is eligible, a verification email will be sent."});
  }

  return json({ok:false,error:"not found"},404);
}

export {
  authRoutes,
  hashPassword,
  verifyPassword,
  normalizeEmail,
  requireSession,
  requireCsrf,
  createSession,
};

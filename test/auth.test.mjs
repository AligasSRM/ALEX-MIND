import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestHarness } from "wrangler";
import { hashPassword, verifyPassword } from "../auth.js";

const server = createTestHarness({
  workers: [{
    configPath: "./wrangler.jsonc",
    secrets: { B2_APP_KEY: "test-app-key", CONTROL_ACTION_KEY: "test-control-key" },
  }],
});

const email = "phase26@example.test";
const password = "Correct Horse Battery Staple 2026!";

function cookiePair(setCookie) {
  return String(setCookie || "").split(";")[0];
}

before(async () => {
  await server.listen();
  const worker = server.getWorker();
  await worker.applyD1Migrations("CENTRAL_DB");
  const env = await worker.getEnv();
  const now = new Date().toISOString();
  const userId = "usr-phase26-test";
  const passwordHash = await hashPassword(password);
  await env.CENTRAL_DB.batch([
    env.CENTRAL_DB.prepare("INSERT INTO users (user_id,email_normalized,email_display,email_verified_at,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
      .bind(userId,email,email,now,"active",now,now),
    env.CENTRAL_DB.prepare("INSERT INTO user_credentials (user_id,password_hash,password_changed_at,created_at,updated_at) VALUES (?,?,?,?,?)")
      .bind(userId,passwordHash,now,now,now),
  ]);
});

after(async () => { await server.close(); });

test("Phase 26 password hashing is salted and verifiable", async () => {
  const first = await hashPassword(password);
  const second = await hashPassword(password);
  assert.notEqual(first, second);
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword("wrong password 2026!", first), false);
  assert.match(first, /^pbkdf2-sha256\$600000\$/);
});

test("Phase 26 unauthenticated /me is denied", async () => {
  const response = await server.fetch("https://alex-mind.test/api/auth/me");
  if (response.status === 500) server.debug();
  assert.equal(response.status, 401);
});

test("Phase 26 login creates a server-side session and /me resolves the user", async () => {
  const csrf = await server.fetch("https://alex-mind.test/api/auth/csrf");
  assert.equal(csrf.status, 200);
  const csrfBody = await csrf.json();
  const csrfCookie = cookiePair(csrf.headers.get("set-cookie"));
  assert.ok(csrfBody.csrf_token);
  assert.ok(csrfCookie);

  const login = await server.fetch("https://alex-mind.test/api/auth/login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "origin": "https://alex-mind.test",
      "cookie": csrfCookie,
    },
    body: JSON.stringify({ email, password }),
  });
  const loginBody = await login.json();
  assert.equal(login.status, 200);
  assert.equal(loginBody.ok, true);
  assert.ok(login.headers.get("set-cookie"));

  const sessionCookie = cookiePair(login.headers.get("set-cookie"));
  const me = await server.fetch("https://alex-mind.test/api/auth/me", {
    headers: { cookie: sessionCookie },
  });
  const meBody = await me.json();
  assert.equal(me.status, 200);
  assert.equal(meBody.user.email, email);
  assert.equal(meBody.user.email_verified, true);
});

test("Phase 26 logout revokes the server-side session", async () => {
  const csrf = await server.fetch("https://alex-mind.test/api/auth/csrf");
  const csrfBody = await csrf.json();
  const csrfCookie = cookiePair(csrf.headers.get("set-cookie"));
  const login = await server.fetch("https://alex-mind.test/api/auth/login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "origin": "https://alex-mind.test",
      "cookie": csrfCookie,
    },
    body: JSON.stringify({ email, password }),
  });
  const sessionCookie = cookiePair(login.headers.get("set-cookie"));
  const logout = await server.fetch("https://alex-mind.test/api/auth/logout", {
    method: "POST",
    headers: {
      "origin": "https://alex-mind.test",
      "cookie": csrfCookie + "; " + sessionCookie,
      "x-csrf-token": csrfBody.csrf_token,
    },
  });
  assert.equal(logout.status, 200);
  const me = await server.fetch("https://alex-mind.test/api/auth/me", {
    headers: { cookie: sessionCookie },
  });
  assert.equal(me.status, 401);
});

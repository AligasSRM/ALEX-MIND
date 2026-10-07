import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestHarness } from "wrangler";

const server = createTestHarness({
  workers: [{ configPath: "./wrangler.jsonc", secrets: { B2_APP_KEY: "test-app-key" } }]
});

before(async () => { await server.listen(); });
after(async () => { await server.close(); });

for (const path of ["/control/status", "/control/check"]) {
  test("ALEX-MIND " + path + " is GREEN", async () => {
    const response = await server.fetch("https://alex-mind.test" + path);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.status, "GREEN");
    assert.equal(body.read_only, true);
  });
}
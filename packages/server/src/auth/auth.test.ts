import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

test("migrates legacy api-token to token", async () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-auth-home-"));
  const previousHome = process.env.HOME;
  process.env.HOME = tempHome;

  try {
    const maestroDir = path.join(tempHome, ".maestro");
    const legacyTokenPath = path.join(maestroDir, "api-token");
    const tokenPath = path.join(maestroDir, "token");
    fs.mkdirSync(maestroDir, { recursive: true });
    fs.writeFileSync(legacyTokenPath, "sym_legacy");

    const { initAuth, getApiToken } = await import(`./auth.js?test=${Date.now()}`);
    const { apiToken } = initAuth();

    assert.equal(apiToken, "sym_legacy");
    assert.equal(getApiToken(), "sym_legacy");
    assert.ok(fs.existsSync(tokenPath));
    assert.ok(!fs.existsSync(legacyTokenPath));
    assert.equal(fs.readFileSync(tokenPath, "utf8"), "sym_legacy");
  } finally {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
  }
});

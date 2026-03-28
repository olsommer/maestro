import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

function writeHostsConfigGhBinary(binDir: string): void {
  const scriptPath = path.join(binDir, "gh");
  fs.writeFileSync(
    scriptPath,
    `#!/bin/sh
if [ "$1" = "--version" ]; then
  printf '%s\\n' 'gh version test'
  exit 0
fi

if [ "$1" = "auth" ] && [ "$2" = "status" ]; then
  printf '%s\\n' 'unsupported output format'
  exit 0
fi

if [ "$1" = "api" ] && [ "$2" = "-i" ] && [ "$3" = "user" ]; then
  printf 'HTTP/1.1 200 OK\\nx-oauth-scopes: %s\\n\\n%s\\n' "$MAESTRO_TEST_GH_SCOPES" "$MAESTRO_TEST_GH_USER"
  exit 0
fi

printf 'unexpected gh invocation: %s\\n' "$*" >&2
exit 1
`,
    { mode: 0o755 }
  );
}

test("GitHub hosts config is used when gh auth status is unavailable or unparsable", async () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-github-home-"));
  const fakeBinDir = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-github-bin-"));
  const previousHome = process.env.HOME;
  const previousPath = process.env.PATH;
  const previousGhToken = process.env.GH_TOKEN;
  const previousGithubToken = process.env.GITHUB_TOKEN;
  const previousScopes = process.env.MAESTRO_TEST_GH_SCOPES;
  const previousUser = process.env.MAESTRO_TEST_GH_USER;

  writeHostsConfigGhBinary(fakeBinDir);
  fs.mkdirSync(path.join(tempHome, ".config", "gh"), { recursive: true });
  fs.writeFileSync(
    path.join(tempHome, ".config", "gh", "hosts.yml"),
    `github.com:
    users:
        config-user:
            oauth_token: token-from-config
    git_protocol: https
    oauth_token: token-from-config
    user: config-user
`
  );

  process.env.HOME = tempHome;
  process.env.PATH = `${fakeBinDir}:${previousPath ?? ""}`;
  delete process.env.GH_TOKEN;
  delete process.env.GITHUB_TOKEN;
  process.env.MAESTRO_TEST_GH_SCOPES = "repo, workflow";
  process.env.MAESTRO_TEST_GH_USER = JSON.stringify({
    login: "config-user",
    name: "Config User",
    avatar_url: "https://example.com/config.png",
  });

  try {
    const githubModule = await import(`./github.js?hosts-config-test=${Date.now()}`);
    const runtimeStatusModule = await import(
      `../runtime/runtime-status.js?hosts-config-test=${Date.now()}`
    );

    const status = await githubModule.getGitHubConnectionStatus();
    assert.equal(status.connected, true);
    assert.equal(status.source, "gh");
    assert.equal(status.login, "config-user");
    assert.equal(status.name, "Config User");
    assert.deepEqual(status.scopes, ["repo", "workflow"]);

    const runtimeStatus = runtimeStatusModule.getRuntimeStatus();
    assert.equal(runtimeStatus.github.authConfigured, true);
  } finally {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }

    if (previousPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = previousPath;
    }

    if (previousGhToken === undefined) {
      delete process.env.GH_TOKEN;
    } else {
      process.env.GH_TOKEN = previousGhToken;
    }

    if (previousGithubToken === undefined) {
      delete process.env.GITHUB_TOKEN;
    } else {
      process.env.GITHUB_TOKEN = previousGithubToken;
    }

    if (previousScopes === undefined) {
      delete process.env.MAESTRO_TEST_GH_SCOPES;
    } else {
      process.env.MAESTRO_TEST_GH_SCOPES = previousScopes;
    }

    if (previousUser === undefined) {
      delete process.env.MAESTRO_TEST_GH_USER;
    } else {
      process.env.MAESTRO_TEST_GH_USER = previousUser;
    }
  }
});

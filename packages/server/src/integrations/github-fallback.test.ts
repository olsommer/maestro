import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

function writeFallbackGhBinary(binDir: string): void {
  const scriptPath = path.join(binDir, "gh");
  fs.writeFileSync(
    scriptPath,
    `#!/bin/sh
if [ "$1" = "auth" ] && [ "$2" = "status" ] && [ "$3" = "--hostname" ] && [ "$4" = "github.com" ] && [ "$5" = "--active" ] && [ "$6" = "--json" ] && [ "$7" = "hosts" ]; then
  printf '%s\n' 'unknown flag: --json' >&2
  exit 1
fi

if [ "$1" = "auth" ] && [ "$2" = "status" ] && [ "$3" = "--hostname" ] && [ "$4" = "github.com" ]; then
  printf '%s\n' "$MAESTRO_TEST_GH_AUTH_STATUS_TEXT"
  exit 0
fi

if [ "$1" = "api" ] && [ "$2" = "-i" ] && [ "$3" = "user" ]; then
  printf 'HTTP/1.1 200 OK\nx-oauth-scopes: %s\n\n%s\n' "$MAESTRO_TEST_GH_SCOPES" "$MAESTRO_TEST_GH_USER"
  exit 0
fi

printf 'unexpected gh invocation: %s\n' "$*" >&2
exit 1
`,
    { mode: 0o755 }
  );
}

test("plain-text gh auth status fallback is surfaced as a connected integration", async () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-github-home-"));
  const fakeBinDir = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-github-bin-"));
  const previousHome = process.env.HOME;
  const previousPath = process.env.PATH;
  const previousGhToken = process.env.GH_TOKEN;
  const previousGithubToken = process.env.GITHUB_TOKEN;
  const previousAuthStatusText = process.env.MAESTRO_TEST_GH_AUTH_STATUS_TEXT;
  const previousScopes = process.env.MAESTRO_TEST_GH_SCOPES;
  const previousUser = process.env.MAESTRO_TEST_GH_USER;

  writeFallbackGhBinary(fakeBinDir);
  process.env.HOME = tempHome;
  process.env.PATH = `${fakeBinDir}:${previousPath ?? ""}`;
  delete process.env.GH_TOKEN;
  delete process.env.GITHUB_TOKEN;
  process.env.MAESTRO_TEST_GH_AUTH_STATUS_TEXT = `github.com
  ✓ Logged in to github.com account cli-fallback (/tmp/hosts.yml)
  - Active account: true
  - Git operations protocol: https
  - Token scopes: 'repo', 'read:org', 'gist'`;
  process.env.MAESTRO_TEST_GH_SCOPES = "repo, read:org, gist";
  process.env.MAESTRO_TEST_GH_USER = JSON.stringify({
    login: "cli-fallback",
    name: "CLI Fallback",
    avatar_url: "https://example.com/fallback.png",
  });

  try {
    const githubModule = await import(`./github.js?fallback-test=${Date.now()}`);
    const status = await githubModule.getGitHubConnectionStatus();

    assert.equal(status.connected, true);
    assert.equal(status.source, "gh");
    assert.equal(status.login, "cli-fallback");
    assert.deepEqual(status.scopes, ["repo", "read:org", "gist"]);
    assert.equal(status.name, "CLI Fallback");
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

    if (previousAuthStatusText === undefined) {
      delete process.env.MAESTRO_TEST_GH_AUTH_STATUS_TEXT;
    } else {
      process.env.MAESTRO_TEST_GH_AUTH_STATUS_TEXT = previousAuthStatusText;
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

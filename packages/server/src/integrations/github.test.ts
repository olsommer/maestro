import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

function writeFakeGhBinary(binDir: string): void {
  const scriptPath = path.join(binDir, "gh");
  fs.writeFileSync(
    scriptPath,
    `#!/bin/sh
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then
  printf '%s\\n' "$MAESTRO_TEST_GH_AUTH_STATUS"
  exit 0
fi

if [ "$1" = "api" ] && [ "$2" = "-i" ]; then
  case "$3" in
    user)
      printf 'HTTP/1.1 200 OK\\nx-oauth-scopes: %s\\n\\n%s\\n' "$MAESTRO_TEST_GH_SCOPES" "$MAESTRO_TEST_GH_USER"
      exit 0
      ;;
    user/repos*)
      printf 'HTTP/1.1 200 OK\\n\\n%s\\n' "$MAESTRO_TEST_GH_REPOS"
      exit 0
      ;;
  esac
fi

printf 'unexpected gh invocation: %s\\n' "$*" >&2
exit 1
`,
    { mode: 0o755 }
  );
}

test("GitHub CLI auth is surfaced as a connected integration and repo search works without a stored token", async () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-github-home-"));
  const fakeBinDir = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-github-bin-"));
  const previousHome = process.env.HOME;
  const previousPath = process.env.PATH;
  const previousGhToken = process.env.GH_TOKEN;
  const previousGithubToken = process.env.GITHUB_TOKEN;
  const previousAuthStatus = process.env.MAESTRO_TEST_GH_AUTH_STATUS;
  const previousScopes = process.env.MAESTRO_TEST_GH_SCOPES;
  const previousUser = process.env.MAESTRO_TEST_GH_USER;
  const previousRepos = process.env.MAESTRO_TEST_GH_REPOS;

  writeFakeGhBinary(fakeBinDir);
  process.env.HOME = tempHome;
  process.env.PATH = `${fakeBinDir}:${previousPath ?? ""}`;
  delete process.env.GH_TOKEN;
  delete process.env.GITHUB_TOKEN;
  process.env.MAESTRO_TEST_GH_AUTH_STATUS = JSON.stringify({
    hosts: {
      "github.com": [
        {
          state: "success",
          active: true,
          login: "cli-user",
          scopes: "gist, read:org, repo",
        },
      ],
    },
  });
  process.env.MAESTRO_TEST_GH_SCOPES = "gist, read:org, repo";
  process.env.MAESTRO_TEST_GH_USER = JSON.stringify({
    login: "cli-user",
    name: "CLI User",
    avatar_url: "https://example.com/avatar.png",
  });
  process.env.MAESTRO_TEST_GH_REPOS = JSON.stringify([
    {
      id: 1,
      name: "cli-repo",
      full_name: "cli-user/cli-repo",
      private: true,
      default_branch: "main",
      clone_url: "https://github.com/cli-user/cli-repo.git",
      html_url: "https://github.com/cli-user/cli-repo",
      owner: { login: "cli-user" },
    },
  ]);

  try {
    const githubModule = await import(`./github.js?test=${Date.now()}`);
    const runtimeStatusModule = await import(
      `../runtime/runtime-status.js?test=${Date.now()}`
    );

    const status = await githubModule.getGitHubConnectionStatus();
    assert.deepEqual(status, {
      connected: true,
      source: "gh",
      canDisconnect: false,
      login: "cli-user",
      name: "CLI User",
      avatarUrl: "https://example.com/avatar.png",
      scopes: ["gist", "read:org", "repo"],
      connectedAt: null,
      verifiedAt: status.verifiedAt,
    });
    assert.ok(status.verifiedAt);

    const repos = await githubModule.searchGitHubRepositories("cli-repo");
    assert.deepEqual(repos, [
      {
        id: 1,
        name: "cli-repo",
        fullName: "cli-user/cli-repo",
        owner: "cli-user",
        private: true,
        defaultBranch: "main",
        cloneUrl: "https://github.com/cli-user/cli-repo.git",
        htmlUrl: "https://github.com/cli-user/cli-repo",
      },
    ]);

    const runtimeStatus = runtimeStatusModule.getRuntimeStatus();
    assert.equal(runtimeStatus.github.authConfigured, true);
    assert.equal(runtimeStatus.github.needsAuthWarning, false);
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

    if (previousAuthStatus === undefined) {
      delete process.env.MAESTRO_TEST_GH_AUTH_STATUS;
    } else {
      process.env.MAESTRO_TEST_GH_AUTH_STATUS = previousAuthStatus;
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

    if (previousRepos === undefined) {
      delete process.env.MAESTRO_TEST_GH_REPOS;
    } else {
      process.env.MAESTRO_TEST_GH_REPOS = previousRepos;
    }
  }
});

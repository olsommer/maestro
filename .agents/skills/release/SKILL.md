---
name: release
description: Handles Maestro CLI releases from the current working branch. Use when asked to release, bump the CLI patch version, prepare a bump PR or MR, commit and push the change, create a GitHub PR with gh, wait for GitHub Actions, fix release issues when possible, and merge to main once everything is green.
user-invocable: true
---

# Release

Use this skill for Maestro CLI releases only.

The release source of truth is `packages/cli/package.json`. The GitHub release workflow reads that file, tags releases as `maestro-cli-v<version>`, and publishes on pushes to `main`.

## Preconditions

Before doing anything:

1. Confirm the git worktree is clean. If not, stop.
2. Confirm `gh` is available and authenticated. Prefer `gh` for PRs, checks, runs, and merge operations.
3. Release from the current branch. Do not create a separate release branch unless the user explicitly asks.

## Version Bump

For now, releases are patch-only.

1. Read the current version from `packages/cli/package.json`.
2. Bump `0.1.X` to `0.1.(X+1)` by editing `packages/cli/package.json`.
3. Do not invent extra version files unless the repo already requires them.

## Commit And Push

1. Review the diff to ensure only intended release changes are included.
2. Commit with git using a clear release message such as `release: bump cli to v0.1.X`.
3. Push the current branch to `origin`.

## Pull Request

1. Create a PR targeting `main` with `gh pr create`.
2. Use a clear title such as `release: v0.1.X`.
3. Include a short body that states this bumps the CLI package version for release.

## Checks And Release Validation

After creating or updating the PR:

1. Wait for GitHub Actions to complete.
2. Prefer `gh pr checks --watch`.
3. If deeper inspection is needed, use `gh run list`, `gh run view`, and `gh run view --log-failed`.

The current release workflow is `.github/workflows/release-cli.yml` and it publishes the CLI package from `main` after reading `packages/cli/package.json`.

## Failure Handling

If checks fail:

1. Inspect the failing job and logs with `gh`.
2. Determine whether the failure is code-related, test-related, workflow-related, or a repo-configuration blocker.
3. If it is a normal code or workflow issue, fix it locally, rerun relevant verification, commit, and push.
4. Wait for checks again and repeat until green.
5. If blocked by secrets, permissions, missing GitHub access, or another external constraint, stop and report the blocker clearly.

Do not stop at the first failed run if the issue is fixable in the repo.

## Merge

When the PR is green:

1. Merge it into `main` with `gh pr merge --squash`.
2. Confirm the merge completed successfully.
3. Stop once the PR is merged and GitHub is green.

## Verification Commands

Use the minimum set needed for confidence. Common commands:

```bash
git status --short
git diff -- packages/cli/package.json
pnpm --filter @isarai/maestro typecheck
gh pr checks --watch
gh run list --branch "$(git branch --show-current)"
```

## Boundaries

- Keep the release focused on the CLI package unless the repo changes require more.
- Prefer `gh` and `git` over manual browser steps.
- Do not merge while checks are failing or pending.
- Do not proceed with a dirty worktree.

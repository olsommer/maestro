import test from "node:test";
import assert from "node:assert/strict";
import { collectGitHubMentionSourceItems } from "./automation-runner.js";

test("collectGitHubMentionSourceItems includes self-authored issue and comment mentions", () => {
  const items = collectGitHubMentionSourceItems({
    repoFullName: "olsommer/maestro",
    issues: [
      {
        number: 103,
        title: "Mention in issue body",
        body: "@maestro please handle this",
        html_url: "https://github.com/olsommer/maestro/issues/103",
        updated_at: "2026-03-30T09:44:25Z",
        user: { login: "olsommer" },
        labels: [],
      },
    ],
    comments: [
      {
        id: 9001,
        body: '@maestro this is just a test. answer with "hello".',
        html_url: "https://github.com/olsommer/maestro/issues/103#issuecomment-9001",
        issue_url: "https://api.github.com/repos/olsommer/maestro/issues/103",
        created_at: "2026-03-30T09:45:16Z",
        updated_at: "2026-03-30T09:45:16Z",
        user: { login: "olsommer" },
      },
    ],
  });

  assert.equal(items.length, 2);

  assert.deepEqual(
    items.map((item) => ({
      triggerType: item.triggerType,
      triggerAuthor: item.triggerAuthor,
      issueNumber: item.issueNumber,
      body: item.body,
    })),
    [
      {
        triggerType: "issue_body",
        triggerAuthor: "olsommer",
        issueNumber: "103",
        body: "@maestro please handle this",
      },
      {
        triggerType: "comment",
        triggerAuthor: "olsommer",
        issueNumber: "103",
        body: '@maestro this is just a test. answer with "hello".',
      },
    ]
  );
});

test("collectGitHubMentionSourceItems ignores non-mentions", () => {
  const items = collectGitHubMentionSourceItems({
    repoFullName: "olsommer/maestro",
    issues: [
      {
        number: 104,
        title: "No mention",
        body: "plain text",
        html_url: "https://github.com/olsommer/maestro/issues/104",
        updated_at: "2026-03-30T10:00:00Z",
        user: { login: "someone" },
        labels: [],
      },
    ],
    comments: [
      {
        id: 9002,
        body: "also plain text",
        html_url: "https://github.com/olsommer/maestro/issues/104#issuecomment-9002",
        issue_url: "https://api.github.com/repos/olsommer/maestro/issues/104",
        created_at: "2026-03-30T10:01:00Z",
        updated_at: "2026-03-30T10:01:00Z",
        user: { login: "someone" },
      },
    ],
  });

  assert.deepEqual(items, []);
});

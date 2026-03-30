import test from "node:test";
import assert from "node:assert/strict";
import {
  buildGitHubMentionCompletionComment,
  buildGitHubMentionPromptFields,
  collectGitHubMentionSourceItems,
  extractStructuredAutomationResult,
} from "./automation-runner.js";

test("collectGitHubMentionSourceItems includes self-authored issue and comment mentions", () => {
  const items = collectGitHubMentionSourceItems({
    repoFullName: "olsommer/maestro",
    issues: [
      {
        number: 103,
        title: "Mention in issue body",
        body: "@maestro: please handle this",
        html_url: "https://github.com/olsommer/maestro/issues/103",
        updated_at: "2026-03-30T09:44:25Z",
        user: { login: "olsommer" },
        labels: [],
      },
    ],
    comments: [
      {
        id: 9001,
        body: '@maestro: this is just a test. answer with "hello".',
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
        body: "@maestro: please handle this",
      },
      {
        triggerType: "comment",
        triggerAuthor: "olsommer",
        issueNumber: "103",
        body: '@maestro: this is just a test. answer with "hello".',
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

test("collectGitHubMentionSourceItems ignores non-command maestro mentions", () => {
  const items = collectGitHubMentionSourceItems({
    repoFullName: "olsommer/maestro",
    issues: [
      {
        number: 105,
        title: "Body mention without command form",
        body: "Please ask @maestro to handle this",
        html_url: "https://github.com/olsommer/maestro/issues/105",
        updated_at: "2026-03-30T10:00:00Z",
        user: { login: "someone" },
        labels: [],
      },
      {
        number: 106,
        title: "Body mention without colon",
        body: "@maestro please handle this",
        html_url: "https://github.com/olsommer/maestro/issues/106",
        updated_at: "2026-03-30T10:01:00Z",
        user: { login: "someone" },
        labels: [],
      },
    ],
    comments: [
      {
        id: 9003,
        body: 'heads up: @maestro: this should not run',
        html_url: "https://github.com/olsommer/maestro/issues/105#issuecomment-9003",
        issue_url: "https://api.github.com/repos/olsommer/maestro/issues/105",
        created_at: "2026-03-30T10:02:00Z",
        updated_at: "2026-03-30T10:02:00Z",
        user: { login: "someone" },
      },
      {
        id: 9004,
        body: '@maestro this is just a test. answer with "hello".',
        html_url: "https://github.com/olsommer/maestro/issues/106#issuecomment-9004",
        issue_url: "https://api.github.com/repos/olsommer/maestro/issues/106",
        created_at: "2026-03-30T10:03:00Z",
        updated_at: "2026-03-30T10:03:00Z",
        user: { login: "someone" },
      },
    ],
  });

  assert.deepEqual(items, []);
});

test("buildGitHubMentionCompletionComment neutralizes maestro mentions in terminal output", () => {
  const comment = buildGitHubMentionCompletionComment({
    successful: false,
    triggerType: "comment",
    triggerAuthor: "olsommer",
    triggerUrl: "https://github.com/olsommer/maestro/issues/103#issuecomment-9001",
    resultText:
      "'codex' exec --yolo 'Review this GitHub thread where @maestro was mentioned'\n@maestro this is just a test.",
  });

  assert.match(comment, /@\u200Bmaestro/);
  assert.doesNotMatch(comment, /@maestro\b/);
});

test("buildGitHubMentionPromptFields uses the mention text as the prompt and prior comments as context", () => {
  const fields = buildGitHubMentionPromptFields({
    repoFullName: "olsommer/maestro",
    issue: {
      number: 103,
      title: "test",
      body: "issue body",
      html_url: "https://github.com/olsommer/maestro/issues/103",
      created_at: "2026-03-30T10:30:00Z",
      updated_at: "2026-03-30T10:30:00Z",
      user: { login: "olsommer" },
    },
    comments: [
      {
        id: 1,
        body: "first comment",
        html_url: "https://github.com/olsommer/maestro/issues/103#issuecomment-1",
        created_at: "2026-03-30T10:31:00Z",
        updated_at: "2026-03-30T10:31:00Z",
        user: { login: "alice" },
      },
      {
        id: 2,
        body: '@maestro: this is just a test. answer with "hello"',
        html_url: "https://github.com/olsommer/maestro/issues/103#issuecomment-2",
        created_at: "2026-03-30T10:32:00Z",
        updated_at: "2026-03-30T10:32:00Z",
        user: { login: "olsommer" },
      },
      {
        id: 3,
        body: "later comment",
        html_url: "https://github.com/olsommer/maestro/issues/103#issuecomment-3",
        created_at: "2026-03-30T10:33:00Z",
        updated_at: "2026-03-30T10:33:00Z",
        user: { login: "bob" },
      },
    ],
    triggerType: "comment",
    triggerBody: '@maestro: this is just a test. answer with "hello"',
    triggerUrl: "https://github.com/olsommer/maestro/issues/103#issuecomment-2",
    triggerAuthor: "olsommer",
  });

  assert.equal(fields.promptBody, 'this is just a test. answer with "hello"');
  assert.match(fields.promptContextBlock || "", /<context>/);
  assert.match(fields.promptContextBlock || "", /Issue body:\nissue body/);
  assert.match(fields.promptContextBlock || "", /Comment by alice/);
  assert.doesNotMatch(fields.promptContextBlock || "", /issuecomment-2/);
  assert.doesNotMatch(fields.promptContextBlock || "", /later comment/);
});

test("extractStructuredAutomationResult prefers completed agent messages from codex json output", () => {
  const result = extractStructuredAutomationResult([
    '{"type":"thread.started","thread_id":"abc"}',
    '{"type":"turn.started"}',
    '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"hello"}}',
    '{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}',
  ].join("\n"));

  assert.equal(result, "hello");
});

test("extractStructuredAutomationResult falls back to structured error messages", () => {
  const result = extractStructuredAutomationResult([
    '{"type":"thread.started","thread_id":"abc"}',
    '{"type":"error","message":"Reconnecting... 5/5"}',
    '{"type":"turn.failed","error":{"message":"unexpected status 401 Unauthorized"}}',
  ].join("\n"));

  assert.equal(result, "unexpected status 401 Unauthorized");
});

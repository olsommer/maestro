import test from "node:test";
import assert from "node:assert/strict";
import {
  buildKanbanIssueCompletionComment,
  extractTerminalTailForComment,
} from "./kanban.js";

test("extractTerminalTailForComment strips ANSI escapes and keeps the tail", () => {
  const transcript = [
    "first line",
    "\u001b[32msecond line\u001b[0m",
    "third line",
  ].join("\n");

  const result = extractTerminalTailForComment(transcript, 2, 200);

  assert.equal(result, "second line\nthird line");
});

test("buildKanbanIssueCompletionComment includes PR details and terminal output", () => {
  const result = buildKanbanIssueCompletionComment({
    successful: true,
    completionSummary: "PR #42 ready for review.",
    pullRequest: {
      number: 42,
      html_url: "https://github.com/example/repo/pull/42",
    },
    terminalTail: "pnpm test\nAll green",
  });

  assert.match(result, /Maestro finished work on this task\./);
  assert.match(result, /Status: PR #42 ready for review\./);
  assert.match(result, /Pull request: https:\/\/github.com\/example\/repo\/pull\/42/);
  assert.match(result, /```text\npnpm test\nAll green\n```/);
});

test("buildKanbanIssueCompletionComment omits the transcript block when empty", () => {
  const result = buildKanbanIssueCompletionComment({
    successful: false,
    completionSummary: "Terminal run failed. Task moved back to planned.",
    terminalTail: "",
  });

  assert.doesNotMatch(result, /Last terminal output:/);
  assert.match(result, /Status: Terminal run failed\. Task moved back to planned\./);
});

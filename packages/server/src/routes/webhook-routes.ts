import crypto from "crypto";
import type { FastifyInstance } from "fastify";
import type { Server as SocketServer } from "socket.io";
import {
  handleGitHubIssueWebhookEvent,
  handleGitHubPullRequestWebhookEvent,
  handleGitHubPullRequestReviewCommentWebhookEvent,
  handleGitHubPullRequestReviewWebhookEvent,
} from "../state/kanban.js";
import { findProjectRecordByGitHubRepo } from "../state/projects.js";

interface GitHubWebhookBody {
  action?: string;
  repository?: {
    name?: string;
    owner?: {
      login?: string;
    };
  };
  issue?: {
    number: number;
    pull_request?: unknown;
  };
  pull_request?: {
    number: number;
    html_url: string;
    body?: string | null;
    merged?: boolean;
  };
  review?: {
    state?: string | null;
    body?: string | null;
  };
}

function verifySignature(rawBody: Buffer, signature: string, secret: string): boolean {
  const expected = `sha256=${crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex")}`;

  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(signature);
  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}

export async function registerWebhookRoutes(app: FastifyInstance, io: SocketServer) {
  app.post("/api/webhooks/github", async (req, reply) => {
    const secret = process.env.GITHUB_WEBHOOK_SECRET?.trim();
    if (!secret) {
      return reply.status(503).send({
        error: "GITHUB_WEBHOOK_SECRET is not configured",
      });
    }

    const signature = req.headers["x-hub-signature-256"];
    if (typeof signature !== "string" || !req.rawBody) {
      return reply.status(401).send({ error: "Missing GitHub signature" });
    }

    if (!verifySignature(req.rawBody, signature, secret)) {
      return reply.status(401).send({ error: "Invalid GitHub signature" });
    }

    const event = req.headers["x-github-event"];
    if (event === "ping") {
      return { ok: true, event: "ping" };
    }

    const body = req.body as GitHubWebhookBody;
    const owner = body.repository?.owner?.login;
    const repo = body.repository?.name;
    if (!owner || !repo) {
      return { ok: true, ignored: true, reason: "Repository payload missing" };
    }

    const project = findProjectRecordByGitHubRepo(owner, repo);
    if (!project) {
      return { ok: true, ignored: true, reason: "No matching project" };
    }

    if (event === "issues" && body.issue && !body.issue.pull_request) {
      const result = handleGitHubIssueWebhookEvent(
        project.id,
        body.action ?? "",
        body.issue.number
      );
      io.emit("kanban:updated", { taskId: result.taskId });
      return { ok: true, handled: true, projectId: project.id, taskId: result.taskId };
    }

    if (event === "pull_request" && body.pull_request) {
      const result = handleGitHubPullRequestWebhookEvent(project.id, body.action ?? "", {
        number: body.pull_request.number,
        htmlUrl: body.pull_request.html_url,
        body: body.pull_request.body,
        merged: body.pull_request.merged,
      });

      if (result.taskId) {
        io.emit("kanban:updated", { taskId: result.taskId });
      }

      return {
        ok: true,
        handled: Boolean(result.taskId),
        projectId: project.id,
        taskId: result.taskId,
      };
    }

    if (event === "pull_request_review" && body.pull_request) {
      const result = await handleGitHubPullRequestReviewWebhookEvent(
        project.id,
        body.action ?? "",
        {
          state: body.review?.state,
        },
        {
          body: body.pull_request.body,
        }
      );

      if (result.taskId) {
        io.emit("kanban:updated", { taskId: result.taskId });
      }

      return {
        ok: true,
        handled: Boolean(result.taskId),
        projectId: project.id,
        taskId: result.taskId,
      };
    }

    if (event === "pull_request_review_comment" && body.pull_request) {
      const result = await handleGitHubPullRequestReviewCommentWebhookEvent(
        project.id,
        body.action ?? "",
        {
          body: body.pull_request.body,
        }
      );

      if (result.taskId) {
        io.emit("kanban:updated", { taskId: result.taskId });
      }

      return {
        ok: true,
        handled: Boolean(result.taskId),
        projectId: project.id,
        taskId: result.taskId,
      };
    }

    return { ok: true, ignored: true, reason: `Unhandled event: ${String(event ?? "unknown")}` };
  });
}

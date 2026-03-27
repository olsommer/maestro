import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import jwt from "jsonwebtoken";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { MAESTRO_DATA_DIR, ensureDataDir } from "../state/files.js";

const MAESTRO_DIR = MAESTRO_DATA_DIR;
const SECRET_PATH = path.join(MAESTRO_DIR, "jwt-secret");
const TOKEN_PATH = path.join(MAESTRO_DIR, "token");
const LEGACY_TOKEN_PATH = path.join(MAESTRO_DIR, "api-token");

let jwtSecret: string;

function resolveTokenPath(): string {
  if (fs.existsSync(TOKEN_PATH)) {
    return TOKEN_PATH;
  }

  if (fs.existsSync(LEGACY_TOKEN_PATH)) {
    fs.renameSync(LEGACY_TOKEN_PATH, TOKEN_PATH);
    console.log(`Migrated API token path from ${LEGACY_TOKEN_PATH} to ${TOKEN_PATH}`);
    return TOKEN_PATH;
  }

  return TOKEN_PATH;
}

/**
 * Initialize auth — generate or load JWT secret and initial API token.
 * Returns the API token for display on first run.
 */
export function initAuth(): { apiToken: string } {
  ensureDataDir();

  // JWT secret
  if (fs.existsSync(SECRET_PATH)) {
    jwtSecret = fs.readFileSync(SECRET_PATH, "utf-8").trim();
  } else {
    jwtSecret = crypto.randomBytes(48).toString("base64");
    fs.writeFileSync(SECRET_PATH, jwtSecret, { mode: 0o600 });
  }

  // API token (static bearer token for simple auth)
  let apiToken: string;
  const tokenPath = resolveTokenPath();
  if (fs.existsSync(tokenPath)) {
    apiToken = fs.readFileSync(tokenPath, "utf-8").trim();
  } else {
    apiToken = `sym_${crypto.randomBytes(32).toString("hex")}`;
    fs.writeFileSync(tokenPath, apiToken, { mode: 0o600 });
    console.log(`\nAPI token generated: ${apiToken}`);
    console.log(`Stored at: ${tokenPath}\n`);
  }

  return { apiToken };
}

/**
 * Create a short-lived JWT for WebSocket auth.
 */
export function createSessionToken(payload: {
  sub?: string;
  scope?: string;
}): string {
  return jwt.sign(payload, jwtSecret, { expiresIn: "24h" });
}

/**
 * Verify a JWT token.
 */
export function verifySessionToken(
  token: string
): { sub?: string; scope?: string } | null {
  try {
    return jwt.verify(token, jwtSecret) as { sub?: string; scope?: string };
  } catch {
    return null;
  }
}

/**
 * Get the stored API token.
 */
export function getApiToken(): string {
  const tokenPath = resolveTokenPath();
  if (fs.existsSync(tokenPath)) {
    return fs.readFileSync(tokenPath, "utf-8").trim();
  }
  return "";
}

/**
 * Fastify auth middleware — checks Bearer token or skips for health endpoint.
 */
export function registerAuthHook(app: FastifyInstance) {
  const apiToken = getApiToken();

  // Skip auth if no token exists (dev mode) or AUTH_DISABLED=1
  if (!apiToken || process.env.AUTH_DISABLED === "1") {
    console.log("Auth: disabled (no token or AUTH_DISABLED=1)");
    return;
  }

  app.addHook(
    "onRequest",
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Skip auth for health and token exchange endpoints
      const url = request.url;
      if (url === "/health" || url === "/api/auth/token" || url === "/api/webhooks/github") {
        return;
      }

      const authHeader = request.headers.authorization;
      if (!authHeader) {
        return reply.status(401).send({ error: "Missing authorization header" });
      }

      const [scheme, token] = authHeader.split(" ");

      if (scheme === "Bearer" && token === apiToken) {
        return; // Valid API token
      }

      if (scheme === "Bearer" && token) {
        // Try JWT
        const payload = verifySessionToken(token);
        if (payload) return;
      }

      return reply.status(401).send({ error: "Invalid token" });
    }
  );

  console.log("Auth: enabled (Bearer token required)");
}

/**
 * Auth routes — exchange API token for session JWT, get token info.
 */
export async function registerAuthRoutes(app: FastifyInstance) {
  // Exchange API token for a session JWT (useful for WebSocket auth)
  app.post("/api/auth/token", async (req, reply) => {
    const body = req.body as { apiToken?: string };
    const storedToken = getApiToken();

    if (!body.apiToken || body.apiToken !== storedToken) {
      return reply.status(401).send({ error: "Invalid API token" });
    }

    const sessionToken = createSessionToken({ scope: "full" });
    return { token: sessionToken, expiresIn: "24h" };
  });
}

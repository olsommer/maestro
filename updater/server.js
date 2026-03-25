import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const HOST = process.env.UPDATER_HOST || "127.0.0.1";
const PORT = Number(process.env.UPDATER_PORT || "4810");
const TOKEN = process.env.UPDATER_TOKEN || "";
const GITHUB_REPO = process.env.GITHUB_REPO || "";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || "";
const RELEASES_DIR = path.resolve(
  process.env.RELEASES_DIR || "/state/releases"
);
const CURRENT_LINK = path.resolve(
  process.env.CURRENT_LINK || "/state/current"
);
const COMPOSE_FILE = process.env.COMPOSE_FILE || "docker-compose.yml";
const COMPOSE_PROJECT_NAME = process.env.COMPOSE_PROJECT_NAME || "maestro";
const UPDATE_SERVICES = (process.env.UPDATE_SERVICES || "server")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const state = {
  updating: false,
  lastCheckedAt: null,
  lastUpdatedAt: null,
  lastError: null,
  latestRelease: null,
};
let composeCliPromise = null;

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(`${JSON.stringify(body)}\n`);
}

function isAuthorized(req) {
  if (!TOKEN) {
    return true;
  }
  return req.headers.authorization === `Bearer ${TOKEN}`;
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

function getCurrentVersion() {
  try {
    const target = fs.readlinkSync(CURRENT_LINK);
    return path.basename(target);
  } catch {
    return null;
  }
}

async function seedCurrentReleaseIfMissing(tag) {
  if (!tag || getCurrentVersion()) {
    return;
  }

  await ensureDir(path.dirname(CURRENT_LINK));
  const releaseDir = path.join(RELEASES_DIR, tag);
  const tempLink = path.join(
    path.dirname(CURRENT_LINK),
    `.current-seed-${process.pid}-${Date.now()}`
  );

  try {
    await fsp.symlink(releaseDir, tempLink);
    if (!getCurrentVersion()) {
      await fsp.rename(tempLink, CURRENT_LINK);
      return;
    }
  } finally {
    await fsp.rm(tempLink, { force: true }).catch(() => {});
  }
}

function getStatusPayload() {
  const latestVersion = state.latestRelease?.tag ?? null;
  const currentVersion = getCurrentVersion();
  return {
    configured: Boolean(GITHUB_REPO),
    currentVersion,
    latestVersion,
    updateAvailable:
      Boolean(currentVersion && latestVersion) && currentVersion !== latestVersion,
    updating: state.updating,
    lastCheckedAt: state.lastCheckedAt,
    lastUpdatedAt: state.lastUpdatedAt,
    lastError: state.lastError,
    latestRelease: state.latestRelease
      ? {
          tag: state.latestRelease.tag,
          name: state.latestRelease.name,
          url: state.latestRelease.url,
          publishedAt: state.latestRelease.publishedAt,
          notes: state.latestRelease.notes,
        }
      : null,
  };
}

async function githubRequest(endpoint) {
  if (!GITHUB_REPO) {
    throw new Error("GITHUB_REPO is required");
  }

  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "maestro-updater",
    ...(GITHUB_TOKEN ? { Authorization: `Bearer ${GITHUB_TOKEN}` } : {}),
  };
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}${endpoint}`, {
    headers,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `GitHub request failed (${res.status}): ${text.slice(0, 300) || "no response body"}`
    );
  }
  return res.json();
}

function archiveUrl(tag) {
  return `https://github.com/${GITHUB_REPO}/archive/refs/tags/${encodeURIComponent(tag)}.tar.gz`;
}

async function fetchLatestRelease() {
  let data;
  try {
    data = await githubRequest("/releases/latest");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("GitHub request failed (404)")) {
      throw new Error(`No GitHub releases found for ${GITHUB_REPO}`);
    }
    throw error;
  }
  return {
    tag: data.tag_name,
    name: data.name ?? null,
    url: data.html_url ?? null,
    publishedAt: data.published_at ?? null,
    notes: data.body ?? null,
    tarballUrl: archiveUrl(data.tag_name),
  };
}

async function fetchReleaseByTag(tag) {
  let data;
  try {
    data = await githubRequest(`/releases/tags/${encodeURIComponent(tag)}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("GitHub request failed (404)")) {
      throw new Error(`GitHub release ${tag} was not found for ${GITHUB_REPO}`);
    }
    throw error;
  }
  return {
    tag: data.tag_name,
    name: data.name ?? null,
    url: data.html_url ?? null,
    publishedAt: data.published_at ?? null,
    notes: data.body ?? null,
    tarballUrl: archiveUrl(data.tag_name),
  };
}

async function refreshLatestRelease() {
  try {
    state.latestRelease = await fetchLatestRelease();
    await seedCurrentReleaseIfMissing(state.latestRelease?.tag ?? null);
    state.lastCheckedAt = new Date().toISOString();
    if (!state.updating) {
      state.lastError = null;
    }
  } catch (error) {
    state.lastCheckedAt = new Date().toISOString();
    state.lastError = error instanceof Error ? error.message : String(error);
    throw error;
  }
}

async function ensureDir(dirPath) {
  await fsp.mkdir(dirPath, { recursive: true });
}

async function downloadReleaseTarball(release, destinationPath) {
  const headers = {
    "User-Agent": "maestro-updater",
    ...(GITHUB_TOKEN ? { Authorization: `Bearer ${GITHUB_TOKEN}` } : {}),
  };
  const res = await fetch(release.tarballUrl, { headers, redirect: "follow" });
  if (!res.ok || !res.body) {
    throw new Error(`Failed to download tarball for ${release.tag} (${res.status})`);
  }

  const output = fs.createWriteStream(destinationPath);
  await pipeline(Readable.fromWeb(res.body), output);
}

async function runCommand(command, args, cwd, extraEnv = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        ...extraEnv,
      },
    });

    let output = "";
    const append = (chunk) => {
      output = `${output}${chunk.toString("utf8")}`;
      if (output.length > 12000) {
        output = output.slice(-12000);
      }
    };

    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `${command} ${args.join(" ")} failed with exit code ${code}${
            output ? `\n${output.trim()}` : ""
          }`
        )
      );
    });
  });
}

async function ensureReleaseDownloaded(release) {
  await ensureDir(RELEASES_DIR);
  const targetDir = path.join(RELEASES_DIR, release.tag);
  if (fs.existsSync(targetDir)) {
    return targetDir;
  }

  const tempRoot = await fsp.mkdtemp(path.join(RELEASES_DIR, ".tmp-release-"));
  const tarballPath = path.join(tempRoot, `${release.tag}.tar.gz`);
  const extractDir = path.join(tempRoot, "extract");

  try {
    await ensureDir(extractDir);
    await downloadReleaseTarball(release, tarballPath);
    await runCommand("tar", ["-xzf", tarballPath, "-C", extractDir], tempRoot);

    const entries = await fsp.readdir(extractDir);
    if (entries.length !== 1) {
      throw new Error(`Unexpected tarball layout for ${release.tag}`);
    }

    const extractedDir = path.join(extractDir, entries[0]);
    await fsp.rename(extractedDir, targetDir);
    return targetDir;
  } finally {
    await fsp.rm(tempRoot, { recursive: true, force: true });
  }
}

async function resolveComposeCli() {
  if (!composeCliPromise) {
    composeCliPromise = (async () => {
      try {
        await runCommand("docker", ["compose", "version"], process.cwd());
        return { command: "docker", args: ["compose"] };
      } catch (dockerComposeError) {
        try {
          await runCommand("docker-compose", ["version"], process.cwd());
          return { command: "docker-compose", args: [] };
        } catch (dockerComposeLegacyError) {
          throw new Error(
            "No supported Docker Compose CLI was found. Tried `docker compose` and `docker-compose`." +
              " If this updater runs in Alpine, install the Compose plugin package (`docker-cli-compose`) in the image." +
              `\n${String(dockerComposeError)}` +
              `\n${String(dockerComposeLegacyError)}`
          );
        }
      }
    })();
  }

  return composeCliPromise;
}

async function runComposeCommand(composePath, commandArgs, cwd) {
  const composeCli = await resolveComposeCli();
  await runCommand(
    composeCli.command,
    [...composeCli.args, "-f", composePath, ...commandArgs],
    cwd,
    {
      COMPOSE_PROJECT_NAME,
    }
  );
}

async function buildRelease(releaseDir) {
  const composePath = path.join(releaseDir, COMPOSE_FILE);
  await runComposeCommand(composePath, ["build", ...UPDATE_SERVICES], releaseDir);
}

async function switchCurrentRelease(releaseDir) {
  await ensureDir(path.dirname(CURRENT_LINK));
  const tempLink = path.join(path.dirname(CURRENT_LINK), `.current-${process.pid}-${Date.now()}`);
  await fsp.symlink(releaseDir, tempLink);
  await fsp.rename(tempLink, CURRENT_LINK);
}

async function bringUpServices() {
  const composePath = path.join(CURRENT_LINK, COMPOSE_FILE);
  await runComposeCommand(
    composePath,
    ["up", "-d", ...UPDATE_SERVICES],
    path.dirname(composePath)
  );
}

async function performRedeploy(targetTag) {
  if (state.updating) {
    throw new Error("A redeploy is already in progress");
  }

  state.updating = true;
  state.lastError = null;

  try {
    const release = targetTag
      ? await fetchReleaseByTag(targetTag)
      : await fetchLatestRelease();
    state.latestRelease = release;
    state.lastCheckedAt = new Date().toISOString();

    const releaseDir = await ensureReleaseDownloaded(release);
    await buildRelease(releaseDir);
    await switchCurrentRelease(releaseDir);
    await bringUpServices();

    state.lastUpdatedAt = new Date().toISOString();
    state.lastError = null;
  } catch (error) {
    state.lastError = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    state.updating = false;
  }
}

function validateConfig() {
  if (!GITHUB_REPO) {
    throw new Error("GITHUB_REPO is required");
  }
}

const server = http.createServer(async (req, res) => {
  try {
    validateConfig();

    if (!isAuthorized(req)) {
      sendJson(res, 401, { error: "Unauthorized" });
      return;
    }

    if (req.method === "GET" && req.url === "/status") {
      try {
        await refreshLatestRelease();
      } catch {
        // Preserve the last known payload with the error surfaced in state.
      }
      sendJson(res, 200, getStatusPayload());
      return;
    }

    if (req.method === "POST" && req.url === "/check") {
      try {
        await refreshLatestRelease();
      } catch {
        // Preserve the last known payload with the error surfaced in state.
      }
      sendJson(res, 200, getStatusPayload());
      return;
    }

    if (req.method === "POST" && req.url === "/redeploy") {
      if (state.updating) {
        sendJson(res, 409, { error: "A redeploy is already in progress" });
        return;
      }

      const body = await readJsonBody(req);
      const release = body.tag
        ? await fetchReleaseByTag(String(body.tag))
        : await fetchLatestRelease();
      state.latestRelease = release;
      state.lastCheckedAt = new Date().toISOString();

      queueMicrotask(() => {
        void performRedeploy(release.tag).catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`[updater] Redeploy failed: ${message}`);
        });
      });

      sendJson(res, 202, {
        accepted: true,
        targetVersion: release.tag,
        message: `Redeploy started for ${release.tag}. Maestro may disconnect briefly while Docker rebuilds and restarts the service.`,
      });
      return;
    }

    sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(res, 500, { error: message });
  }
});

server.listen(PORT, HOST, async () => {
  await ensureDir(RELEASES_DIR);
  console.log(`[updater] Listening on http://${HOST}:${PORT}`);
  console.log(`[updater] Compose project: ${COMPOSE_PROJECT_NAME}`);
  console.log(`[updater] Releases dir: ${RELEASES_DIR}`);
  console.log(`[updater] Current link: ${CURRENT_LINK}`);
  console.log(`[updater] Update services: ${UPDATE_SERVICES.join(", ") || "(all services)"}`);
});

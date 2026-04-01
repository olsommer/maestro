import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";
import { getDockerPath, isDockerAvailable, ensureBuiltinDockerSandboxImage } from "../agents/sandbox.js";
import { getSettings, updateSettings } from "../state/settings.js";

const MAX_CUSTOM_DOCKERFILE_BYTES = 64 * 1024;

function inspectDockerImage(image: string): boolean {
  try {
    execFileSync(getDockerPath(), ["image", "inspect", image], {
      stdio: ["ignore", "ignore", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
}

function truncateBuildError(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 4000) {
    return trimmed;
  }
  return `${trimmed.slice(trimmed.length - 4000)}\n[truncated]`;
}

export function validateCustomSandboxDockerfile(dockerfile: string, builtinImage: string): string | null {
  const trimmed = dockerfile.trim();
  if (!trimmed) {
    return "Custom Dockerfile is empty.";
  }
  if (Buffer.byteLength(trimmed, "utf-8") > MAX_CUSTOM_DOCKERFILE_BYTES) {
    return "Custom Dockerfile is too large.";
  }
  if (!trimmed.includes(`FROM ${builtinImage}`)) {
    return `Custom Dockerfile must extend ${builtinImage}.`;
  }
  return null;
}

export function resolveActiveSandboxDockerImage(): string {
  const settings = getSettings();
  const sandboxImage = settings.sandboxImage;

  if (sandboxImage.mode === "builtin") {
    return ensureBuiltinDockerSandboxImage(sandboxImage.builtinImage);
  }

  if (!isDockerAvailable()) {
    throw new Error("docker is not available");
  }

  const validationError = validateCustomSandboxDockerfile(
    sandboxImage.customDockerfile,
    sandboxImage.builtinImage
  );
  if (validationError) {
    throw new Error(validationError);
  }

  if (sandboxImage.customBuildStatus !== "ready") {
    throw new Error(
      "Custom sandbox image is selected but has not been built successfully."
    );
  }

  if (!inspectDockerImage(sandboxImage.customImageTag)) {
    throw new Error(
      "Custom sandbox image is selected but the built image is missing. Rebuild it in Settings."
    );
  }

  return sandboxImage.customImageTag;
}

export function buildConfiguredCustomSandboxImage() {
  const settings = getSettings();
  const sandboxImage = settings.sandboxImage;

  if (sandboxImage.mode !== "dockerfile") {
    throw new Error("Custom Dockerfile mode is not enabled.");
  }

  if (!isDockerAvailable()) {
    throw new Error("docker is not available");
  }

  const validationError = validateCustomSandboxDockerfile(
    sandboxImage.customDockerfile,
    sandboxImage.builtinImage
  );
  if (validationError) {
    throw new Error(validationError);
  }

  updateSettings({
    sandboxImage: {
      ...sandboxImage,
      customBuildStatus: "building",
      customBuildError: null,
    },
  });

  ensureBuiltinDockerSandboxImage(sandboxImage.builtinImage);

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-sandbox-build-"));
  try {
    fs.writeFileSync(path.join(tempDir, "Dockerfile"), `${sandboxImage.customDockerfile.trim()}\n`);

    execFileSync(
      getDockerPath(),
      ["build", "-t", sandboxImage.customImageTag, tempDir],
      {
        stdio: ["ignore", "pipe", "pipe"],
        encoding: "utf-8",
        maxBuffer: 1024 * 1024 * 8,
      }
    );

    return updateSettings({
      sandboxImage: {
        ...getSettings().sandboxImage,
        customBuildStatus: "ready",
        customBuildError: null,
        customBuiltAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    const message =
      error instanceof Error && "stderr" in error && typeof error.stderr === "string"
        ? error.stderr
        : error instanceof Error
          ? error.message
          : "Failed to build custom sandbox image";

    return updateSettings({
      sandboxImage: {
        ...getSettings().sandboxImage,
        customBuildStatus: "error",
        customBuildError: truncateBuildError(message),
      },
    });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

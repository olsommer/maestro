import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "../..");
const distDir = path.join(packageRoot, "dist");
const assetsDir = path.join(packageRoot, "assets");
const cliPackageJson = JSON.parse(
  fs.readFileSync(path.join(packageRoot, "package.json"), "utf8")
);

const externals = Object.keys(cliPackageJson.dependencies ?? {});

fs.rmSync(distDir, { recursive: true, force: true });
fs.rmSync(assetsDir, { recursive: true, force: true });
fs.mkdirSync(distDir, { recursive: true });
fs.mkdirSync(path.join(assetsDir, "docker", "sandbox"), { recursive: true });
fs.mkdirSync(path.join(assetsDir, "docker", "dind"), { recursive: true });
fs.mkdirSync(path.join(assetsDir, "docker", "firecracker-rootfs"), { recursive: true });

await build({
  entryPoints: [path.join(packageRoot, "src", "index.ts")],
  outfile: path.join(distDir, "index.js"),
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  sourcemap: true,
});

await build({
  entryPoints: [path.join(repoRoot, "packages", "server", "src", "main.ts")],
  outfile: path.join(distDir, "server.js"),
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  sourcemap: true,
  external: externals,
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});

fs.copyFileSync(
  path.join(repoRoot, "docker", "sandbox", "Dockerfile"),
  path.join(assetsDir, "docker", "sandbox", "Dockerfile")
);
fs.copyFileSync(
  path.join(repoRoot, "docker", "dind", "Dockerfile"),
  path.join(assetsDir, "docker", "dind", "Dockerfile")
);
fs.copyFileSync(
  path.join(repoRoot, "packages", "server", "scripts", "setup.sh"),
  path.join(assetsDir, "setup.sh")
);
fs.chmodSync(path.join(assetsDir, "setup.sh"), 0o755);
fs.copyFileSync(
  path.join(repoRoot, "packages", "server", "scripts", "build-firecracker-rootfs.sh"),
  path.join(assetsDir, "build-firecracker-rootfs.sh")
);
fs.chmodSync(path.join(assetsDir, "build-firecracker-rootfs.sh"), 0o755);
fs.copyFileSync(
  path.join(repoRoot, "docker", "firecracker-rootfs", "Dockerfile"),
  path.join(assetsDir, "docker", "firecracker-rootfs", "Dockerfile")
);
fs.copyFileSync(
  path.join(repoRoot, "docker", "firecracker-rootfs", "maestro-guest-init.sh"),
  path.join(assetsDir, "docker", "firecracker-rootfs", "maestro-guest-init.sh")
);
fs.copyFileSync(
  path.join(repoRoot, "docker", "firecracker-rootfs", "maestro-login-shell.sh"),
  path.join(assetsDir, "docker", "firecracker-rootfs", "maestro-login-shell.sh")
);

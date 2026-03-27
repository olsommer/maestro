import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

test("default managed projects path migrates from ~/maestro-projects to ~/.maestro/projects", async () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-project-home-"));
  const previousHome = process.env.HOME;
  const legacyDir = path.join(tempHome, "maestro-projects");
  const newDir = path.join(tempHome, ".maestro", "projects");

  fs.mkdirSync(legacyDir, { recursive: true });
  fs.writeFileSync(path.join(legacyDir, "README.txt"), "legacy-project-root");
  process.env.HOME = tempHome;

  try {
    const { createProject } = await import(`./project-service.js?test=${Date.now()}`);

    const project = await createProject({
      name: "Migrated Project",
      localPath: "",
      repoUrl: "",
      defaultBranch: "",
      githubOwner: "",
      githubRepo: "",
      syncIssues: false,
    });

    assert.equal(project.localPath, path.join(newDir, "migrated-project"));
    assert.ok(fs.existsSync(newDir));
    assert.ok(!fs.existsSync(legacyDir));
    assert.equal(fs.readFileSync(path.join(newDir, "README.txt"), "utf8"), "legacy-project-root");
  } finally {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
  }
});

import { listAutomationRecords } from "../state/sqlite.js";
import { listProjectRecords } from "../state/projects.js";
import { hasGitHubAuth } from "../integrations/github.js";

export interface RuntimeStatus {
  github: {
    authConfigured: boolean;
    githubProjectCount: number;
    githubAutomationCount: number;
    featuresEnabled: boolean;
    needsAuthWarning: boolean;
    warningMessage: string | null;
  };
}

export function getRuntimeStatus(): RuntimeStatus {
  const githubProjectCount = listProjectRecords().filter(
    (project) => Boolean(project.githubOwner && project.githubRepo)
  ).length;
  const githubAutomationCount = listAutomationRecords().filter((automation) =>
    automation.sourceType === "github_issues" || automation.sourceType === "github_prs"
  ).length;
  const authConfigured = hasGitHubAuth();
  const featuresEnabled = githubProjectCount > 0 || githubAutomationCount > 0;
  const needsAuthWarning = featuresEnabled && !authConfigured;

  return {
    github: {
      authConfigured,
      githubProjectCount,
      githubAutomationCount,
      featuresEnabled,
      needsAuthWarning,
      warningMessage: needsAuthWarning
        ? "GitHub-backed projects or automations are configured, but GitHub CLI is not authenticated and GITHUB_TOKEN/GH_TOKEN is missing."
        : null,
    },
  };
}

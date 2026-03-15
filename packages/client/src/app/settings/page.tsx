"use client";

import { useCallback, useEffect, useState } from "react";
import { TriangleAlertIcon, RefreshCwIcon, DownloadIcon, LoaderIcon } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { api, type GitHubConnectionStatus, type Settings, type UpdateStatus } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function formatScopes(scopes: string[]) {
  if (scopes.length === 0) {
    return "Unknown";
  }
  return scopes.join(", ");
}

function sourceLabel(source: GitHubConnectionStatus["source"]): string {
  if (source === "stored") return "Settings";
  if (source === "env") return "Environment";
  return "Not connected";
}

function DetailRows({
  rows,
}: {
  rows: Array<{
    label: string;
    value: React.ReactNode;
    description?: React.ReactNode;
  }>;
}) {
  return (
    <FieldGroup>
      {rows.map((row, index) => (
        <div key={row.label} className="flex flex-col gap-3">
          <Field orientation="horizontal">
            <FieldLabel>{row.label}</FieldLabel>
            <FieldContent className="items-start sm:items-end">
              <div className="sm:text-right">{row.value}</div>
              {row.description && (
                <FieldDescription className="sm:text-right">
                  {row.description}
                </FieldDescription>
              )}
            </FieldContent>
          </Field>
          {index < rows.length - 1 && <FieldSeparator />}
        </div>
      ))}
    </FieldGroup>
  );
}

function SettingsView() {
  const token = useAuth((s) => s.token);
  const serverUrl = useAuth((s) => s.serverUrl);
  const [serverInfo, setServerInfo] = useState<{
    status: string;
    timestamp: string;
  } | null>(null);
  const [github, setGitHub] = useState<GitHubConnectionStatus | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [githubToken, setGitHubToken] = useState("");
  const [githubError, setGitHubError] = useState("");
  const [githubLoading, setGitHubLoading] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  // Auto-update state
  const [settings, setSettings] = useState<Settings | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [updatingClis, setUpdatingClis] = useState(false);

  const loadUpdateStatus = useCallback(async () => {
    try {
      const status = await api.getUpdateStatus();
      setUpdateStatus(status);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const s = await api.getSettings();
        setSettings(s);
      } catch {
        /* ignore */
      }
    };
    void loadSettings();
    void loadUpdateStatus();
  }, [loadUpdateStatus]);

  async function handleToggleAutoUpdate(enabled: boolean) {
    try {
      const updated = await api.updateSettings({ autoUpdateEnabled: enabled });
      setSettings(updated);
    } catch {
      /* ignore */
    }
  }

  async function handleIntervalChange(hours: string | null) {
    if (hours == null) return;
    try {
      const updated = await api.updateSettings({ autoUpdateIntervalHours: Number(hours) });
      setSettings(updated);
    } catch {
      /* ignore */
    }
  }

  async function handleCheckUpdates() {
    setChecking(true);
    try {
      const status = await api.checkForUpdates();
      setUpdateStatus(status);
    } catch {
      /* ignore */
    } finally {
      setChecking(false);
    }
  }

  async function handleUpdateNow() {
    setUpdatingClis(true);
    try {
      const result = await api.updateNow();
      setUpdateStatus(result.status);
    } catch {
      /* ignore */
    } finally {
      setUpdatingClis(false);
    }
  }

  useEffect(() => {
    fetch(`${serverUrl}/health`)
      .then((r) => r.json())
      .then(setServerInfo)
      .catch(() => setServerInfo(null));
  }, [serverUrl]);

  useEffect(() => {
    const loadGitHub = async () => {
      try {
        const { github: integration } = await api.getGitHubIntegration();
        setGitHub(integration);
      } catch {
        setGitHub(null);
      }
    };

    void loadGitHub();
    const handleStatusChanged = () => {
      void loadGitHub();
    };
    window.addEventListener("maestro:github-status-changed", handleStatusChanged);
    return () => {
      window.removeEventListener("maestro:github-status-changed", handleStatusChanged);
    };
  }, []);

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    if (!githubToken.trim()) {
      setGitHubError("GitHub token is required");
      return;
    }

    setGitHubLoading(true);
    setGitHubError("");
    try {
      const { github: integration } = await api.connectGitHub(githubToken.trim());
      setGitHub(integration);
      setGitHubToken("");
      setConnectOpen(false);
      window.dispatchEvent(new Event("maestro:github-status-changed"));
    } catch (error) {
      setGitHubError(
        error instanceof Error ? error.message : "Failed to connect GitHub"
      );
    } finally {
      setGitHubLoading(false);
    }
  }

  async function handleDisconnect() {
    setDisconnecting(true);
    try {
      const { github: integration } = await api.disconnectGitHub();
      setGitHub(integration);
      window.dispatchEvent(new Event("maestro:github-status-changed"));
    } catch (error) {
      setGitHubError(
        error instanceof Error ? error.message : "Failed to disconnect GitHub"
      );
    } finally {
      setDisconnecting(false);
    }
  }

  const connectionRows = [
    {
      label: "Server URL",
      value: <span className="font-mono text-xs">{serverUrl}</span>,
    },
    {
      label: "Status",
      value: (
        <Badge variant={serverInfo ? "secondary" : "destructive"}>
          {serverInfo ? "Connected" : "Disconnected"}
        </Badge>
      ),
    },
    {
      label: "Auth Token",
      value: (
        <span className="font-mono text-xs text-muted-foreground">
          {token ? `${token.slice(0, 8)}...${token.slice(-4)}` : "None"}
        </span>
      ),
    },
  ];

  const githubRows = [
    {
      label: "Account",
      value: github?.connected
        ? github.name
          ? `${github.name} (@${github.login})`
          : github.login || "Connected"
        : "Not connected",
      description: github?.connected ? "Used for repo bootstrap, issue sync, and automations." : undefined,
    },
    {
      label: "Source",
      value: sourceLabel(github?.source ?? null),
    },
    {
      label: "Scopes",
      value: github?.connected ? formatScopes(github.scopes) : "None",
    },
    {
      label: "Verified",
      value: github?.verifiedAt
        ? new Date(github.verifiedAt).toLocaleString()
        : "Not verified",
    },
  ];

  return (
    <>
      <div className="flex-1 max-w-2xl p-4 sm:p-6 lg:p-8">
        <h2 className="mb-6 text-xl font-bold sm:text-2xl">Settings</h2>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Connection</CardTitle>
              <CardDescription>
                Current client connection and authentication details.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DetailRows rows={connectionRows} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle className="text-sm">GitHub</CardTitle>
                <CardDescription>
                  Connect a server-wide GitHub account for bootstrap, issue sync,
                  automations, and repo autocomplete.
                </CardDescription>
              </div>
              <Badge variant="outline">
                {github?.connected
                  ? `Connected via ${sourceLabel(github.source)}`
                  : "Not connected"}
              </Badge>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {githubError && (
                <Alert variant="destructive">
                  <TriangleAlertIcon />
                  <AlertTitle>GitHub action failed</AlertTitle>
                  <AlertDescription>{githubError}</AlertDescription>
                </Alert>
              )}

              <DetailRows rows={githubRows} />

              {github?.source === "env" && (
                <Alert>
                  <TriangleAlertIcon />
                  <AlertTitle>Environment-managed token</AlertTitle>
                  <AlertDescription>
                    This GitHub connection comes from <code>GITHUB_TOKEN</code> or{" "}
                    <code>GH_TOKEN</code> in the server environment. You can still
                    connect a Settings token to override it.
                  </AlertDescription>
                </Alert>
              )}

              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  onClick={() => {
                    setGitHubError("");
                    setConnectOpen(true);
                  }}
                >
                  {github?.connected ? "Replace GitHub Token" : "Connect GitHub"}
                </Button>
                {github?.canDisconnect && (
                  <Button
                    variant="outline"
                    disabled={disconnecting}
                    onClick={() => {
                      void handleDisconnect();
                    }}
                  >
                    {disconnecting ? "Disconnecting..." : "Disconnect"}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle className="text-sm">CLI Updates</CardTitle>
                <CardDescription>
                  Manage automatic updates for Claude Code and Codex CLI tools.
                </CardDescription>
              </div>
              {updateStatus?.updating && (
                <Badge variant="secondary">
                  <LoaderIcon className="mr-1 size-3 animate-spin" />
                  Updating
                </Badge>
              )}
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <FieldGroup>
                <Field orientation="horizontal">
                  <FieldLabel>Auto-update</FieldLabel>
                  <FieldContent className="items-end">
                    <Switch
                      checked={settings?.autoUpdateEnabled ?? false}
                      onCheckedChange={handleToggleAutoUpdate}
                    />
                  </FieldContent>
                </Field>
                <FieldSeparator />
                <Field orientation="horizontal">
                  <div>
                    <FieldLabel>Check interval</FieldLabel>
                    <FieldDescription>How often to check for new versions.</FieldDescription>
                  </div>
                  <FieldContent className="items-end">
                    <Select
                      value={String(settings?.autoUpdateIntervalHours ?? 24)}
                      onValueChange={handleIntervalChange}
                    >
                      <SelectTrigger className="w-[140px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">Every hour</SelectItem>
                        <SelectItem value="6">Every 6 hours</SelectItem>
                        <SelectItem value="12">Every 12 hours</SelectItem>
                        <SelectItem value="24">Every 24 hours</SelectItem>
                        <SelectItem value="72">Every 3 days</SelectItem>
                        <SelectItem value="168">Every week</SelectItem>
                      </SelectContent>
                    </Select>
                  </FieldContent>
                </Field>
              </FieldGroup>

              {updateStatus && (
                <FieldGroup>
                  <FieldSeparator />
                  <Field orientation="horizontal">
                    <FieldLabel>Claude Code</FieldLabel>
                    <FieldContent className="items-end">
                      <span className="font-mono text-xs">
                        {updateStatus.claudeCode.currentVersion ?? "Not installed"}
                      </span>
                      {updateStatus.claudeCode.updateAvailable && (
                        <Badge variant="secondary" className="text-xs">
                          {updateStatus.claudeCode.latestVersion} available
                        </Badge>
                      )}
                    </FieldContent>
                  </Field>
                  <FieldSeparator />
                  <Field orientation="horizontal">
                    <FieldLabel>Codex</FieldLabel>
                    <FieldContent className="items-end">
                      <span className="font-mono text-xs">
                        {updateStatus.codex.currentVersion ?? "Not installed"}
                      </span>
                      {updateStatus.codex.updateAvailable && (
                        <Badge variant="secondary" className="text-xs">
                          {updateStatus.codex.latestVersion} available
                        </Badge>
                      )}
                    </FieldContent>
                  </Field>
                  {updateStatus.lastCheckAt && (
                    <>
                      <FieldSeparator />
                      <Field orientation="horizontal">
                        <FieldLabel>Last checked</FieldLabel>
                        <FieldContent className="items-end">
                          <span className="text-xs text-muted-foreground">
                            {new Date(updateStatus.lastCheckAt).toLocaleString()}
                          </span>
                        </FieldContent>
                      </Field>
                    </>
                  )}
                  {updateStatus.lastError && (
                    <Alert variant="destructive">
                      <TriangleAlertIcon />
                      <AlertTitle>Update error</AlertTitle>
                      <AlertDescription>{updateStatus.lastError}</AlertDescription>
                    </Alert>
                  )}
                </FieldGroup>
              )}

              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  variant="outline"
                  disabled={checking}
                  onClick={() => void handleCheckUpdates()}
                >
                  {checking ? (
                    <LoaderIcon className="mr-2 size-4 animate-spin" />
                  ) : (
                    <RefreshCwIcon className="mr-2 size-4" />
                  )}
                  Check for Updates
                </Button>
                <Button
                  disabled={updatingClis}
                  onClick={() => void handleUpdateNow()}
                >
                  {updatingClis ? (
                    <LoaderIcon className="mr-2 size-4 animate-spin" />
                  ) : (
                    <DownloadIcon className="mr-2 size-4" />
                  )}
                  Update Now
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">About</CardTitle>
            </CardHeader>
            <CardContent>
              <DetailRows
                rows={[
                  { label: "Version", value: "0.1.0" },
                  { label: "Project", value: "Maestro" },
                ]}
              />
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog
        open={connectOpen}
        onOpenChange={(open) => {
          setConnectOpen(open);
          if (!open) {
            setGitHubToken("");
            setGitHubError("");
          }
        }}
      >
        <DialogContent>
          <form onSubmit={handleConnect} className="flex flex-col gap-5">
            <DialogHeader>
              <DialogTitle>Connect GitHub</DialogTitle>
              <DialogDescription>
                Paste a GitHub personal access token. Maestro stores it on the
                server and uses it for GitHub-backed features.
              </DialogDescription>
            </DialogHeader>

            {githubError && (
              <Alert variant="destructive">
                <TriangleAlertIcon />
                <AlertTitle>Could not connect GitHub</AlertTitle>
                <AlertDescription>{githubError}</AlertDescription>
              </Alert>
            )}

            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="github-token">GitHub Token</FieldLabel>
                <Input
                  id="github-token"
                  type="password"
                  value={githubToken}
                  onChange={(e) => setGitHubToken(e.target.value)}
                  placeholder="ghp_... or github_pat_..."
                  autoFocus
                />
                <FieldDescription>
                  Recommended scopes: repository read for cloning, issues
                  read/write for kanban, and pull request read if you use PR
                  automations.
                </FieldDescription>
              </Field>
            </FieldGroup>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setConnectOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={githubLoading}>
                {githubLoading ? "Connecting..." : "Connect GitHub"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function Page() {
  return (
    <AppShell>
      <main className="flex-1 overflow-auto">
        <SettingsView />
      </main>
    </AppShell>
  );
}

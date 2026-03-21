"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TriangleAlertIcon, RefreshCwIcon, DownloadIcon, LoaderIcon, CheckCircleIcon, EyeIcon, EyeOffIcon, GithubIcon, CopyIcon, ExternalLinkIcon, UnlinkIcon, MicIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { api, type Settings, type UpdateStatus, type DeploymentUpdateStatus, type OllamaModelInfo, type OllamaPullStatus, type OllamaStatus, type GitHubConnectionStatus, type ClaudeAuthStatus, type CodexAuthStatus } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useStore } from "@/lib/store";
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
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
          <Field orientation="responsive">
            <FieldLabel>{row.label}</FieldLabel>
            <FieldContent className="items-start @md/field-group:items-end">
              <div className="@md/field-group:text-right">{row.value}</div>
              {row.description && (
                <FieldDescription className="@md/field-group:text-right">
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function GitHubConnectionCard({ refreshKey }: { refreshKey: number }) {
  const [status, setStatus] = useState<GitHubConnectionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [tokenInput, setTokenInput] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    api.getGitHubIntegration(refreshKey > 0)
      .then((res) => setStatus(res.github))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [refreshKey]);

  async function handleConnect() {
    if (!tokenInput.trim()) return;
    setConnecting(true);
    setError("");
    try {
      const res = await api.connectGitHub(tokenInput.trim());
      setStatus(res.github);
      setTokenInput("");
      window.dispatchEvent(new Event("maestro:github-status-changed"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect");
    } finally {
      setConnecting(false);
    }
  }

  async function handleDisconnect() {
    try {
      const res = await api.disconnectGitHub();
      setStatus(res.github);
      window.dispatchEvent(new Event("maestro:github-status-changed"));
    } catch {
      /* ignore */
    }
  }

  if (loading) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <GithubIcon className="size-4" />
          GitHub
        </CardTitle>
        <CardDescription>
          {status?.connected
            ? `Connected as ${status.login}${status.source === "env" ? " (via environment)" : ""}`
            : "Connect with a Personal Access Token (classic) for issue sync and automations."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {status?.connected ? (
          <>
            <FieldGroup>
              <Field orientation="horizontal">
                <FieldLabel>Account</FieldLabel>
                <FieldContent className="items-end">
                  <span className="text-sm">{status.name ?? status.login}</span>
                </FieldContent>
              </Field>
              {status.scopes.length > 0 && (
                <>
                  <FieldSeparator />
                  <Field orientation="horizontal">
                    <FieldLabel>Scopes</FieldLabel>
                    <FieldContent className="items-end">
                      <span className="font-mono text-xs">{status.scopes.join(", ")}</span>
                    </FieldContent>
                  </Field>
                </>
              )}
              <FieldSeparator />
              <Field orientation="horizontal">
                <FieldLabel>Source</FieldLabel>
                <FieldContent className="items-end">
                  <Badge variant="secondary">{status.source === "env" ? "Environment" : "Stored"}</Badge>
                </FieldContent>
              </Field>
            </FieldGroup>
            {status.canDisconnect && (
              <Button variant="outline" onClick={() => void handleDisconnect()}>
                <UnlinkIcon className="mr-2 size-4" />
                Disconnect
              </Button>
            )}
          </>
        ) : (
          <>
            <FieldDescription>
              Create a classic PAT at{" "}
              <a
                href="https://github.com/settings/tokens/new"
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                github.com/settings/tokens
              </a>{" "}
              with <code className="text-xs">repo</code> and <code className="text-xs">read:org</code> scopes.
            </FieldDescription>
            <div className="flex gap-2">
              <Input
                placeholder="ghp_..."
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleConnect();
                }}
              />
              <Button
                disabled={connecting || !tokenInput.trim()}
                onClick={() => void handleConnect()}
              >
                {connecting ? (
                  <LoaderIcon className="mr-2 size-4 animate-spin" />
                ) : null}
                Connect
              </Button>
            </div>

            {error && (
              <Alert variant="destructive">
                <TriangleAlertIcon />
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ClaudeConnectionCard({ refreshKey }: { refreshKey: number }) {
  const router = useRouter();
  const addAgent = useStore((s) => s.addAgent);
  const selectAgent = useStore((s) => s.selectAgent);
  const [status, setStatus] = useState<ClaudeAuthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    setLoading(true);
    api.getClaudeAuthStatus(refreshKey > 0)
      .then(setStatus)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [refreshKey]);

  async function handleLogin() {
    setConnecting(true);
    setError("");
    try {
      // Create a temporary Claude terminal for interactive login in normal CLI mode.
      const { terminal } = await api.createTerminal({
        name: "Claude Login",
        provider: "claude",
        projectPath: "/tmp",
        prompt: "",
        skipPermissions: false,
        disableSandbox: true,
      });
      // Select the terminal and navigate to the terminals page for the login flow
      addAgent(terminal);
      selectAgent(terminal.id);
      router.push("/terminals");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start login");
      setConnecting(false);
    }
  }

  if (loading) return null;

  if (status && !status.installed) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Claude Code</CardTitle>
          <CardDescription>Claude Code CLI is not installed.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Claude Code</CardTitle>
        <CardDescription>
          {status?.loggedIn
            ? `Connected as ${status.email ?? "unknown"}${status.orgName ? ` (${status.orgName})` : ""}`
            : "Connect to Claude Code for AI-powered agents."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {status?.loggedIn ? (
          <FieldGroup>
            <Field orientation="horizontal">
              <FieldLabel>Account</FieldLabel>
              <FieldContent className="items-end">
                <span className="text-sm">{status.email}</span>
              </FieldContent>
            </Field>
            {status.authMethod && (
              <>
                <FieldSeparator />
                <Field orientation="horizontal">
                  <FieldLabel>Auth method</FieldLabel>
                  <FieldContent className="items-end">
                    <Badge variant="secondary">{status.authMethod}</Badge>
                  </FieldContent>
                </Field>
              </>
            )}
          </FieldGroup>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              This will open a Claude agent where you can complete the login flow interactively.
            </p>
            <Button
              variant="outline"
              disabled={connecting}
              onClick={() => void handleLogin()}
            >
              {connecting ? (
                <LoaderIcon className="mr-2 size-4 animate-spin" />
              ) : (
                <ExternalLinkIcon className="mr-2 size-4" />
              )}
              Sign in to Claude
            </Button>

            {error && (
              <Alert variant="destructive">
                <TriangleAlertIcon />
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function CodexConnectionCard({ refreshKey }: { refreshKey: number }) {
  const [status, setStatus] = useState<CodexAuthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [deviceAuth, setDeviceAuth] = useState<{ code: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setLoading(true);
    api.getCodexAuthStatus(refreshKey > 0)
      .then(setStatus)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [refreshKey]);

  async function handleDeviceAuth() {
    setConnecting(true);
    setError("");
    setDeviceAuth(null);
    try {
      const result = await api.startCodexDeviceAuth();
      setDeviceAuth(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start device auth");
    } finally {
      setConnecting(false);
    }
  }

  async function handleConnectApiKey() {
    if (!apiKeyInput.trim()) return;
    setSubmitting(true);
    setError("");
    try {
      const result = await api.connectCodexWithApiKey(apiKeyInput.trim());
      setStatus(result);
      setApiKeyInput("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect");
    } finally {
      setSubmitting(false);
    }
  }

  function handleCopyCode(code: string) {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }

  if (loading) return null;

  if (status && !status.installed) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Codex</CardTitle>
          <CardDescription>Codex CLI is not installed.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Codex</CardTitle>
        <CardDescription>
          {status?.loggedIn
            ? status.detail ?? "Connected"
            : "Connect to Codex for OpenAI-powered agents."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {status?.loggedIn ? (
          <FieldGroup>
            <Field orientation="horizontal">
              <FieldLabel>Status</FieldLabel>
              <FieldContent className="items-end">
                <Badge variant="secondary">Connected</Badge>
              </FieldContent>
            </Field>
          </FieldGroup>
        ) : (
          <>
            {deviceAuth ? (
              <div className="flex flex-col gap-3">
                <div className="rounded-md border p-4 text-center">
                  <p className="mb-2 text-sm text-muted-foreground">
                    Copy this code and enter it on OpenAI:
                  </p>
                  <button
                    type="button"
                    className="inline-flex items-center gap-2 rounded-md border px-4 py-2 font-mono text-lg font-bold tracking-widest transition-colors hover:bg-muted"
                    onClick={() => handleCopyCode(deviceAuth.code)}
                  >
                    {deviceAuth.code}
                    {copied ? (
                      <CheckCircleIcon className="size-4 text-green-500" />
                    ) : (
                      <CopyIcon className="size-4 text-muted-foreground" />
                    )}
                  </button>
                </div>
                <Button
                  variant="outline"
                  onClick={() => window.open(deviceAuth.url, "_blank", "noopener,noreferrer")}
                >
                  <ExternalLinkIcon className="mr-2 size-4" />
                  Open OpenAI
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <Button
                  variant="outline"
                  disabled={connecting}
                  onClick={() => void handleDeviceAuth()}
                >
                  {connecting ? (
                    <LoaderIcon className="mr-2 size-4 animate-spin" />
                  ) : (
                    <ExternalLinkIcon className="mr-2 size-4" />
                  )}
                  Sign in with OpenAI
                </Button>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="h-px flex-1 bg-border" />
                  or paste an API key
                  <span className="h-px flex-1 bg-border" />
                </div>
                <div className="flex gap-2">
                  <Input
                    placeholder="sk-..."
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handleConnectApiKey();
                    }}
                  />
                  <Button
                    disabled={submitting || !apiKeyInput.trim()}
                    onClick={() => void handleConnectApiKey()}
                  >
                    Connect
                  </Button>
                </div>
              </div>
            )}

            {error && (
              <Alert variant="destructive">
                <TriangleAlertIcon />
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function AgentDefaultsCard({
  settings,
  onSettingsUpdate,
  refreshKey,
}: {
  settings: Settings | null;
  onSettingsUpdate: (s: Settings) => void;
  refreshKey: number;
}) {
  const [provider, setProvider] = useState<"claude" | "codex">("claude");
  const [disableSandbox, setDisableSandbox] = useState(false);
  const [skipPermissions, setSkipPermissions] = useState(true);
  const [worktreeMode, setWorktreeMode] = useState<"none" | "new">("none");
  const [saving, setSaving] = useState(false);
  const [claudeStatus, setClaudeStatus] = useState<ClaudeAuthStatus | null>(null);
  const [codexStatus, setCodexStatus] = useState<CodexAuthStatus | null>(null);
  const [loadingProviders, setLoadingProviders] = useState(true);

  useEffect(() => {
    if (!settings) return;
    setProvider(settings.agentDefaultProvider);
    setDisableSandbox(settings.agentDefaultDisableSandbox);
    setSkipPermissions(settings.agentDefaultSkipPermissions);
    setWorktreeMode(settings.agentDefaultWorktreeMode);
  }, [settings]);

  useEffect(() => {
    setLoadingProviders(true);
    Promise.all([
      api.getClaudeAuthStatus(refreshKey > 0).catch(() => null),
      api.getCodexAuthStatus(refreshKey > 0).catch(() => null),
    ])
      .then(([claude, codex]) => {
        setClaudeStatus(claude);
        setCodexStatus(codex);
      })
      .finally(() => setLoadingProviders(false));
  }, [refreshKey]);

  const claudeAvailable = Boolean(claudeStatus?.installed && claudeStatus.loggedIn);
  const codexAvailable = Boolean(codexStatus?.installed && codexStatus.loggedIn);
  const selectedProviderAvailable =
    provider === "claude" ? claudeAvailable : codexAvailable;
  const hasAvailableProvider = claudeAvailable || codexAvailable;
  const isDirty =
    provider !== (settings?.agentDefaultProvider ?? "claude") ||
    disableSandbox !== (settings?.agentDefaultDisableSandbox ?? false) ||
    skipPermissions !== (settings?.agentDefaultSkipPermissions ?? true) ||
    worktreeMode !== (settings?.agentDefaultWorktreeMode ?? "none");

  async function handleSave() {
    setSaving(true);
    try {
      const updated = await api.updateSettings({
        agentDefaultProvider: provider,
        agentDefaultDisableSandbox: disableSandbox,
        agentDefaultSkipPermissions: skipPermissions,
        agentDefaultWorktreeMode: worktreeMode,
      });
      onSettingsUpdate(updated);
    } catch {
      /* ignore */
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Agents</CardTitle>
        <CardDescription>
          Defaults for coding agents that Maestro spawns automatically from kanban and scheduler.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {loadingProviders ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderIcon className="size-4 animate-spin" />
            Checking agent providers...
          </div>
        ) : !hasAvailableProvider ? (
          <Alert>
            <TriangleAlertIcon />
            <AlertTitle>No coding agent available</AlertTitle>
            <AlertDescription>
              Sign in to Claude Code or Codex above before enabling automatic agent spawning.
            </AlertDescription>
          </Alert>
        ) : null}

        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="agent-default-provider">Coding agent</FieldLabel>
            <Select
              value={provider}
              onValueChange={(value) => setProvider((value as "claude" | "codex") ?? "claude")}
            >
              <SelectTrigger id="agent-default-provider" className="w-full">
                <SelectValue placeholder="Select a coding agent" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="claude" disabled={!claudeAvailable}>
                    {claudeAvailable ? "Claude Code" : "Claude Code (sign in required)"}
                  </SelectItem>
                  <SelectItem value="codex" disabled={!codexAvailable}>
                    {codexAvailable ? "Codex" : "Codex (sign in required)"}
                  </SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            <FieldDescription>
              Only logged-in coding agents can be used for automatic spawns.
            </FieldDescription>
          </Field>

          <Field orientation="responsive">
            <FieldContent>
              <FieldLabel htmlFor="agent-default-sandbox">Sandbox</FieldLabel>
              <FieldDescription>
                Run automatically spawned agents inside nsjail when available.
              </FieldDescription>
            </FieldContent>
            <Switch
              id="agent-default-sandbox"
              checked={!disableSandbox}
              onCheckedChange={(checked) => {
                setDisableSandbox(!checked);
                if (!checked) {
                  setSkipPermissions(false);
                }
              }}
            />
          </Field>

          <Field orientation="responsive">
            <FieldContent>
              <FieldLabel htmlFor="agent-default-yolo">YOLO mode</FieldLabel>
              <FieldDescription>
                {disableSandbox
                  ? "Disabled because sandboxing is off."
                  : "Run without approval prompts for automatically spawned agents."}
              </FieldDescription>
            </FieldContent>
            <Switch
              id="agent-default-yolo"
              checked={skipPermissions}
              onCheckedChange={setSkipPermissions}
              disabled={disableSandbox}
            />
          </Field>

          <Field orientation="responsive">
            <FieldContent>
              <FieldLabel htmlFor="agent-default-worktree">Worktrees</FieldLabel>
              <FieldDescription>
                {worktreeMode === "new"
                  ? "Auto-spawned agents create a fresh git worktree."
                  : "Auto-spawned agents work directly in the project directory."}
              </FieldDescription>
            </FieldContent>
            <Switch
              id="agent-default-worktree"
              checked={worktreeMode === "new"}
              onCheckedChange={(checked) => setWorktreeMode(checked ? "new" : "none")}
            />
          </Field>
        </FieldGroup>

        {!selectedProviderAvailable && hasAvailableProvider && (
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertTitle>Selected provider unavailable</AlertTitle>
            <AlertDescription>
              Choose a logged-in coding agent before saving these defaults.
            </AlertDescription>
          </Alert>
        )}

        <Button
          disabled={!isDirty || saving || !selectedProviderAvailable}
          onClick={() => void handleSave()}
        >
          {saving ? (
            <LoaderIcon className="mr-2 size-4 animate-spin" />
          ) : (
            <CheckCircleIcon className="mr-2 size-4" />
          )}
          {saving ? "Saving..." : isDirty ? "Save" : "Saved"}
        </Button>
      </CardContent>
    </Card>
  );
}

function DeepgramCard({ settings, onSettingsUpdate }: {
  settings: Settings | null;
  onSettingsUpdate: (s: Settings) => void;
}) {
  const [keyInput, setKeyInput] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (settings?.deepgramApiKey) {
      setKeyInput(settings.deepgramApiKey);
    }
  }, [settings?.deepgramApiKey]);

  const savedKey = settings?.deepgramApiKey || "";
  const isDirty = keyInput !== savedKey;

  async function handleSave() {
    setSaving(true);
    try {
      const updated = await api.updateSettings({ deepgramApiKey: keyInput.trim() });
      onSettingsUpdate(updated);
    } catch {
      /* ignore */
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <MicIcon className="size-4" />
          Voice Input
        </CardTitle>
        <CardDescription>
          Configure Deepgram for voice-to-text on mobile agent terminals.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <FieldGroup>
          <Field orientation="responsive">
            <div>
              <FieldLabel>API Key</FieldLabel>
              <FieldDescription>
                Get a key at{" "}
                <a
                  href="https://console.deepgram.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  console.deepgram.com
                </a>
              </FieldDescription>
            </div>
            <FieldContent className="@md/field-group:items-end">
              <div className="flex items-center gap-2">
                <input
                  type={showKey ? "text" : "password"}
                  className="h-9 w-full @md/field-group:w-[260px] rounded-md border border-input bg-background px-3 font-mono text-xs"
                  placeholder="dg-..."
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-9 shrink-0"
                  onClick={() => setShowKey(!showKey)}
                >
                  {showKey ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
                </Button>
              </div>
            </FieldContent>
          </Field>
        </FieldGroup>

        <Button
          disabled={!isDirty || saving}
          onClick={() => void handleSave()}
        >
          {saving ? (
            <LoaderIcon className="mr-2 size-4 animate-spin" />
          ) : (
            <CheckCircleIcon className="mr-2 size-4" />
          )}
          {saving ? "Saving..." : isDirty ? "Save" : "Saved"}
        </Button>
      </CardContent>
    </Card>
  );
}

function PiAgentCard({ settings, onSettingsUpdate }: {
  settings: Settings | null;
  onSettingsUpdate: (s: Settings) => void;
}) {
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus | null>(null);
  const [localModels, setLocalModels] = useState<OllamaModelInfo[]>([]);
  const [recommendedModels, setRecommendedModels] = useState<string[]>([]);
  const [pullStatus, setPullStatus] = useState<OllamaPullStatus | null>(null);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [customModel, setCustomModel] = useState("");
  const [loading, setLoading] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadOllamaData = useCallback(async () => {
    try {
      const [status, modelsRes, recRes] = await Promise.all([
        api.getOllamaStatus(),
        api.getOllamaModels().catch(() => ({ models: [] })),
        api.getRecommendedModels(),
      ]);
      setOllamaStatus(status);
      setLocalModels(modelsRes.models);
      setRecommendedModels(recRes.models);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOllamaData();
  }, [loadOllamaData]);

  // Set selected model from saved settings
  useEffect(() => {
    if (settings?.piOllamaModel) {
      setSelectedModel(settings.piOllamaModel);
    }
  }, [settings?.piOllamaModel]);

  // Poll pull status while pulling
  useEffect(() => {
    if (pullStatus && !pullStatus.done) {
      pollRef.current = setInterval(async () => {
        try {
          const status = await api.getOllamaPullStatus();
          setPullStatus(status);
          if (status.done) {
            if (pollRef.current) clearInterval(pollRef.current);
            // Refresh model list after pull completes
            void loadOllamaData();
          }
        } catch {
          /* ignore */
        }
      }, 1000);
      return () => {
        if (pollRef.current) clearInterval(pollRef.current);
      };
    }
  }, [pullStatus?.done, loadOllamaData]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handlePullModel() {
    const model = selectedModel === "__custom__" ? customModel.trim() : selectedModel;
    if (!model) return;
    try {
      await api.pullOllamaModel(model);
      setPullStatus({ model, status: "starting", progress: 0, error: null, done: false });
    } catch {
      /* ignore */
    }
  }

  async function handleSaveModel() {
    const model = selectedModel === "__custom__" ? customModel.trim() : selectedModel;
    if (!model) return;
    try {
      const updated = await api.updateSettings({ piOllamaModel: model });
      onSettingsUpdate(updated);
    } catch {
      /* ignore */
    }
  }

  const isPulling = pullStatus != null && !pullStatus.done;
  const savedModel = settings?.piOllamaModel || "";
  const effectiveModel = selectedModel === "__custom__" ? customModel.trim() : selectedModel;
  const modelIsLocal = localModels.some((m) => m.name === effectiveModel || m.name === `${effectiveModel}:latest`);
  const modelIsSaved = savedModel === effectiveModel;

  // Models available to download (not already local)
  const localModelNames = new Set(localModels.map((m) => m.name));
  const downloadableModels = recommendedModels.filter(
    (m) => !localModelNames.has(m) && !localModelNames.has(`${m}:latest`)
  );

  return (
    <Card>
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="text-sm">Pi Agent</CardTitle>
          <CardDescription>
            Configure the Ollama model used by the Pi agent for local inference.
          </CardDescription>
        </div>
        {ollamaStatus && (
          <Badge variant={ollamaStatus.running ? "secondary" : "destructive"}>
            {ollamaStatus.running ? "Ollama Running" : "Ollama Offline"}
          </Badge>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderIcon className="size-4 animate-spin" />
            Checking Ollama status...
          </div>
        ) : !ollamaStatus?.running ? (
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertTitle>Ollama not reachable</AlertTitle>
            <AlertDescription>
              Cannot connect to Ollama at {ollamaStatus?.host ?? "http://localhost:11434"}.
              Make sure Ollama is running.
            </AlertDescription>
          </Alert>
        ) : (
          <>
            <FieldGroup>
              <Field orientation="responsive">
                <div>
                  <FieldLabel>Model</FieldLabel>
                  <FieldDescription>
                    Select a locally available model or download a new one.
                  </FieldDescription>
                </div>
                <FieldContent className="@md/field-group:items-end">
                  <Select value={selectedModel} onValueChange={(v) => { if (v != null) setSelectedModel(v); }}>
                    <SelectTrigger className="w-full @md/field-group:w-[200px]">
                      <SelectValue placeholder="Select a model" />
                    </SelectTrigger>
                    <SelectContent>
                      {localModels.length > 0 && (
                        <>
                          {localModels.map((m) => (
                            <SelectItem key={m.name} value={m.name}>
                              {m.name} ({formatBytes(m.size)})
                            </SelectItem>
                          ))}
                        </>
                      )}
                      {downloadableModels.length > 0 && (
                        <>
                          {downloadableModels.map((m) => (
                            <SelectItem key={m} value={m}>
                              {m} (download)
                            </SelectItem>
                          ))}
                        </>
                      )}
                      <SelectItem value="__custom__">Custom model...</SelectItem>
                    </SelectContent>
                  </Select>
                </FieldContent>
              </Field>

              {selectedModel === "__custom__" && (
                <>
                  <FieldSeparator />
                  <Field orientation="responsive">
                    <div>
                      <FieldLabel>Model name</FieldLabel>
                      <FieldDescription>
                        Include quantization in the tag, e.g. llama3.2:q4_K_M
                      </FieldDescription>
                    </div>
                    <FieldContent className="@md/field-group:items-end">
                      <input
                        type="text"
                        className="h-9 w-full @md/field-group:w-[200px] rounded-md border border-input bg-background px-3 text-sm"
                        placeholder="e.g. llama3.2:q4_K_M"
                        value={customModel}
                        onChange={(e) => setCustomModel(e.target.value)}
                      />
                    </FieldContent>
                  </Field>
                </>
              )}

              {savedModel && (
                <>
                  <FieldSeparator />
                  <Field orientation="responsive">
                    <FieldLabel>Active model</FieldLabel>
                    <FieldContent className="@md/field-group:items-end">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs">{savedModel}</span>
                        {localModelNames.has(savedModel) || localModelNames.has(`${savedModel}:latest`) ? (
                          <Badge variant="secondary">
                            <CheckCircleIcon className="mr-1 size-3" />
                            Ready
                          </Badge>
                        ) : (
                          <Badge variant="destructive">Not downloaded</Badge>
                        )}
                      </div>
                    </FieldContent>
                  </Field>
                </>
              )}
            </FieldGroup>

            {/* Pull progress */}
            {pullStatus && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    {pullStatus.done
                      ? pullStatus.error
                        ? `Failed: ${pullStatus.error}`
                        : `Downloaded ${pullStatus.model}`
                      : `Downloading ${pullStatus.model}...`}
                  </span>
                  <span className="font-mono text-xs">{pullStatus.progress}%</span>
                </div>
                <Progress value={pullStatus.progress} />
                {pullStatus.done && pullStatus.error && (
                  <Alert variant="destructive">
                    <TriangleAlertIcon />
                    <AlertTitle>Pull failed</AlertTitle>
                    <AlertDescription>{pullStatus.error}</AlertDescription>
                  </Alert>
                )}
              </div>
            )}

            <div className="flex flex-col gap-2 sm:flex-row">
              {effectiveModel && !modelIsLocal && (
                <Button
                  variant="outline"
                  disabled={isPulling || !effectiveModel}
                  onClick={() => void handlePullModel()}
                >
                  {isPulling ? (
                    <LoaderIcon className="mr-2 size-4 animate-spin" />
                  ) : (
                    <DownloadIcon className="mr-2 size-4" />
                  )}
                  Download Model
                </Button>
              )}
              <Button
                disabled={!effectiveModel || !modelIsLocal || modelIsSaved}
                onClick={() => void handleSaveModel()}
              >
                <CheckCircleIcon className="mr-2 size-4" />
                {modelIsSaved ? "Saved" : "Save & Activate"}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function TelegramCard({ settings, onSettingsUpdate }: {
  settings: Settings | null;
  onSettingsUpdate: (s: Settings) => void;
}) {
  const [tokenInput, setTokenInput] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ status: string; botUsername?: string | null } | null>(null);

  useEffect(() => {
    if (settings?.telegramBotToken) {
      setTokenInput(settings.telegramBotToken);
    }
  }, [settings?.telegramBotToken]);

  useEffect(() => {
    api.getTelegramStatus()
      .then(setStatus)
      .catch(() => {});
  }, []);

  const savedToken = settings?.telegramBotToken || "";
  const isDirty = tokenInput !== savedToken;

  async function handleSave() {
    setSaving(true);
    try {
      const updated = await api.updateSettings({ telegramBotToken: tokenInput.trim() });
      onSettingsUpdate(updated);

      // If token was set, connect; if cleared, disconnect
      if (tokenInput.trim()) {
        const newStatus = await api.connectTelegram();
        setStatus(newStatus);
      } else {
        await api.disconnectTelegram();
        setStatus({ status: "disconnected", botUsername: null });
      }
    } catch {
      /* ignore */
    } finally {
      setSaving(false);
    }
  }

  const isConnected = status?.status === "connected";

  return (
    <Card>
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="text-sm">Telegram</CardTitle>
          <CardDescription>
            Connect a Telegram bot to interact with the Pi agent via chat.
          </CardDescription>
        </div>
        {status && (
          <Badge variant={isConnected ? "secondary" : "outline"}>
            {isConnected
              ? `@${status.botUsername || "bot"}`
              : status.status === "error"
                ? "Error"
                : status.status === "connecting"
                  ? "Connecting..."
                  : "Disconnected"}
          </Badge>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <FieldGroup>
          <Field orientation="responsive">
            <div>
              <FieldLabel>Bot Token</FieldLabel>
              <FieldDescription>
                Get a token from @BotFather on Telegram.
              </FieldDescription>
            </div>
            <FieldContent className="@md/field-group:items-end">
              <div className="flex items-center gap-2">
                <input
                  type={showToken ? "text" : "password"}
                  className="h-9 w-full @md/field-group:w-[260px] rounded-md border border-input bg-background px-3 font-mono text-xs"
                  placeholder="123456:ABC-DEF..."
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-9 shrink-0"
                  onClick={() => setShowToken(!showToken)}
                >
                  {showToken ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
                </Button>
              </div>
            </FieldContent>
          </Field>
        </FieldGroup>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            disabled={!isDirty || saving}
            onClick={() => void handleSave()}
          >
            {saving ? (
              <LoaderIcon className="mr-2 size-4 animate-spin" />
            ) : (
              <CheckCircleIcon className="mr-2 size-4" />
            )}
            {saving ? "Saving..." : isDirty ? "Save & Connect" : "Saved"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function SettingsView() {
  const token = useAuth((s) => s.token);
  const serverUrl = useAuth((s) => s.serverUrl);
  const [serverInfo, setServerInfo] = useState<{
    status: string;
    timestamp: string;
  } | null>(null);
  // Auto-update state
  const [settings, setSettings] = useState<Settings | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [updatingClis, setUpdatingClis] = useState(false);
  const [deploymentStatus, setDeploymentStatus] = useState<DeploymentUpdateStatus | null>(null);
  const [checkingDeployment, setCheckingDeployment] = useState(false);
  const [redeployingDeployment, setRedeployingDeployment] = useState(false);
  const [deploymentMessage, setDeploymentMessage] = useState("");
  // Auth status refresh key — incremented to re-fetch all auth cards
  const [authRefreshKey, setAuthRefreshKey] = useState(0);

  // Re-fetch auth status when page becomes visible (e.g. returning from another tab after login)
  useEffect(() => {
    function handleVisibility() {
      if (document.visibilityState === "visible") {
        setAuthRefreshKey((k) => k + 1);
      }
    }
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  const loadUpdateStatus = useCallback(async () => {
    try {
      const status = await api.checkForUpdates();
      setUpdateStatus(status);
    } catch {
      /* ignore */
    }
  }, []);

  const loadDeploymentStatus = useCallback(async () => {
    try {
      const status = await api.getDeploymentUpdateStatus();
      setDeploymentStatus(status);
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
    void loadDeploymentStatus();
  }, [loadDeploymentStatus, loadUpdateStatus]);

  useEffect(() => {
    if (!deploymentStatus?.configured || !deploymentStatus.updating) {
      return;
    }

    const timer = window.setInterval(() => {
      void loadDeploymentStatus();
    }, 15_000);

    return () => window.clearInterval(timer);
  }, [deploymentStatus?.configured, deploymentStatus?.updating, loadDeploymentStatus]);

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

  async function handleCheckDeployment() {
    setCheckingDeployment(true);
    try {
      const status = await api.checkDeploymentUpdateStatus();
      setDeploymentStatus(status);
    } catch {
      /* ignore */
    } finally {
      setCheckingDeployment(false);
    }
  }

  async function handleRedeployLatest() {
    setRedeployingDeployment(true);
    setDeploymentMessage("");
    try {
      const result = await api.redeployDeployment();
      setDeploymentMessage(result.message);
      setDeploymentStatus((current) =>
        current
          ? {
              ...current,
              updating: true,
              lastError: null,
            }
          : current
      );
      window.setTimeout(() => {
        void loadDeploymentStatus();
      }, 2_000);
    } catch (err) {
      setDeploymentMessage(err instanceof Error ? err.message : "Failed to start redeploy");
    } finally {
      setRedeployingDeployment(false);
    }
  }

  useEffect(() => {
    fetch(`${serverUrl}/health`)
      .then((r) => r.json())
      .then(setServerInfo)
      .catch(() => setServerInfo(null));
  }, [serverUrl]);

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

  return (
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
                <CardTitle className="text-sm">CLI Updates</CardTitle>
                <CardDescription>
                  Manage automatic updates for Claude Code, Codex, and GitHub CLI tools.
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
                  <FieldSeparator />
                  <Field orientation="horizontal">
                    <FieldLabel>GitHub CLI</FieldLabel>
                    <FieldContent className="items-end">
                      <span className="font-mono text-xs">
                        {updateStatus.gh.currentVersion ?? "Not installed"}
                      </span>
                      {updateStatus.gh.updateAvailable && (
                        <Badge variant="secondary" className="text-xs">
                          {updateStatus.gh.latestVersion} available
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
            <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle className="text-sm">Deployment Updates</CardTitle>
                <CardDescription>
                  Detect GitHub releases and rebuild the Docker deployment from a release tarball via the external updater service.
                </CardDescription>
              </div>
              {deploymentStatus?.updating && (
                <Badge variant="secondary">
                  <LoaderIcon className="mr-1 size-3 animate-spin" />
                  Redeploying
                </Badge>
              )}
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {!deploymentStatus?.configured ? (
                <Alert>
                  <TriangleAlertIcon />
                  <AlertTitle>Updater not configured</AlertTitle>
                  <AlertDescription>
                    {deploymentStatus?.lastError ??
                      "Run the host-side updater service and set `UPDATER_URL` plus `UPDATER_TOKEN` on the Maestro server."}
                  </AlertDescription>
                </Alert>
              ) : (
                <>
                  <FieldGroup>
                    <Field orientation="horizontal">
                      <FieldLabel>Current version</FieldLabel>
                      <FieldContent className="items-end">
                        <span className="font-mono text-xs">
                          {deploymentStatus.currentVersion ?? "Unknown"}
                        </span>
                      </FieldContent>
                    </Field>
                    <FieldSeparator />
                    <Field orientation="horizontal">
                      <FieldLabel>Latest release</FieldLabel>
                      <FieldContent className="items-end">
                        <span className="font-mono text-xs">
                          {deploymentStatus.latestVersion ?? "Unavailable"}
                        </span>
                        {deploymentStatus.updateAvailable && (
                          <Badge variant="secondary" className="text-xs">
                            Update available
                          </Badge>
                        )}
                      </FieldContent>
                    </Field>
                    {deploymentStatus.latestRelease?.publishedAt && (
                      <>
                        <FieldSeparator />
                        <Field orientation="horizontal">
                          <FieldLabel>Published</FieldLabel>
                          <FieldContent className="items-end">
                            <span className="text-xs text-muted-foreground">
                              {new Date(
                                deploymentStatus.latestRelease.publishedAt
                              ).toLocaleString()}
                            </span>
                          </FieldContent>
                        </Field>
                      </>
                    )}
                    {deploymentStatus.lastCheckedAt && (
                      <>
                        <FieldSeparator />
                        <Field orientation="horizontal">
                          <FieldLabel>Last checked</FieldLabel>
                          <FieldContent className="items-end">
                            <span className="text-xs text-muted-foreground">
                              {new Date(deploymentStatus.lastCheckedAt).toLocaleString()}
                            </span>
                          </FieldContent>
                        </Field>
                      </>
                    )}
                    {deploymentStatus.lastUpdatedAt && (
                      <>
                        <FieldSeparator />
                        <Field orientation="horizontal">
                          <FieldLabel>Last deployed</FieldLabel>
                          <FieldContent className="items-end">
                            <span className="text-xs text-muted-foreground">
                              {new Date(deploymentStatus.lastUpdatedAt).toLocaleString()}
                            </span>
                          </FieldContent>
                        </Field>
                      </>
                    )}
                  </FieldGroup>

                  {deploymentStatus.latestRelease?.url && (
                    <a
                      href={deploymentStatus.latestRelease.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs underline"
                    >
                      View release
                      <ExternalLinkIcon className="size-3" />
                    </a>
                  )}

                  {deploymentStatus.latestRelease?.notes && (
                    <p className="line-clamp-6 whitespace-pre-wrap text-xs text-muted-foreground">
                      {deploymentStatus.latestRelease.notes}
                    </p>
                  )}

                  {deploymentStatus.lastError && (
                    <Alert variant="destructive">
                      <TriangleAlertIcon />
                      <AlertTitle>Deployment error</AlertTitle>
                      <AlertDescription>{deploymentStatus.lastError}</AlertDescription>
                    </Alert>
                  )}

                  {deploymentMessage && (
                    <Alert>
                      <TriangleAlertIcon />
                      <AlertTitle>Deployment status</AlertTitle>
                      <AlertDescription>{deploymentMessage}</AlertDescription>
                    </Alert>
                  )}
                </>
              )}

              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  variant="outline"
                  disabled={checkingDeployment || !deploymentStatus?.configured}
                  onClick={() => void handleCheckDeployment()}
                >
                  {checkingDeployment ? (
                    <LoaderIcon className="mr-2 size-4 animate-spin" />
                  ) : (
                    <RefreshCwIcon className="mr-2 size-4" />
                  )}
                  Check Releases
                </Button>
                <Button
                  disabled={
                    redeployingDeployment ||
                    !deploymentStatus?.configured ||
                    deploymentStatus.updating ||
                    !deploymentStatus.latestVersion
                  }
                  onClick={() => void handleRedeployLatest()}
                >
                  {redeployingDeployment ? (
                    <LoaderIcon className="mr-2 size-4 animate-spin" />
                  ) : (
                    <DownloadIcon className="mr-2 size-4" />
                  )}
                  Redeploy Latest
                </Button>
              </div>

              <FieldDescription>
                Redeploys are started asynchronously. Expect the Maestro server connection to drop briefly while Docker rebuilds and restarts the service.
              </FieldDescription>
            </CardContent>
          </Card>

          <ClaudeConnectionCard refreshKey={authRefreshKey} />
          <CodexConnectionCard refreshKey={authRefreshKey} />
          <GitHubConnectionCard refreshKey={authRefreshKey} />

          <DeepgramCard settings={settings} onSettingsUpdate={setSettings} />
          <AgentDefaultsCard
            settings={settings}
            onSettingsUpdate={setSettings}
            refreshKey={authRefreshKey}
          />
          <PiAgentCard settings={settings} onSettingsUpdate={setSettings} />
          <TelegramCard settings={settings} onSettingsUpdate={setSettings} />

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

"use client";

import { useCallback, useEffect, useState } from "react";
import { TriangleAlertIcon, RefreshCwIcon, DownloadIcon, LoaderIcon, CheckCircleIcon, EyeIcon, EyeOffIcon, GithubIcon, CopyIcon, ExternalLinkIcon, UnlinkIcon, MicIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { api, type Settings, type MaestroUpdateStatus, type GitHubConnectionStatus, type ClaudeAuthStatus, type CodexAuthStatus } from "@/lib/api";
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

function formatGitHubSourceLabel(source: GitHubConnectionStatus["source"]): string {
  switch (source) {
    case "env":
      return "Environment";
    case "gh":
      return "GitHub CLI";
    case "stored":
      return "Stored Token";
    default:
      return "Unknown";
  }
}

function GitHubConnectionCard({ refreshKey }: { refreshKey: number }) {
  const [status, setStatus] = useState<GitHubConnectionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [tokenInput, setTokenInput] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
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
            ? `Connected as ${status.login}${
                status.source === "env"
                  ? " (via environment)"
                  : status.source === "gh"
                    ? " (via GitHub CLI)"
                    : ""
              }`
            : "Connect with GitHub CLI or a Personal Access Token (classic) for issue sync and automations."}
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
                  <Badge variant="secondary">{formatGitHubSourceLabel(status.source)}</Badge>
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
              Run <code className="text-xs">gh auth login</code> on this machine, or create a
              classic PAT at{" "}
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
            <FieldDescription>
              Paste it below if you want Maestro to store its own token instead of using the
              host GitHub CLI session.
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
          {status?.loggedIn ? "Connected" : "Connect to Claude Code for AI-powered agents."}
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
  const [sandboxProvider, setSandboxProvider] = useState<"none" | "docker" | "gvisor">("docker");
  const [skipPermissions, setSkipPermissions] = useState(true);
  const [worktreeMode, setWorktreeMode] = useState<"none" | "new">("none");
  const [saving, setSaving] = useState(false);
  const [claudeStatus, setClaudeStatus] = useState<ClaudeAuthStatus | null>(null);
  const [codexStatus, setCodexStatus] = useState<CodexAuthStatus | null>(null);
  const [runtimeStatus, setRuntimeStatus] = useState<{ sandbox: { dockerAvailable: boolean; gvisorAvailable: boolean } } | null>(null);
  const [loadingProviders, setLoadingProviders] = useState(true);

  useEffect(() => {
    if (!settings) return;
    setProvider(settings.agentDefaultProvider);
    setSandboxProvider(settings.sandboxProvider);
    setSkipPermissions(settings.agentDefaultSkipPermissions);
    setWorktreeMode(settings.agentDefaultWorktreeMode);
  }, [settings]);

  useEffect(() => {
    setLoadingProviders(true);
    Promise.all([
      api.getClaudeAuthStatus(refreshKey > 0).catch(() => null),
      api.getCodexAuthStatus(refreshKey > 0).catch(() => null),
      api.getRuntimeStatus().catch(() => null),
    ])
      .then(([claude, codex, runtime]) => {
        setClaudeStatus(claude);
        setCodexStatus(codex);
        setRuntimeStatus(runtime);
        if (runtime && !runtime.sandbox.gvisorAvailable && settings?.sandboxProvider === "gvisor") {
          setSandboxProvider(runtime.sandbox.dockerAvailable ? "docker" : "none");
        }
      })
      .finally(() => setLoadingProviders(false));
  }, [refreshKey]);

  const claudeAvailable = Boolean(claudeStatus?.installed && claudeStatus.loggedIn);
  const codexAvailable = Boolean(codexStatus?.installed && codexStatus.loggedIn);
  const selectedProviderAvailable =
    provider === "claude" ? claudeAvailable : codexAvailable;
  const hasAvailableProvider = claudeAvailable || codexAvailable;
  const gvisorAvailable = Boolean(runtimeStatus?.sandbox.gvisorAvailable);
  const dockerAvailable = runtimeStatus?.sandbox.dockerAvailable ?? true;
  const isDirty =
    provider !== (settings?.agentDefaultProvider ?? "claude") ||
    sandboxProvider !== (settings?.sandboxProvider ?? "none") ||
    skipPermissions !== (settings?.agentDefaultSkipPermissions ?? true) ||
    worktreeMode !== (settings?.agentDefaultWorktreeMode ?? "none");

  async function handleSave() {
    setSaving(true);
    try {
      const updated = await api.updateSettings({
        agentDefaultProvider: provider,
        sandboxProvider,
        agentDefaultDisableSandbox: sandboxProvider === "none",
        agentDefaultSkipPermissions: sandboxProvider === "none" ? false : skipPermissions,
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
                {sandboxProvider === "none"
                  ? "Auto-spawned agents will run without sandboxing."
                  : "Run automatically spawned agents inside the selected sandbox provider."}
              </FieldDescription>
            </FieldContent>
            <Select
              id="agent-default-sandbox"
              value={sandboxProvider}
              onValueChange={(value) => {
                const nextProvider =
                  value === "gvisor" || value === "docker" || value === "none"
                    ? value
                    : "docker";
                setSandboxProvider(nextProvider);
                if (nextProvider === "none") {
                  setSkipPermissions(false);
                }
              }}
            >
              <SelectTrigger id="agent-default-sandbox" className="w-full @md/field-group:w-48">
                <SelectValue placeholder="Select a sandbox" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="gvisor" disabled={!gvisorAvailable}>
                    {gvisorAvailable ? "gVisor" : "gVisor (unavailable)"}
                  </SelectItem>
                  <SelectItem value="docker" disabled={!dockerAvailable}>
                    {dockerAvailable ? "Docker" : "Docker (unavailable)"}
                  </SelectItem>
                  <SelectItem value="none">None</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>

          <Field orientation="responsive">
            <FieldContent>
              <FieldLabel htmlFor="agent-default-yolo">YOLO mode</FieldLabel>
              <FieldDescription>
                {sandboxProvider === "none"
                  ? "Disabled because sandboxing is off."
                  : "Run without approval prompts for automatically spawned agents."}
              </FieldDescription>
            </FieldContent>
            <Switch
              id="agent-default-yolo"
              checked={skipPermissions}
              onCheckedChange={setSkipPermissions}
              disabled={sandboxProvider === "none"}
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
            Keep a Telegram bot configured for future chat integrations.
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
  const [settings, setSettings] = useState<Settings | null>(null);
  const [maestroUpdateStatus, setMaestroUpdateStatus] = useState<MaestroUpdateStatus | null>(null);
  const [checkingMaestro, setCheckingMaestro] = useState(false);
  const [updatingMaestro, setUpdatingMaestro] = useState(false);
  const [maestroUpdateMessage, setMaestroUpdateMessage] = useState("");
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

  const loadMaestroUpdateStatus = useCallback(async () => {
    try {
      const status = await api.getMaestroUpdateStatus();
      setMaestroUpdateStatus(status);
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
    void loadMaestroUpdateStatus();
  }, [loadMaestroUpdateStatus]);

  useEffect(() => {
    if (!maestroUpdateStatus?.updating) {
      return;
    }

    const timer = window.setInterval(() => {
      void loadMaestroUpdateStatus();
    }, 5_000);

    return () => window.clearInterval(timer);
  }, [loadMaestroUpdateStatus, maestroUpdateStatus?.updating]);

  async function handleCheckMaestroUpdate() {
    setCheckingMaestro(true);
    try {
      const status = await api.checkForMaestroUpdate();
      setMaestroUpdateStatus(status);
      setMaestroUpdateMessage("");
    } catch (err) {
      setMaestroUpdateMessage(err instanceof Error ? err.message : "Failed to check for Maestro updates");
    } finally {
      setCheckingMaestro(false);
    }
  }

  async function handleUpdateMaestro() {
    setUpdatingMaestro(true);
    setMaestroUpdateMessage("");
    try {
      const result = await api.updateMaestro();
      setMaestroUpdateMessage(result.message);
      if (result.accepted) {
        setMaestroUpdateStatus((current) =>
          current
            ? {
                ...current,
                updating: true,
                lastError: null,
              }
            : current
        );
      } else {
        await loadMaestroUpdateStatus();
      }
    } catch (err) {
      setMaestroUpdateMessage(err instanceof Error ? err.message : "Failed to start Maestro update");
    } finally {
      setUpdatingMaestro(false);
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
                <CardTitle className="text-sm">Updates</CardTitle>
                <CardDescription>
                  Check for and trigger self-updates for the bare-metal global npm install of Maestro.
                </CardDescription>
              </div>
              {maestroUpdateStatus?.updating && (
                <Badge variant="secondary">
                  <LoaderIcon className="mr-1 size-3 animate-spin" />
                  Updating
                </Badge>
              )}
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {!maestroUpdateStatus?.supported ? (
                <Alert>
                  <TriangleAlertIcon />
                  <AlertTitle>Self-update unavailable</AlertTitle>
                  <AlertDescription>
                    {maestroUpdateStatus?.lastError ??
                      "Maestro self-update is only available for the published global npm install on bare metal."}
                  </AlertDescription>
                </Alert>
              ) : (
                <>
                  <FieldGroup>
                    <Field orientation="horizontal">
                      <FieldLabel>Current version</FieldLabel>
                      <FieldContent className="items-end">
                        <span className="font-mono text-xs">
                          {maestroUpdateStatus.currentVersion ?? "Unknown"}
                        </span>
                      </FieldContent>
                    </Field>
                    <FieldSeparator />
                    <Field orientation="horizontal">
                      <FieldLabel>Latest version</FieldLabel>
                      <FieldContent className="items-end">
                        <span className="font-mono text-xs">
                          {maestroUpdateStatus.latestVersion ?? "Unavailable"}
                        </span>
                        {maestroUpdateStatus.updateAvailable && (
                          <Badge variant="secondary" className="text-xs">
                            Update available
                          </Badge>
                        )}
                      </FieldContent>
                    </Field>
                    {maestroUpdateStatus.lastCheckedAt && (
                      <>
                        <FieldSeparator />
                        <Field orientation="horizontal">
                          <FieldLabel>Last checked</FieldLabel>
                          <FieldContent className="items-end">
                            <span className="text-xs text-muted-foreground">
                              {new Date(maestroUpdateStatus.lastCheckedAt).toLocaleString()}
                            </span>
                          </FieldContent>
                        </Field>
                      </>
                    )}
                    {maestroUpdateStatus.lastUpdatedAt && (
                      <>
                        <FieldSeparator />
                        <Field orientation="horizontal">
                          <FieldLabel>Last updated</FieldLabel>
                          <FieldContent className="items-end">
                            <span className="text-xs text-muted-foreground">
                              {new Date(maestroUpdateStatus.lastUpdatedAt).toLocaleString()}
                            </span>
                          </FieldContent>
                        </Field>
                      </>
                    )}
                  </FieldGroup>

                  {maestroUpdateStatus.lastError && (
                    <Alert variant="destructive">
                      <TriangleAlertIcon />
                      <AlertTitle>Maestro update error</AlertTitle>
                      <AlertDescription>{maestroUpdateStatus.lastError}</AlertDescription>
                    </Alert>
                  )}

                  {maestroUpdateMessage && (
                    <Alert>
                      <TriangleAlertIcon />
                      <AlertTitle>Maestro update</AlertTitle>
                      <AlertDescription>{maestroUpdateMessage}</AlertDescription>
                    </Alert>
                  )}
                </>
              )}

              <div className="flex flex-col gap-2 sm:flex-row">
                <Button
                  variant="outline"
                  disabled={checkingMaestro}
                  onClick={() => void handleCheckMaestroUpdate()}
                >
                  {checkingMaestro ? (
                    <LoaderIcon className="mr-2 size-4 animate-spin" />
                  ) : (
                    <RefreshCwIcon className="mr-2 size-4" />
                  )}
                  Check for Update
                </Button>
                <Button
                  disabled={
                    updatingMaestro ||
                    !maestroUpdateStatus?.supported ||
                    maestroUpdateStatus.updating ||
                    !maestroUpdateStatus.updateAvailable
                  }
                  onClick={() => void handleUpdateMaestro()}
                >
                  {updatingMaestro ? (
                    <LoaderIcon className="mr-2 size-4 animate-spin" />
                  ) : (
                    <DownloadIcon className="mr-2 size-4" />
                  )}
                  Update Maestro
                </Button>
              </div>

              <FieldDescription>
                Maestro restarts itself after a successful update. Expect the connection to drop briefly while the server comes back up.
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

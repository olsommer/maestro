"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TriangleAlertIcon, RefreshCwIcon, DownloadIcon, LoaderIcon, CheckCircleIcon, EyeIcon, EyeOffIcon } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { api, type Settings, type UpdateStatus, type OllamaModelInfo, type OllamaPullStatus, type OllamaStatus } from "@/lib/api";
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
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from "@/components/ui/field";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
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
              <Field orientation="horizontal">
                <div>
                  <FieldLabel>Model</FieldLabel>
                  <FieldDescription>
                    Select a locally available model or download a new one.
                  </FieldDescription>
                </div>
                <FieldContent className="items-end">
                  <Select value={selectedModel} onValueChange={(v) => { if (v != null) setSelectedModel(v); }}>
                    <SelectTrigger className="w-[200px]">
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
                  <Field orientation="horizontal">
                    <div>
                      <FieldLabel>Model name</FieldLabel>
                      <FieldDescription>
                        Include quantization in the tag, e.g. llama3.2:q4_K_M
                      </FieldDescription>
                    </div>
                    <FieldContent className="items-end">
                      <input
                        type="text"
                        className="h-9 w-[200px] rounded-md border border-input bg-background px-3 text-sm"
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
                  <Field orientation="horizontal">
                    <FieldLabel>Active model</FieldLabel>
                    <FieldContent className="items-end">
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
          <Field orientation="horizontal">
            <div>
              <FieldLabel>Bot Token</FieldLabel>
              <FieldDescription>
                Get a token from @BotFather on Telegram.
              </FieldDescription>
            </div>
            <FieldContent className="items-end">
              <div className="flex items-center gap-2">
                <input
                  type={showToken ? "text" : "password"}
                  className="h-9 w-[260px] rounded-md border border-input bg-background px-3 font-mono text-xs"
                  placeholder="123456:ABC-DEF..."
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-9"
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

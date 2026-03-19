"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { TriangleAlertIcon } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";

const DEFAULT_SERVER_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:4800";

export default function ConnectPage() {
  const router = useRouter();
  const { hydrate, hydrated, token, setToken, serverUrl, setServerUrl } = useAuth();
  const [apiToken, setApiToken] = useState("");
  const [targetServerUrl, setTargetServerUrl] = useState(DEFAULT_SERVER_URL);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    if (search.get("error") === "invalid-token") {
      setError("Your stored token is no longer valid. Enter the current API token.");
    }
  }, []);

  useEffect(() => {
    if (hydrated) {
      setTargetServerUrl(serverUrl || DEFAULT_SERVER_URL);
    }
  }, [hydrated, serverUrl]);

  useEffect(() => {
    if (hydrated && token) {
      router.replace("/");
    }
  }, [hydrated, token, router]);

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    const normalizedServerUrl = targetServerUrl.trim().replace(/\/$/, "");

    if (!normalizedServerUrl) {
      setError("Enter your server URL");
      return;
    }

    if (!apiToken.trim()) {
      setError("Enter your API token");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await fetch(`${normalizedServerUrl}/api/terminals`, {
        headers: { Authorization: `Bearer ${apiToken.trim()}` },
      });
      if (res.status === 401) {
        throw new Error("Invalid API token");
      }
      if (!res.ok) {
        throw new Error(`Server error: ${res.status}`);
      }
      setServerUrl(normalizedServerUrl);
      setToken(apiToken.trim());
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="ascii-logo">Maestro</CardTitle>
          <CardDescription>Connect to your Maestro server</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleConnect} className="flex flex-col gap-5">
            {error && (
              <Alert variant="destructive">
                <TriangleAlertIcon />
                <AlertTitle>Could not connect</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="server-url">Server URL</FieldLabel>
                <Input
                  id="server-url"
                  type="url"
                  value={targetServerUrl}
                  onChange={(e) => setTargetServerUrl(e.target.value)}
                  placeholder={DEFAULT_SERVER_URL}
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="api-token">API Token</FieldLabel>
                <Input
                  id="api-token"
                  type="password"
                  value={apiToken}
                  onChange={(e) => setApiToken(e.target.value)}
                  placeholder="sym_..."
                  autoFocus
                />
                <FieldDescription>
                  Find your token at <code>~/.maestro/api-token</code>.
                </FieldDescription>
              </Field>
            </FieldGroup>

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Connecting..." : "Connect"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

const API_URL = process.env.MAESTRO_API_URL || "http://127.0.0.1:4800";
const API_TOKEN = process.env.MAESTRO_API_TOKEN || "";

export async function apiRequest(
  endpoint: string,
  method: "GET" | "POST" | "PATCH" | "DELETE" = "GET",
  body?: Record<string, unknown>
): Promise<unknown> {
  const url = `${API_URL}${endpoint}`;
  const headers: Record<string, string> = {};
  if (API_TOKEN) {
    headers.Authorization = `Bearer ${API_TOKEN}`;
  }
  if (body) {
    headers["Content-Type"] = "application/json";
  }

  const isLongPoll = endpoint.includes("/wait");
  const timeoutMs = isLongPoll ? 600_000 : 30_000;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const options: RequestInit = {
    method,
    headers,
    signal: controller.signal,
  };
  if (body) {
    options.body = JSON.stringify(body);
  }

  try {
    const response = await fetch(url, options);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        (data as { error?: string }).error || `API error: ${response.status}`
      );
    }

    return data;
  } finally {
    clearTimeout(timer);
  }
}

"use client";

import { getAuthToken, getServerUrl, invalidateAuth } from "./auth";

/**
 * Authenticated fetch wrapper for pages that use raw fetch.
 */
export function authFetch(path: string, options?: RequestInit): Promise<Response> {
  const token = getAuthToken();
  const hasBody = options?.body != null;
  return fetch(`${getServerUrl()}${path}`, {
    ...options,
    headers: {
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  }).then(async (res) => {
    if (res.status === 401) {
      const body = await res.json().catch(() => ({}));
      invalidateAuth();
      throw new Error(body.error || "Invalid token");
    }

    return res;
  });
}

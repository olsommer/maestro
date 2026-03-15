"use client";

import { create } from "zustand";

const STORAGE_KEY = "maestro_api_token";
const SERVER_URL_KEY = "maestro_server_url";
const DEFAULT_SERVER_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:4800";

interface AuthState {
  token: string | null;
  serverUrl: string;
  hydrated: boolean;
  hydrate: () => void;
  setToken: (token: string) => void;
  setServerUrl: (url: string) => void;
  logout: () => void;
  isAuthenticated: () => boolean;
}

export const useAuth = create<AuthState>((set, get) => ({
  token: null,
  serverUrl: DEFAULT_SERVER_URL,
  hydrated: false,

  hydrate: () => {
    if (get().hydrated || typeof window === "undefined") {
      return;
    }

    set({
      token: localStorage.getItem(STORAGE_KEY),
      serverUrl: localStorage.getItem(SERVER_URL_KEY) || DEFAULT_SERVER_URL,
      hydrated: true,
    });
  },

  setToken: (token) => {
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, token);
    }
    set({ token, hydrated: true });
  },

  setServerUrl: (url) => {
    if (typeof window !== "undefined") {
      localStorage.setItem(SERVER_URL_KEY, url);
    }
    set({ serverUrl: url, hydrated: true });
  },

  logout: () => {
    if (typeof window !== "undefined") {
      localStorage.removeItem(STORAGE_KEY);
    }
    set({ token: null, hydrated: true });
  },

  isAuthenticated: () => !!get().token,
}));

export function getAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(STORAGE_KEY);
}

export function getServerUrl(): string {
  if (typeof window === "undefined") return DEFAULT_SERVER_URL;
  return localStorage.getItem(SERVER_URL_KEY) || DEFAULT_SERVER_URL;
}

export function invalidateAuth(reason = "invalid-token") {
  useAuth.getState().logout();
  if (typeof window === "undefined") return;

  const target = `/connect?error=${encodeURIComponent(reason)}`;
  if (window.location.pathname !== "/connect") {
    window.location.replace(target);
  }
}

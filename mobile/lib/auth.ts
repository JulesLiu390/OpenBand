import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const SESSION_STORAGE_KEY = "openband.auth.session";

export const API_BASE_URL = (
  process.env.EXPO_PUBLIC_API_URL || "http://127.0.0.1:8000"
).replace(/\/$/, "");

export type AuthUser = {
  id: number;
  label: string;
  created_at: string;
};

export type AuthSession = {
  accessToken: string;
  refreshToken: string;
  tokenType: "bearer";
  accessExpiresAt: number;
  refreshExpiresAt: number;
  user: AuthUser;
};

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  token_type: "bearer";
  expires_in: number;
  refresh_expires_in: number;
  user: AuthUser;
};

type MeResponse = {
  user: AuthUser;
};

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

export async function loginWithInviteKey(key: string, deviceName: string): Promise<AuthSession> {
  const response = await fetch(apiUrl("/v1/auth/login"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ key, device_name: deviceName }),
  });
  await assertOk(response);
  return tokenResponseToSession((await response.json()) as TokenResponse);
}

export async function refreshAuthSession(refreshToken: string): Promise<AuthSession> {
  const response = await fetch(apiUrl("/v1/auth/refresh"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  await assertOk(response);
  return tokenResponseToSession((await response.json()) as TokenResponse);
}

export async function getMe(accessToken: string): Promise<AuthUser> {
  const response = await authFetch("/v1/me", accessToken);
  await assertOk(response);
  return ((await response.json()) as MeResponse).user;
}

export async function logoutSession(accessToken: string, refreshToken: string): Promise<void> {
  const response = await authFetch("/v1/me/logout", accessToken, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  await assertOk(response);
}

export function authFetch(path: string, accessToken: string, init: RequestInit = {}): Promise<Response> {
  return fetch(apiUrl(path), {
    ...init,
    headers: {
      ...(init.headers as Record<string, string> | undefined),
      Authorization: `Bearer ${accessToken}`,
    },
  });
}

export async function saveStoredSession(session: AuthSession): Promise<void> {
  await setStorageItem(SESSION_STORAGE_KEY, JSON.stringify(session));
}

export async function loadStoredSession(): Promise<AuthSession | null> {
  const value = await getStorageItem(SESSION_STORAGE_KEY);
  if (!value) {
    return null;
  }
  try {
    const session = JSON.parse(value) as AuthSession;
    if (session.refreshExpiresAt <= Date.now()) {
      await clearStoredSession();
      return null;
    }
    return session;
  } catch {
    await clearStoredSession();
    return null;
  }
}

export async function clearStoredSession(): Promise<void> {
  await deleteStorageItem(SESSION_STORAGE_KEY);
}

export function isAccessTokenFresh(session: AuthSession): boolean {
  return session.accessExpiresAt - 30_000 > Date.now();
}

function tokenResponseToSession(response: TokenResponse): AuthSession {
  const now = Date.now();
  return {
    accessToken: response.access_token,
    refreshToken: response.refresh_token,
    tokenType: response.token_type,
    accessExpiresAt: now + response.expires_in * 1000,
    refreshExpiresAt: now + response.refresh_expires_in * 1000,
    user: response.user,
  };
}

function apiUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
}

async function assertOk(response: Response): Promise<void> {
  if (response.ok) {
    return;
  }
  let message = `Request failed with status ${response.status}.`;
  const text = await response.text();
  try {
    const body = JSON.parse(text) as { detail?: string };
    if (body.detail) {
      message = body.detail;
    }
  } catch {
    if (text) {
      message = text;
    }
  }
  throw new ApiError(message, response.status);
}

async function getStorageItem(key: string): Promise<string | null> {
  if (Platform.OS === "web") {
    return globalThis.localStorage?.getItem(key) ?? null;
  }
  return SecureStore.getItemAsync(key);
}

async function setStorageItem(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") {
    globalThis.localStorage?.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function deleteStorageItem(key: string): Promise<void> {
  if (Platform.OS === "web") {
    globalThis.localStorage?.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

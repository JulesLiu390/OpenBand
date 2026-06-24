import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const SESSION_STORAGE_KEY = "openband.auth.session";
const API_BASE_STORAGE_KEY = "openband.api.base_url";
const ACCESS_REFRESH_SKEW_MS = 5 * 60 * 1000;

export const DEFAULT_API_BASE_URL = (
  process.env.EXPO_PUBLIC_API_URL || "http://127.0.0.1:8000"
).replace(/\/$/, "");
export const API_BASE_URL = DEFAULT_API_BASE_URL;

let activeApiBaseUrl = DEFAULT_API_BASE_URL;
let refreshInFlight: Promise<AuthSession> | null = null;

const sessionListeners = new Set<(session: AuthSession | null) => void>();

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
  apiBaseUrl: string;
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

export function subscribeAuthSession(listener: (session: AuthSession | null) => void): () => void {
  sessionListeners.add(listener);
  return () => {
    sessionListeners.delete(listener);
  };
}

export async function loginWithInviteKey(
  key: string,
  deviceName: string,
  apiBaseUrl?: string,
): Promise<AuthSession> {
  const baseUrl = apiBaseUrl ? normalizeApiBaseUrl(apiBaseUrl) : getApiBaseUrl();
  const response = await fetch(apiUrl("/v1/auth/login", baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ key, device_name: deviceName }),
  });
  await assertOk(response);
  const session = tokenResponseToSession((await response.json()) as TokenResponse, baseUrl);
  await saveApiBaseUrl(baseUrl);
  return session;
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
  let currentAccessToken = accessToken;
  let currentRefreshToken = refreshToken;
  try {
    const storedSession = await loadStoredSession();
    if (storedSession?.refreshToken === refreshToken) {
      const freshSession = await ensureFreshSession({
        force: !isAccessTokenFresh(storedSession),
        storedSession,
      });
      currentAccessToken = freshSession.accessToken;
      currentRefreshToken = freshSession.refreshToken;
    }
  } catch {
    // Logout should still try to revoke the token pair the caller knows about.
  }

  const response = await fetch(apiUrl("/v1/me/logout"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${currentAccessToken}`,
    },
    body: JSON.stringify({ refresh_token: currentRefreshToken }),
  });
  await assertOk(response);
}

export async function authFetch(path: string, accessToken: string, init: RequestInit = {}): Promise<Response> {
  const freshAccessToken = await getFreshAccessToken(accessToken);
  const response = await fetchWithAccessToken(path, freshAccessToken, init);
  if (response.status !== 401) {
    return response;
  }

  try {
    const refreshedSession = await ensureFreshSession({ force: true });
    return fetchWithAccessToken(path, refreshedSession.accessToken, init);
  } catch {
    return response;
  }
}

export async function getFreshAccessToken(fallbackAccessToken?: string): Promise<string> {
  const storedSession = await loadStoredSession();
  if (!storedSession) {
    if (fallbackAccessToken) {
      return fallbackAccessToken;
    }
    throw new ApiError("Missing auth session.", 401);
  }

  try {
    const session = await ensureFreshSession({ storedSession });
    return session.accessToken;
  } catch (exc) {
    if (fallbackAccessToken && !(exc instanceof ApiError && (exc.status === 401 || exc.status === 403))) {
      return fallbackAccessToken;
    }
    throw exc;
  }
}

export async function saveStoredSession(session: AuthSession): Promise<void> {
  const sessionWithBaseUrl = { ...session, apiBaseUrl: normalizeApiBaseUrl(session.apiBaseUrl) };
  await saveApiBaseUrl(sessionWithBaseUrl.apiBaseUrl);
  await setStorageItem(SESSION_STORAGE_KEY, JSON.stringify(sessionWithBaseUrl));
  notifyAuthSessionChanged(sessionWithBaseUrl);
}

export async function loadStoredSession(): Promise<AuthSession | null> {
  const value = await getStorageItem(SESSION_STORAGE_KEY);
  if (!value) {
    return null;
  }
  try {
    const session = JSON.parse(value) as AuthSession;
    const apiBaseUrl = session.apiBaseUrl
      ? await saveApiBaseUrl(session.apiBaseUrl)
      : await loadStoredApiBaseUrl();
    return { ...session, apiBaseUrl };
  } catch {
    await clearStoredSession();
    return null;
  }
}

export async function clearStoredSession(): Promise<void> {
  await deleteStorageItem(SESSION_STORAGE_KEY);
  notifyAuthSessionChanged(null);
}

export function getApiBaseUrl(): string {
  return activeApiBaseUrl;
}

export async function loadStoredApiBaseUrl(): Promise<string> {
  const value = await getStorageItem(API_BASE_STORAGE_KEY);
  if (!value) {
    activeApiBaseUrl = DEFAULT_API_BASE_URL;
    return activeApiBaseUrl;
  }
  try {
    activeApiBaseUrl = normalizeApiBaseUrl(value);
  } catch {
    activeApiBaseUrl = DEFAULT_API_BASE_URL;
    await deleteStorageItem(API_BASE_STORAGE_KEY);
  }
  return activeApiBaseUrl;
}

export async function saveApiBaseUrl(value: string): Promise<string> {
  activeApiBaseUrl = normalizeApiBaseUrl(value);
  await setStorageItem(API_BASE_STORAGE_KEY, activeApiBaseUrl);
  return activeApiBaseUrl;
}

export function normalizeApiBaseUrl(value: string): string {
  const trimmedValue = value.trim().replace(/\/+$/, "");
  if (!trimmedValue) {
    throw new Error("Missing API base URL.");
  }
  const parsed = new URL(trimmedValue);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("API base URL must start with http:// or https://.");
  }
  return parsed.toString().replace(/\/$/, "");
}

export function isAccessTokenFresh(session: AuthSession): boolean {
  return session.accessExpiresAt - ACCESS_REFRESH_SKEW_MS > Date.now();
}

function isRefreshTokenFresh(session: AuthSession): boolean {
  return session.refreshExpiresAt - ACCESS_REFRESH_SKEW_MS > Date.now();
}

async function ensureFreshSession(
  options: { force?: boolean; storedSession?: AuthSession } = {},
): Promise<AuthSession> {
  const storedSession = options.storedSession ?? (await loadStoredSession());
  if (!storedSession) {
    throw new ApiError("Missing auth session.", 401);
  }

  if (!options.force && isAccessTokenFresh(storedSession)) {
    return storedSession;
  }

  if (!isRefreshTokenFresh(storedSession)) {
    await clearStoredSession();
    throw new ApiError("Refresh token has expired.", 401);
  }

  if (!refreshInFlight) {
    refreshInFlight = refreshAuthSession(storedSession.refreshToken)
      .then(async (session) => {
        await saveStoredSession(session);
        return session;
      })
      .catch(async (exc) => {
        if (exc instanceof ApiError && (exc.status === 401 || exc.status === 403)) {
          await clearStoredSession();
        }
        throw exc;
      })
      .finally(() => {
        refreshInFlight = null;
      });
  }

  return refreshInFlight;
}

function tokenResponseToSession(response: TokenResponse, apiBaseUrl = getApiBaseUrl()): AuthSession {
  const now = Date.now();
  return {
    accessToken: response.access_token,
    refreshToken: response.refresh_token,
    tokenType: response.token_type,
    accessExpiresAt: now + response.expires_in * 1000,
    refreshExpiresAt: now + response.refresh_expires_in * 1000,
    user: response.user,
    apiBaseUrl,
  };
}

function apiUrl(path: string, apiBaseUrl = getApiBaseUrl()): string {
  return `${apiBaseUrl}${path}`;
}

function fetchWithAccessToken(path: string, accessToken: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);
  return fetch(apiUrl(path), {
    ...init,
    headers,
  });
}

function notifyAuthSessionChanged(session: AuthSession | null): void {
  for (const listener of sessionListeners) {
    listener(session);
  }
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

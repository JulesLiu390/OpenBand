import { PropsWithChildren, createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Platform } from "react-native";

import {
  AuthSession,
  AuthUser,
  clearStoredSession,
  getMe,
  isAccessTokenFresh,
  loadStoredSession,
  loginWithInviteKey,
  logoutSession,
  refreshAuthSession,
  saveStoredSession,
} from "@/lib/auth";

type AuthContextValue = {
  user: AuthUser | null;
  session: AuthSession | null;
  loading: boolean;
  isAuthenticated: boolean;
  login: (key: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const applySession = useCallback(async (nextSession: AuthSession) => {
    setSession(nextSession);
    setUser(nextSession.user);
    await saveStoredSession(nextSession);
  }, []);

  useEffect(() => {
    let mounted = true;

    async function restoreSession() {
      try {
        const storedSession = await loadStoredSession();
        if (!storedSession) {
          return;
        }

        if (isAccessTokenFresh(storedSession)) {
          const currentUser = await getMe(storedSession.accessToken);
          if (mounted) {
            setSession({ ...storedSession, user: currentUser });
            setUser(currentUser);
          }
          return;
        }

        const refreshedSession = await refreshAuthSession(storedSession.refreshToken);
        if (mounted) {
          setSession(refreshedSession);
          setUser(refreshedSession.user);
        }
        await saveStoredSession(refreshedSession);
      } catch {
        await clearStoredSession();
        if (mounted) {
          setSession(null);
          setUser(null);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    restoreSession();

    return () => {
      mounted = false;
    };
  }, []);

  const login = useCallback(
    async (key: string) => {
      const nextSession = await loginWithInviteKey(key, `OpenBand ${Platform.OS}`);
      await applySession(nextSession);
    },
    [applySession],
  );

  const logout = useCallback(async () => {
    const currentSession = session;
    setSession(null);
    setUser(null);
    await clearStoredSession();
    if (!currentSession) {
      return;
    }
    try {
      await logoutSession(currentSession.accessToken, currentSession.refreshToken);
    } catch {
      // Local logout should succeed even if the access token has already expired.
    }
  }, [session]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      session,
      loading,
      isAuthenticated: Boolean(user && session),
      login,
      logout,
    }),
    [loading, login, logout, session, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used inside AuthProvider.");
  }
  return value;
}

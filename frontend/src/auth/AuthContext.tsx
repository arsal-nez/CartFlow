import { jwtDecode } from 'jwt-decode';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import * as authService from './authService';
import {
  getSession,
  isSessionExpired,
  setSession,
  subscribeToSession,
  type StoredSession,
} from './tokenStore';

export interface AuthUser {
  userId: string;
  email: string | null;
  isAdmin: boolean;
}

interface IdTokenClaims {
  sub: string;
  email?: string;
  'cognito:groups'?: string[];
  exp: number;
}

function toUser(idToken: string): AuthUser | null {
  try {
    const claims = jwtDecode<IdTokenClaims>(idToken);
    return {
      userId: claims.sub,
      email: claims.email ?? null,
      isAdmin: (claims['cognito:groups'] ?? []).includes('admin'),
    };
  } catch {
    return null;
  }
}

function toStoredSession(tokens: {
  idToken: string;
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
}): StoredSession {
  return {
    idToken: tokens.idToken,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: Date.now() + tokens.expiresInSeconds * 1000,
  };
}

export interface AuthContextValue {
  user: AuthUser | null;
  isAuthenticated: boolean;
  /** True until the app has finished checking for (and, if needed, refreshing) an existing session. */
  isInitializing: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<{ userConfirmed: boolean }>;
  confirmSignUp: (email: string, code: string) => Promise<void>;
  resendConfirmationCode: (email: string) => Promise<void>;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSessionState] = useState<StoredSession | null>(() => getSession());
  const [isInitializing, setIsInitializing] = useState(true);

  useEffect(() => subscribeToSession(setSessionState), []);

  // On load, a stored-but-expired session is refreshed once before the rest
  // of the app renders as "signed in" or "signed out" — otherwise a user who
  // left a tab open overnight would flash into a broken authenticated state.
  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      const current = getSession();
      if (current !== null && isSessionExpired(current)) {
        try {
          const refreshed = await authService.refreshSession(current.refreshToken);
          if (!cancelled) {
            setSession({
              ...current,
              idToken: refreshed.idToken,
              accessToken: refreshed.accessToken,
              expiresAt: Date.now() + refreshed.expiresInSeconds * 1000,
            });
          }
        } catch {
          if (!cancelled) {
            setSession(null);
          }
        }
      }
      if (!cancelled) {
        setIsInitializing(false);
      }
    }

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, []);

  const user = useMemo(() => (session === null ? null : toUser(session.idToken)), [session]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAuthenticated: user !== null,
      isInitializing,
      async signIn(email, password) {
        const tokens = await authService.signIn(email, password);
        setSession(toStoredSession(tokens));
      },
      async signUp(email, password) {
        return authService.signUp(email, password);
      },
      async confirmSignUp(email, code) {
        await authService.confirmSignUp(email, code);
      },
      async resendConfirmationCode(email) {
        await authService.resendConfirmationCode(email);
      },
      signOut() {
        setSession(null);
      },
    }),
    [user, isInitializing],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

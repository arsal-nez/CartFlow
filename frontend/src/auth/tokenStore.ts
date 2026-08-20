/**
 * The single place that holds the signed-in session. `AuthContext` writes to
 * it on sign-in/sign-out; `api/client.ts` reads from it to attach the
 * `Authorization` header. Kept as a plain module (not React state) so the
 * API client — which has no reason to know about React — can read the
 * current token without importing the auth context and risking a circular
 * dependency between `api/` and `auth/`.
 */

export interface StoredSession {
  idToken: string;
  accessToken: string;
  refreshToken: string;
  /** Epoch milliseconds. Derived from the token's `exp` claim at sign-in time. */
  expiresAt: number;
}

const STORAGE_KEY = 'cartflow.session.v1';

function loadFromStorage(): StoredSession | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'idToken' in parsed &&
      'accessToken' in parsed &&
      'refreshToken' in parsed &&
      'expiresAt' in parsed
    ) {
      return parsed as StoredSession;
    }
    return null;
  } catch {
    return null;
  }
}

let currentSession: StoredSession | null = loadFromStorage();
type Listener = (session: StoredSession | null) => void;
const listeners = new Set<Listener>();

export function getSession(): StoredSession | null {
  return currentSession;
}

export function isSessionExpired(session: StoredSession, skewMs = 30_000): boolean {
  return Date.now() >= session.expiresAt - skewMs;
}

export function setSession(session: StoredSession | null): void {
  currentSession = session;
  if (session === null) {
    window.localStorage.removeItem(STORAGE_KEY);
  } else {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  }
  for (const listener of listeners) {
    listener(currentSession);
  }
}

/** Lets `AuthContext` react to a session change made elsewhere (e.g. another browser tab). */
export function subscribeToSession(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

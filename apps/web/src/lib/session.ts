// Anonymous session persistence. The session id + username live in
// sessionStorage so a reload can resume; closing the tab ends the session.

export interface ChatSession {
  sessionId: string;
  username: string;
  accountType: 'guest' | 'user';
}

const KEY = 'chitchat:session';

export function loadSession(): ChatSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ChatSession;
    if (typeof parsed.sessionId === 'string' && typeof parsed.username === 'string') {
      // Sessions saved before accountType existed are guests.
      if (parsed.accountType !== 'user') parsed.accountType = 'guest';
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function saveSession(s: ChatSession): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable — session simply won't survive reload */
  }
}

export function clearSession(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

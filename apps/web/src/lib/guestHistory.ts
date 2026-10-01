// Guest chat history: stored only in this browser's cache (localStorage).
// Signed-in users get server-side history instead (see /history).
// Nothing here ever leaves the device.

export interface GuestChatMessage {
  id: string;
  sender: string;
  text: string;
  ts: number;
  mine: boolean;
}

export interface GuestChat {
  roomId: string;
  partnerUsername: string;
  messages: GuestChatMessage[];
  endedAt: number;
}

const KEY = 'chitchat:guest_history';
const MAX_CHATS = 50;

export function loadGuestHistory(): GuestChat[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as GuestChat[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Append a finished chat (newest first), capped at MAX_CHATS. */
export function saveGuestChat(chat: GuestChat): void {
  if (chat.messages.length === 0) return;
  try {
    const prev = loadGuestHistory().filter((c) => c.roomId !== chat.roomId);
    const next = [chat, ...prev].slice(0, MAX_CHATS);
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage full or unavailable — history simply isn't kept */
  }
}

export function clearGuestHistory(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

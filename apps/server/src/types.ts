// Shared domain types for the ChitChat server.

export type SessionStatus = 'online' | 'queued' | 'chatting' | 'offline';

export interface Session {
  id: string;
  username: string;
  /** Current socket id, or null when disconnected. */
  socketId: string | null;
  status: SessionStatus;
  roomId: string | null;
  createdAt: number;
  lastSeen: number;
  /** Timestamps of recent "next" presses (suspicious-activity detection). */
  nextPresses: number[];
  /** Accumulated suspicion score from spam/link/profanity signals. */
  suspicion: number;
  /** Last message text, used for duplicate-spam detection. */
  lastMessageText: string;
  lastMessageAt: number;
  /** Client IP at session start (best-effort; used for moderation blocks). */
  ip?: string;
  /** 'user' for signed-in accounts, 'guest' for anonymous sessions. */
  accountType: 'guest' | 'user';
  /** Supabase auth user id, set only for signed-in accounts. */
  userId?: string;
  /** Persistent guest id from the client's cache, set only for guests. */
  guestId?: string;
}

export interface Room {
  id: string;
  /** Session ids of the two participants. Never exposed to clients directly. */
  a: string;
  b: string;
  createdAt: number;
  endedAt: number | null;
  endReason: string | null;
}

export interface QueueMember {
  sessionId: string;
  username: string;
  joinedAt: number;
}

export type RoomEndReason =
  | 'next'
  | 'leave'
  | 'disconnect'
  | 'blocked'
  | 'error';

// ── Socket.IO event payloads (client → server) ──────────────────────────────

export interface ClientToServerEvents {
  'session:start': (payload: {
    turnstileToken?: string;
    nickname?: string;
    /** Persistent guest id from the client's cache (guest sessions). */
    guestId?: string;
    /** Supabase access token (signed-in users). */
    authToken?: string;
  }) => void;
  'session:resume': (payload: { sessionId: string }) => void;
  'queue:join': () => void;
  'queue:leave': () => void;
  'message:send': (payload: { text: string }) => void;
  'typing:start': () => void;
  'typing:stop': () => void;
  'chat:next': () => void;
  'chat:leave': () => void;
  'user:report': (payload: { reason: string; details?: string }) => void;
  'user:block': () => void;
  'presence:ping': () => void;
}

// ── Socket.IO event payloads (server → client) ──────────────────────────────

export interface ChatMessage {
  id: string;
  /** Anonymous username of the sender (never a database id or IP). */
  sender: string;
  text: string;
  ts: number;
}

export interface ServerToClientEvents {
  'session:ready': (payload: { sessionId: string; username: string; accountType: 'guest' | 'user' }) => void;
  'session:error': (payload: { code: string; message: string }) => void;
  'queue:joined': (payload: { position: number }) => void;
  'queue:left': () => void;
  'queue:error': (payload: { code: string; message: string }) => void;
  'match:found': (payload: { roomId: string; partnerUsername: string }) => void;
  'room:restored': (payload: { roomId: string; partnerUsername: string }) => void;
  'room:ended': (payload: { reason: RoomEndReason }) => void;
  'partner:left': (payload: { reason: 'next' | 'leave' | 'disconnect' }) => void;
  'message:new': (payload: ChatMessage) => void;
  'message:sent': (payload: { id: string; ts: number }) => void;
  'message:error': (payload: { code: string; message: string }) => void;
  'typing:update': (payload: { username: string; typing: boolean }) => void;
  'next:searching': () => void;
  'report:ok': () => void;
  'report:error': (payload: { code: string; message: string }) => void;
  'block:ok': () => void;
  'presence:pong': () => void;
  error: (payload: { code: string; message: string }) => void;
}

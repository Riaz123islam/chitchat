// Optional Supabase persistence (PostgreSQL) via the PostgREST REST API.
// No heavy client library needed — plain fetch with the service-role key.
// Every call is fire-and-forget safe: when Supabase is not configured, or a
// request fails, the function resolves false and the app keeps running on
// in-memory state. Chat message content is NEVER written here.

import { config } from './config.js';

async function postgrest(
  path: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body: unknown,
  prefer = 'return=minimal',
): Promise<boolean> {
  if (!config.useSupabase) return false;
  try {
    const res = await fetch(`${config.supabaseUrl}/rest/v1/${path}`, {
      method,
      headers: {
        apikey: config.supabaseServiceKey,
        Authorization: `Bearer ${config.supabaseServiceKey}`,
        'Content-Type': 'application/json',
        Prefer: prefer,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function getJson(path: string): Promise<unknown[] | null> {
  if (!config.useSupabase) return null;
  try {
    const res = await fetch(`${config.supabaseUrl}/rest/v1/${path}`, {
      headers: {
        apikey: config.supabaseServiceKey,
        Authorization: `Bearer ${config.supabaseServiceKey}`,
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    return (await res.json()) as unknown[];
  } catch {
    return null;
  }
}

export interface ChatHistoryRow {
  id: string;
  username: string;
  room_id: string;
  partner_username: string;
  messages: Array<{ id: string; sender: string; text: string; ts: number }>;
  end_reason: string | null;
  ended_at: string;
}

export const db = {
  /** Best-effort session registry (metadata only). */
  upsertSession(id: string, username: string, status: string): Promise<boolean> {
    return postgrest(
      'anonymous_sessions',
      'POST',
      { id, anonymous_username: username, status, last_seen: new Date().toISOString() },
      'return=minimal,resolution=merge-duplicates',
    );
  },

  setSessionStatus(id: string, status: string): Promise<boolean> {
    return postgrest(`anonymous_sessions?id=eq.${id}`, 'PATCH', {
      status,
      last_seen: new Date().toISOString(),
    });
  },

  /** Room metadata only — no message content is ever persisted. */
  insertRoom(id: string, userA: string, userB: string): Promise<boolean> {
    return postgrest('chat_rooms', 'POST', { id, user_a: userA, user_b: userB, status: 'active' });
  },

  endRoom(id: string, reason: string): Promise<boolean> {
    return postgrest(`chat_rooms?id=eq.${id}`, 'PATCH', {
      status: 'ended',
      end_reason: reason,
      ended_at: new Date().toISOString(),
    });
  },

  /** Report metadata only — never message text. */
  insertReport(
    reporterId: string,
    reportedUserId: string,
    roomId: string | null,
    reason: string,
  ): Promise<boolean> {
    return postgrest('reports', 'POST', {
      reporter_id: reporterId,
      reported_user_id: reportedUserId,
      room_id: roomId,
      reason,
    });
  },

  insertBlock(blockerId: string, blockedId: string): Promise<boolean> {
    return postgrest('blocks', 'POST', { blocker_id: blockerId, blocked_id: blockedId });
  },

  /**
   * Persist one participant's view of an ended chat. Only called for
   * signed-in users — guests keep their history on their own device.
   * The messages come from the in-memory moderation buffer (never disk).
   */
  insertChatHistory(entry: {
    userId: string;
    /** The owner's anonymous username in that chat (for mine/theirs display). */
    username: string;
    roomId: string;
    partnerUsername: string;
    messages: Array<{ id: string; sender: string; text: string; ts: number }>;
    endReason: string;
  }): Promise<boolean> {
    return postgrest('chat_history', 'POST', {
      user_id: entry.userId,
      username: entry.username,
      room_id: entry.roomId,
      partner_username: entry.partnerUsername,
      messages: entry.messages,
      end_reason: entry.endReason,
    });
  },

  /** Most recent chats for a signed-in user, newest first. */
  async getChatHistory(userId: string, limit = 50): Promise<ChatHistoryRow[] | null> {
    const rows = await getJson(
      `chat_history?user_id=eq.${encodeURIComponent(userId)}&order=ended_at.desc&limit=${limit}`,
    );
    return Array.isArray(rows) ? (rows as ChatHistoryRow[]) : null;
  },

  /** Delete all history rows for a user (account deletion). */
  deleteChatHistory(userId: string): Promise<boolean> {
    return postgrest(
      `chat_history?user_id=eq.${encodeURIComponent(userId)}`,
      'DELETE',
      undefined,
    );
  },

  /**
   * Delete moderation/session metadata older than 30 days. Runs on a daily
   * timer in server.ts; no-op when Supabase is not configured. Best-effort:
   * failures are swallowed so the chat server is never affected.
   */
  async purgeOldData(): Promise<boolean> {
    if (!config.useSupabase) return false;
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString();
    const tables: Array<[string, string]> = [
      ['reports', 'created_at'],
      ['blocks', 'created_at'],
      ['chat_rooms', 'created_at'],
      ['anonymous_sessions', 'last_seen'],
    ];
    const results = await Promise.all(
      tables.map(([table, col]) =>
        postgrest(`${table}?${col}=lt.${encodeURIComponent(cutoff)}`, 'DELETE', undefined),
      ),
    );
    return results.every(Boolean);
  },
};

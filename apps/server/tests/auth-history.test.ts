// Tests for guest/account identity, Supabase auth paths, and chat history:
// guest-id validation, session:start identity wiring, history API
// authorization, and per-user history persistence on room end.
//
// Supabase auth is mocked: 'token-a'/'token-b' map to two distinct users,
// anything else is an invalid token. This exercises the signed-in path
// without real Supabase credentials.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { io as clientIo, type Socket as ClientSocket } from 'socket.io-client';

vi.mock('../src/auth.js', () => ({
  verifySupabaseToken: vi.fn(async (token: unknown) => {
    if (token === 'token-a') return { id: 'user-a', email: 'a@example.com' };
    if (token === 'token-b') return { id: 'user-b', email: 'b@example.com' };
    return null;
  }),
  deleteAuthUser: vi.fn(async () => true),
}));

import { createServer } from '../src/server.js';
import type { CreatedServer } from '../src/server.js';
import { db } from '../src/db.js';
import { sanitizeGuestId } from '../src/identity.js';
import * as authModule from '../src/auth.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockedAuth = authModule as any;

function once<T>(socket: ClientSocket, event: string, timeoutMs = 8000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`timed out waiting for "${event}"`));
    }, timeoutMs);
    const handler = (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    };
    socket.once(event, handler as (...args: unknown[]) => void);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe('sanitizeGuestId', () => {
  it('accepts plausible browser ids', () => {
    expect(sanitizeGuestId('g-8f3k2n9xQ7')).toBe('g-8f3k2n9xQ7');
    expect(sanitizeGuestId('  abc12345  ')).toBe('abc12345');
    expect(sanitizeGuestId('under_score-dash.9')).toBeNull(); // dot not allowed
  });

  it('rejects missing or malformed ids', () => {
    expect(sanitizeGuestId(undefined)).toBeNull();
    expect(sanitizeGuestId(123)).toBeNull();
    expect(sanitizeGuestId('short')).toBeNull();
    expect(sanitizeGuestId('x'.repeat(65))).toBeNull();
    expect(sanitizeGuestId('has space 12')).toBeNull();
    expect(sanitizeGuestId('<script>alert(1)</script>')).toBeNull();
  });
});

describe('Supabase token verification (unconfigured)', () => {
  it('verifySupabaseToken returns null when token missing/invalid', async () => {
    // The mock rejects everything except the two fixture tokens.
    expect(await mockedAuth.verifySupabaseToken(undefined)).toBeNull();
    expect(await mockedAuth.verifySupabaseToken('')).toBeNull();
    expect(await mockedAuth.verifySupabaseToken('garbage')).toBeNull();
  });

  it('deleteAuthUser honors the mock', async () => {
    expect(await mockedAuth.deleteAuthUser('user-a')).toBe(true);
  });
});

describe('session identity wiring', () => {
  let srv: CreatedServer;
  let port: number;
  let sockets: ClientSocket[];

  beforeEach(async () => {
    sockets = [];
    srv = createServer();
    port = await srv.start(0);
  });

  afterEach(async () => {
    for (const s of sockets) {
      try {
        if (s.connected) s.disconnect();
      } catch {
        /* ignore */
      }
    }
    await srv.stop();
  });

  async function newClient(): Promise<ClientSocket> {
    const socket = clientIo(`http://127.0.0.1:${port}`, {
      transports: ['websocket'],
      reconnection: false,
    });
    sockets.push(socket);
    await once(socket, 'connect');
    return socket;
  }

  it('defaults to guest when no identity is provided', async () => {
    const s = await newClient();
    s.emit('session:start', {});
    const ready = await once<{ accountType: string }>(s, 'session:ready');
    expect(ready.accountType).toBe('guest');
  });

  it('accepts a guestId and stays a guest', async () => {
    const s = await newClient();
    s.emit('session:start', { guestId: 'g-abc12345' });
    const ready = await once<{ accountType: string }>(s, 'session:ready');
    expect(ready.accountType).toBe('guest');
  });

  it('rejects an invalid authToken without leaking a session', async () => {
    const s = await newClient();
    s.emit('session:start', { authToken: 'definitely-not-a-token' });
    const err = await once<{ code: string }>(s, 'session:error');
    expect(err.code).toBe('auth_invalid');
    // Server dropped the socket, so a second start on a fresh socket works.
    const s2 = await newClient();
    s2.emit('session:start', {});
    const ready = await once<{ accountType: string }>(s2, 'session:ready');
    expect(ready.accountType).toBe('guest');
  });

  it('upgrades to a user session with a valid token', async () => {
    const s = await newClient();
    s.emit('session:start', { authToken: 'token-a' });
    const ready = await once<{ accountType: string }>(s, 'session:ready');
    expect(ready.accountType).toBe('user');
  });
});

describe('history API authorization', () => {
  let srv: CreatedServer;
  let port: number;

  beforeEach(async () => {
    srv = createServer();
    port = await srv.start(0);
  });

  afterEach(async () => {
    await srv.stop();
  });

  it('GET /api/history requires a valid bearer token', async () => {
    const noAuth = await fetch(`http://127.0.0.1:${port}/api/history`);
    expect(noAuth.status).toBe(401);

    const bad = await fetch(`http://127.0.0.1:${port}/api/history`, {
      headers: { Authorization: 'Bearer garbage' },
    });
    expect(bad.status).toBe(401);
  });

  it('DELETE /api/account requires a valid bearer token', async () => {
    const noAuth = await fetch(`http://127.0.0.1:${port}/api/account`, {
      method: 'DELETE',
    });
    expect(noAuth.status).toBe(401);
  });

  it('GET /api/history returns the user chats with a valid token', async () => {
    const spy = vi.spyOn(db, 'getChatHistory').mockResolvedValue([]);
    const res = await fetch(`http://127.0.0.1:${port}/api/history`, {
      headers: { Authorization: 'Bearer token-a' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { chats: unknown[] };
    expect(body.chats).toEqual([]);
    // The query is scoped to the token's user id — never another user's.
    expect(spy).toHaveBeenCalledWith('user-a');
    spy.mockRestore();
  });
});

describe('history persistence on room end', () => {
  let srv: CreatedServer;
  let port: number;
  let sockets: ClientSocket[];

  beforeEach(async () => {
    sockets = [];
    srv = createServer();
    port = await srv.start(0);
  });

  afterEach(async () => {
    for (const s of sockets) {
      try {
        if (s.connected) s.disconnect();
      } catch {
        /* ignore */
      }
    }
    await srv.stop();
    vi.restoreAllMocks();
  });

  async function newClient(): Promise<ClientSocket> {
    const socket = clientIo(`http://127.0.0.1:${port}`, {
      transports: ['websocket'],
      reconnection: false,
    });
    sockets.push(socket);
    await once(socket, 'connect');
    return socket;
  }

  it('persists one row per signed-in participant when the room ends', async () => {
    const insertSpy = vi.spyOn(db, 'insertChatHistory').mockResolvedValue(true);

    const a = await newClient();
    const b = await newClient();
    a.emit('session:start', { authToken: 'token-a' });
    b.emit('session:start', { authToken: 'token-b' });
    const sa = await once<{ sessionId: string; username: string; accountType: string }>(
      a,
      'session:ready',
    );
    const sb = await once<{ sessionId: string; username: string; accountType: string }>(
      b,
      'session:ready',
    );
    expect(sa.accountType).toBe('user');
    expect(sb.accountType).toBe('user');

    const matchA = once<{ roomId: string; partnerUsername: string }>(a, 'match:found');
    const matchB = once<{ roomId: string; partnerUsername: string }>(b, 'match:found');
    a.emit('queue:join');
    b.emit('queue:join');
    const [ma, mb] = await Promise.all([matchA, matchB]);
    expect(ma.roomId).toBe(mb.roomId);

    // Exchange one message each.
    const recvB = once(b, 'message:new');
    a.emit('message:send', { text: 'hello from a' });
    await recvB;
    const recvA = once(a, 'message:new');
    b.emit('message:send', { text: 'hello from b' });
    await recvA;

    // A leaves → room ends → both participants' histories are saved.
    const left = once(b, 'partner:left');
    a.emit('chat:leave');
    await left;
    await sleep(400); // let the async persist run

    expect(insertSpy).toHaveBeenCalledTimes(2);
    const calls = insertSpy.mock.calls.map((c) => c[0]);
    const rowA = calls.find((c) => c.userId === 'user-a');
    const rowB = calls.find((c) => c.userId === 'user-b');
    expect(rowA).toBeDefined();
    expect(rowB).toBeDefined();
    expect(rowA!.username).toBe(sa.username);
    expect(rowA!.partnerUsername).toBe(sb.username);
    expect(rowB!.username).toBe(sb.username);
    expect(rowB!.partnerUsername).toBe(sa.username);
    expect(rowA!.messages).toHaveLength(2);
    // mine/theirs is stored per participant.
    expect(rowA!.messages[0]).toMatchObject({ sender: sa.username, text: 'hello from a', mine: true });
    expect(rowA!.messages[1]).toMatchObject({ sender: sb.username, text: 'hello from b', mine: false });
    expect(rowB!.messages[0]).toMatchObject({ sender: sa.username, text: 'hello from a', mine: false });
    expect(rowB!.messages[1]).toMatchObject({ sender: sb.username, text: 'hello from b', mine: true });
  });

  it('does not persist guest-only rooms', async () => {
    const insertSpy = vi.spyOn(db, 'insertChatHistory').mockResolvedValue(true);

    const a = await newClient();
    const b = await newClient();
    a.emit('session:start', {});
    b.emit('session:start', {});
    await once(a, 'session:ready');
    await once(b, 'session:ready');

    const matchA = once(a, 'match:found');
    const matchB = once(b, 'match:found');
    a.emit('queue:join');
    b.emit('queue:join');
    await Promise.all([matchA, matchB]);

    const recvB = once(b, 'message:new');
    a.emit('message:send', { text: 'guest hello' });
    await recvB;

    const left = once(b, 'partner:left');
    a.emit('chat:leave');
    await left;
    await sleep(400);

    expect(insertSpy).not.toHaveBeenCalled();
  });
});

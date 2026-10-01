// Admin moderation API tests: token auth, room/message inspection,
// explicit-content flagging, block/unblock, and re-entry prevention.
// Each test gets a FRESH server. ADMIN_TOKEN is read lazily by the server,
// so setting process.env here takes effect.

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { io as clientIo, type Socket as ClientSocket } from 'socket.io-client';
import { createServer, type CreatedServer } from '../src/server.js';
import { flagExplicit } from '../src/admin.js';

const ADMIN_TOKEN = 'test-admin-token-123';

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

describe('flagExplicit', () => {
  it('flags obvious explicit content and ignores normal chat', () => {
    expect(flagExplicit('send me your nudes')).toBe(true);
    expect(flagExplicit('check out my onlyfans')).toBe(true);
    expect(flagExplicit('hello, how are you today?')).toBe(false);
    expect(flagExplicit('I love hiking in the nude beaches of spain')).toBe(true); // word-boundary match
  });
});

describe('Admin API', () => {
  let srv: CreatedServer;
  let port: number;
  let sockets: ClientSocket[];

  beforeAll(() => {
    process.env.ADMIN_TOKEN = ADMIN_TOKEN;
  });

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
    process.env.ADMIN_TOKEN = ADMIN_TOKEN;
  });

  const adminFetch = (path: string, init?: RequestInit, token: string | null = ADMIN_TOKEN) =>
    fetch(`http://127.0.0.1:${port}/admin${path}`, {
      ...init,
      headers: {
        ...(token ? { 'x-admin-token': token } : {}),
        'content-type': 'application/json',
        ...(init?.headers ?? {}),
      },
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

  async function matchedPair() {
    const a = await newClient();
    const b = await newClient();
    a.emit('session:start', {});
    b.emit('session:start', {});
    const sa = await once<{ sessionId: string; username: string }>(a, 'session:ready');
    const sb = await once<{ sessionId: string; username: string }>(b, 'session:ready');
    const matchA = once<{ roomId: string; partnerUsername: string }>(a, 'match:found');
    const matchB = once<{ roomId: string; partnerUsername: string }>(b, 'match:found');
    a.emit('queue:join');
    b.emit('queue:join');
    const [ma, mb] = await Promise.all([matchA, matchB]);
    expect(ma.roomId).toBe(mb.roomId);
    return { a, b, sa, sb, roomId: ma.roomId };
  }

  it('rejects unauthenticated admin requests', async () => {
    expect((await adminFetch('/stats', {}, null)).status).toBe(401);
    expect((await adminFetch('/stats', {}, 'wrong-token')).status).toBe(401);
    expect((await adminFetch('/rooms', {}, null)).status).toBe(401);
  });

  it('returns 503 when ADMIN_TOKEN is unset', async () => {
    delete process.env.ADMIN_TOKEN;
    expect((await adminFetch('/stats')).status).toBe(503);
  });

  it('serves stats with a valid token', async () => {
    const res = await adminFetch('/stats');
    expect(res.status).toBe(200);
    const stats = (await res.json()) as { online: number; activeRooms: number };
    expect(typeof stats.online).toBe('number');
    expect(stats.activeRooms).toBe(0);
  });

  it('lists rooms and buffers messages with explicit flagging', async () => {
    const { a, roomId } = await matchedPair();
    a.emit('message:send', { text: 'hello there' });
    await once(a, 'message:sent');
    a.emit('message:send', { text: 'send me your nudes' });
    await once(a, 'message:sent');
    await sleep(200);

    const roomsRes = await adminFetch('/rooms');
    const { rooms } = (await roomsRes.json()) as {
      rooms: { roomId: string; messageCount: number; flaggedCount: number }[];
    };
    expect(rooms).toHaveLength(1);
    expect(rooms[0].roomId).toBe(roomId);
    expect(rooms[0].messageCount).toBe(2);
    expect(rooms[0].flaggedCount).toBe(1);

    const msgsRes = await adminFetch(`/rooms/${roomId}/messages`);
    const { messages } = (await msgsRes.json()) as {
      messages: { text: string; flagged: boolean; username: string }[];
    };
    expect(messages).toHaveLength(2);
    expect(messages[1].flagged).toBe(true);
    // Admin sees the raw text (pre-profanity-masking) for review.
    expect(messages[1].text).toBe('send me your nudes');
  });

  it('blocks a session: disconnects them, notifies partner, bars re-entry', async () => {
    const { a, b, sa } = await matchedPair();
    const partnerLeft = once<{ reason: string }>(b, 'partner:left');
    const disconnected = new Promise<void>((resolve) => {
      a.on('disconnect', () => resolve());
    });

    const blockRes = await adminFetch('/block', {
      method: 'POST',
      body: JSON.stringify({ sessionId: sa.sessionId, reason: 'test block' }),
    });
    expect(blockRes.status).toBe(200);
    const { disconnected: count } = (await blockRes.json()) as { disconnected: number };
    expect(count).toBe(1);

    await disconnected;
    const left = await partnerLeft;
    expect(left.reason).toBe('disconnect'); // partner never learns it was a block

    // Blocked session cannot resume or start a new session.
    const c = await newClient();
    c.emit('session:resume', { sessionId: sa.sessionId });
    const err = await once<{ code: string }>(c, 'session:error');
    expect(err.code).toBe('blocked');

    // Blocklist shows the block; unblock allows re-entry.
    const blocksRes = await adminFetch('/blocks');
    const { blocks } = (await blocksRes.json()) as { blocks: { sessionId?: string }[] };
    expect(blocks.some((x) => x.sessionId === sa.sessionId)).toBe(true);

    await adminFetch('/unblock', {
      method: 'POST',
      body: JSON.stringify({ sessionId: sa.sessionId }),
    });
    const d = await newClient();
    d.emit('session:start', {});
    const ready = await once<{ sessionId: string }>(d, 'session:ready');
    expect(ready.sessionId).toBeTruthy();
  });

  it('returns 400 when block has no target', async () => {
    const res = await adminFetch('/block', { method: 'POST', body: JSON.stringify({}) });
    expect(res.status).toBe(400);
  });
});

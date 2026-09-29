// End-to-end tests against a real server instance + real WebSocket clients.
// Covers: matchmaking, chat, next, disconnect, report/block, and the security
// matrix (unauthorized access, oversized/flood/duplicate/malicious messages,
// duplicate queue joins, invalid sessions).
//
// Each test gets a FRESH server: shared state (per-IP rate limiters, queued
// clients, active rooms) never leaks between tests.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io as clientIo, type Socket as ClientSocket } from 'socket.io-client';
import { createServer, type CreatedServer } from '../src/server.js';

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

interface SessionInfo {
  sessionId: string;
  username: string;
}

describe('ChitChat end-to-end', () => {
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

  async function startSession(socket: ClientSocket): Promise<SessionInfo> {
    socket.emit('session:start', {});
    return once<SessionInfo>(socket, 'session:ready');
  }

  async function joinQueue(socket: ClientSocket): Promise<{ position: number }> {
    socket.emit('queue:join');
    return once<{ position: number }>(socket, 'queue:joined');
  }

  async function matchedPair(): Promise<{
    a: ClientSocket;
    b: ClientSocket;
    sa: SessionInfo;
    sb: SessionInfo;
    roomId: string;
  }> {
    const a = await newClient();
    const b = await newClient();
    const sa = await startSession(a);
    const sb = await startSession(b);
    const matchA = once<{ roomId: string; partnerUsername: string }>(a, 'match:found');
    const matchB = once<{ roomId: string; partnerUsername: string }>(b, 'match:found');
    await joinQueue(a);
    await joinQueue(b);
    const [ma, mb] = await Promise.all([matchA, matchB]);
    expect(ma.roomId).toBe(mb.roomId);
    expect(ma.partnerUsername).toBe(sb.username);
    expect(mb.partnerUsername).toBe(sa.username);
    return { a, b, sa, sb, roomId: ma.roomId };
  }

  it('serves health and stats over HTTP', async () => {
    const health = (await (await fetch(`http://127.0.0.1:${port}/health`)).json()) as {
      ok: boolean;
    };
    expect(health.ok).toBe(true);
    const stats = (await (await fetch(`http://127.0.0.1:${port}/api/stats`)).json()) as {
      online: number;
      queued: number;
    };
    expect(typeof stats.online).toBe('number');
    expect(typeof stats.queued).toBe('number');
  });

  it('matches two waiting users; a third keeps waiting', async () => {
    const a = await newClient();
    const b = await newClient();
    const c = await newClient();
    const sa = await startSession(a);
    const sb = await startSession(b);
    await startSession(c);

    const matchA = once<{ roomId: string; partnerUsername: string }>(a, 'match:found');
    const matchB = once<{ roomId: string; partnerUsername: string }>(b, 'match:found');
    let cMatched = false;
    c.once('match:found', () => {
      cMatched = true;
    });

    await joinQueue(a);
    await sleep(150);
    await joinQueue(b);

    const [ma, mb] = await Promise.all([matchA, matchB]);
    expect(ma.roomId).toBe(mb.roomId);
    expect(ma.partnerUsername).toBe(sb.username);
    expect(mb.partnerUsername).toBe(sa.username);
    expect(ma.partnerUsername).not.toBe(sa.username); // never matched with self

    await joinQueue(c);
    await sleep(600);
    expect(cMatched).toBe(false);
  });

  it('relays messages both ways with typing indicators', async () => {
    const { a, b, sa } = await matchedPair();

    // A → B
    const recvB = once<{ sender: string; text: string; ts: number }>(b, 'message:new');
    const sentA = once<{ id: string; ts: number }>(a, 'message:sent');
    a.emit('message:send', { text: 'Hello stranger!' });
    const [msgB, ackA] = await Promise.all([recvB, sentA]);
    expect(msgB.text).toBe('Hello stranger!');
    expect(msgB.sender).toBe(sa.username);
    expect(typeof ackA.id).toBe('string');

    // B → A
    const recvA = once<{ sender: string; text: string }>(a, 'message:new');
    b.emit('message:send', { text: 'Hi! How is it going?' });
    const msgA = await recvA;
    expect(msgA.text).toBe('Hi! How is it going?');

    // Typing indicator
    const typing = once<{ username: string; typing: boolean }>(b, 'typing:update');
    a.emit('typing:start');
    const t = await typing;
    expect(t.typing).toBe(true);
    expect(t.username).toBe(sa.username);
  });

  it('next: ends the room, notifies the partner, re-queues the requester', async () => {
    const { a, b } = await matchedPair();
    const d = await newClient();
    const sd = await startSession(d);

    // A presses Next.
    const partnerLeft = once<{ reason: string }>(b, 'partner:left');
    const searching = once(a, 'next:searching');
    const rematch = once<{ roomId: string; partnerUsername: string }>(a, 'match:found');
    const dMatch = once<{ roomId: string; partnerUsername: string }>(d, 'match:found');
    a.emit('chat:next');

    const left = await partnerLeft;
    expect(left.reason).toBe('next');
    await searching;

    // D joins → matched with waiting A.
    await joinQueue(d);
    const [ra, rd] = await Promise.all([rematch, dMatch]);
    expect(ra.roomId).toBe(rd.roomId);
    expect(ra.partnerUsername).toBe(sd.username);
  });

  it('disconnect: the remaining user is informed and state is cleaned up', async () => {
    const { a, b } = await matchedPair();

    const left = once<{ reason: string }>(a, 'partner:left');
    b.disconnect();
    const evt = await left;
    expect(evt.reason).toBe('disconnect');

    // A can search again after the disconnect.
    const searching = once(a, 'next:searching');
    a.emit('chat:next');
    await searching;
  });

  it('rejects unauthorized and malformed chat actions', async () => {
    const e = await newClient();
    await startSession(e);

    // Not in a room → cannot send.
    const err1 = once<{ code: string }>(e, 'message:error');
    e.emit('message:send', { text: 'hello?' });
    expect((await err1).code).toBe('not_in_room');

    // Duplicate queue join.
    await joinQueue(e);
    const err2 = once<{ code: string }>(e, 'queue:error');
    e.emit('queue:join');
    expect((await err2).code).toBe('already_queued');

    // Invalid session resume.
    const f = await newClient();
    const err3 = once<{ code: string }>(f, 'session:error');
    f.emit('session:resume', { sessionId: 'not-a-uuid' });
    expect((await err3).code).toBe('invalid_session');

    const err4 = once<{ code: string }>(f, 'session:error');
    f.emit('session:resume', { sessionId: '12345678-1234-1234-1234-123456789012' });
    expect((await err4).code).toBe('unknown_session');
  });

  it('enforces message limits, flood protection, and duplicate blocking', async () => {
    const { a } = await matchedPair();

    const errors: string[] = [];
    a.on('message:error', (p: { code: string }) => errors.push(p.code));

    // Oversized.
    a.emit('message:send', { text: 'x'.repeat(501) });
    // Duplicate.
    a.emit('message:send', { text: 'same text twice' });
    a.emit('message:send', { text: 'same text twice' });
    // Flood: 15 distinct messages, bucket holds 10.
    for (let i = 0; i < 15; i++) a.emit('message:send', { text: `flood-${i}` });

    await sleep(800);
    expect(errors).toContain('too_long');
    expect(errors).toContain('duplicate');
    expect(errors.filter((c) => c === 'rate_limited').length).toBeGreaterThanOrEqual(3);
  });

  it('transmits malicious content as inert text (no HTML execution server-side)', async () => {
    const { a, b } = await matchedPair();

    const payload = '<script>alert("xss")</script><img src=x onerror=alert(1)>';
    const recv = once<{ text: string }>(b, 'message:new');
    a.emit('message:send', { text: payload });
    const msg = await recv;
    // Server passes text through untouched; the React client renders it as
    // text (escaped), so no markup ever executes.
    expect(msg.text).toBe(payload);
  });

  it('masks profanity in messages', async () => {
    const { a, b } = await matchedPair();

    const recv = once<{ text: string }>(b, 'message:new');
    a.emit('message:send', { text: 'this is shit' });
    const msg = await recv;
    expect(msg.text).toBe('this is ****');
  });

  it('report + block: partner is removed and the pair never re-matches', async () => {
    const { a: p, b: q, sa: sp } = await matchedPair();
    const r = await newClient();
    await startSession(r);

    // P reports Q, then blocks Q.
    const reportOk = once(p, 'report:ok');
    p.emit('user:report', { reason: 'spam' });
    await reportOk;

    const qLeft = once<{ reason: string }>(q, 'partner:left');
    const blockOk = once(p, 'block:ok');
    p.emit('user:block');
    await blockOk;
    const leftEvt = await qLeft;
    expect(leftEvt.reason).toBe('leave'); // block is not revealed to the blocked party

    // Both re-queue: they must NOT match each other.
    let pMatched = false;
    let qMatched = false;
    p.once('match:found', () => {
      pMatched = true;
    });
    q.once('match:found', () => {
      qMatched = true;
    });
    await joinQueue(p);
    await joinQueue(q);
    await sleep(600);
    expect(pMatched).toBe(false);
    expect(qMatched).toBe(false);

    // R joins → matches P (first in queue), Q keeps waiting.
    const rMatch = once<{ roomId: string; partnerUsername: string }>(r, 'match:found');
    const pMatch2 = once<{ roomId: string; partnerUsername: string }>(p, 'match:found');
    await joinQueue(r);
    const [rm, pm2] = await Promise.all([rMatch, pMatch2]);
    expect(rm.roomId).toBe(pm2.roomId);
    expect(rm.partnerUsername).toBe(sp.username);
    await sleep(400);
    expect(qMatched).toBe(false);
  });

  it('session:resume restores an offline session', async () => {
    const s1 = await newClient();
    const { sessionId, username } = await startSession(s1);
    s1.disconnect();
    await sleep(300);

    const s2 = await newClient();
    const ready = once<{ sessionId: string; username: string }>(s2, 'session:ready');
    s2.emit('session:resume', { sessionId });
    const resumed = await ready;
    expect(resumed.sessionId).toBe(sessionId);
    expect(resumed.username).toBe(username);
  });
}, 120_000);

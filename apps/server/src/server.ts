// ChitChat real-time server: Express (health/stats) + Socket.IO.
// All authorization is server-side: room membership is derived from the
// server's own session map, never from client-supplied room ids.

import { randomUUID } from 'node:crypto';
import express, { type Request, type Response } from 'express';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { Server as SocketIOServer, type Socket } from 'socket.io';
import { config } from './config.js';
import { db } from './db.js';
import { isValidSessionId } from './identity.js';
import { Matchmaker } from './matchmaker.js';
import { countUrls, filterProfanity, isShouting } from './profanity.js';
import { KeyedRateLimiter } from './ratelimit.js';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  Session,
} from './types.js';

type IoSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

const REPORT_REASONS = new Set([
  'harassment',
  'threats',
  'spam',
  'scam',
  'sexual_content',
  'hate_speech',
  'personal_info',
  'other',
]);

function messageText(input: unknown): { ok: true; text: string } | { ok: false; code: string } {
  if (typeof input !== 'string') return { ok: false, code: 'invalid' };
  const text = input.replace(/\0/g, '').trim();
  if (text.length === 0) return { ok: false, code: 'empty' };
  if (text.length > config.maxMessageLength) return { ok: false, code: 'too_long' };
  return { ok: true, text };
}

async function verifyTurnstile(token: string | undefined, ip: string): Promise<boolean> {
  if (!config.useTurnstile) return true;
  if (!token) return false;
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        secret: config.turnstileSecret,
        response: token,
        remoteip: ip,
      }),
      signal: AbortSignal.timeout(8000),
    });
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}

export interface CreatedServer {
  app: express.Express;
  io: SocketIOServer<ClientToServerEvents, ServerToClientEvents>;
  matchmaker: Matchmaker;
  /** Start listening; resolves with the bound port. */
  start(port?: number): Promise<number>;
  stop(): Promise<void>;
}

export function createServer(): CreatedServer {
  const app = express();
  const matchmaker = new Matchmaker();

  // ── HTTP ───────────────────────────────────────────────────────────────
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });
  app.use(express.json({ limit: '10kb' }));

  const httpLimiter = new KeyedRateLimiter(60, 1); // 60 req burst, 1/s refill per IP
  app.use('/api/', (req, res, next) => {
    const ip = req.ip ?? 'unknown';
    if (!httpLimiter.consume(`http:${ip}`)) {
      res.status(429).json({ error: 'rate_limited' });
      return;
    }
    next();
  });

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ ok: true, uptime: process.uptime(), version: '0.1.0' });
  });

  app.get('/api/stats', async (_req: Request, res: Response) => {
    res.json({
      online: matchmaker.onlineCount(),
      queued: await matchmaker.queuedCount(),
    });
  });

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'not_found' });
  });

  const httpServer: HttpServer = createHttpServer(app);
  const io = new SocketIOServer<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: {
      origin: (origin, cb) => {
        // Allow non-browser clients (no origin) and the configured allowlist.
        if (!origin || config.allowedOrigins.includes(origin)) cb(null, true);
        else cb(new Error('CORS blocked'));
      },
      methods: ['GET', 'POST'],
    },
    // Engine.IO heartbeats detect dead peers quickly.
    pingInterval: 25_000,
    pingTimeout: 20_000,
    maxHttpBufferSize: 1_000_000,
  });

  // ── Per-key rate limiters ──────────────────────────────────────────────
  const sessionStartLimiter = new KeyedRateLimiter(10, 10 / 60); // 10/min per IP
  const queueJoinLimiter = new KeyedRateLimiter(6, 6 / 60); // 6/min per session
  const messageLimiter = new KeyedRateLimiter(10, 10 / 60); // 10 burst, 10/min per session
  const reportLimiter = new KeyedRateLimiter(5, 5 / 3_600); // 5/hour per session

  const sessionOf = (socket: IoSocket): Session | null => {
    const id = (socket.data as { sessionId?: string }).sessionId;
    if (!id) return null;
    return matchmaker.getSession(id) ?? null;
  };

  const roomName = (roomId: string): string => `room:${roomId}`;

  /**
   * Deliver a completed match to both peers. If either peer vanished during
   * the match, roll the room back and tell the survivor the partner is gone.
   */
  const completeMatch = async (match: {
    room: { id: string; a: string; b: string };
    me: Session;
    partner: Session;
  }): Promise<boolean> => {
    const a = io.sockets.sockets.get(match.me.socketId ?? '') as IoSocket | undefined;
    const b = io.sockets.sockets.get(match.partner.socketId ?? '') as IoSocket | undefined;
    if (!a || !b) {
      matchmaker.endRoom(match.room.id, 'error');
      a?.emit('partner:left', { reason: 'disconnect' });
      b?.emit('partner:left', { reason: 'disconnect' });
      return false;
    }
    await a.join(roomName(match.room.id));
    await b.join(roomName(match.room.id));
    void db.insertRoom(match.room.id, match.room.a, match.room.b);
    a.emit('match:found', { roomId: match.room.id, partnerUsername: match.partner.username });
    b.emit('match:found', { roomId: match.room.id, partnerUsername: match.me.username });
    return true;
  };

  /**
   * End the room `s` is in: leave both sockets from the socket.io room,
   * persist the end, and notify the partner (never revealing a block).
   */
  const endRoomFor = async (
    s: Session,
    reason: 'next' | 'leave' | 'blocked',
    partnerNotice: 'next' | 'leave' | 'disconnect',
  ): Promise<string | null> => {
    const room = matchmaker.roomOf(s.id);
    if (!room || !matchmaker.assertMember(room, s.id)) return null;
    const partner = matchmaker.partnerOf(room, s.id);
    const ended = matchmaker.endRoom(room.id, reason);
    if (!ended) return null;
    void db.endRoom(room.id, reason);
    for (const p of [s, partner]) {
      const sock = p?.socketId
        ? (io.sockets.sockets.get(p.socketId) as IoSocket | undefined)
        : undefined;
      if (sock) await sock.leave(roomName(room.id));
    }
    if (partner?.socketId) {
      const partnerSocket = io.sockets.sockets.get(partner.socketId) as IoSocket | undefined;
      partnerSocket?.emit('partner:left', { reason: partnerNotice });
    }
    return room.id;
  };

  // ── Socket handlers ────────────────────────────────────────────────────

  io.on('connection', (socket: IoSocket) => {
    const ip = socket.handshake.address ?? 'unknown';
    let presenceTimer: NodeJS.Timeout | null = null;

    const requireSession = (): Session | null => {
      const s = sessionOf(socket);
      if (!s) {
        socket.emit('session:error', { code: 'no_session', message: 'Start a session first.' });
      }
      return s;
    };

    socket.on('session:start', async ({ turnstileToken, nickname }) => {
      if ((socket.data as { sessionId?: string }).sessionId) {
        socket.emit('session:error', { code: 'already_started', message: 'Session already started.' });
        return;
      }
      if (!sessionStartLimiter.consume(`ip:${ip}`)) {
        socket.emit('session:error', { code: 'rate_limited', message: 'Too many attempts. Try again shortly.' });
        return;
      }
      if (!(await verifyTurnstile(turnstileToken, ip))) {
        socket.emit('session:error', { code: 'captcha_failed', message: 'Verification failed.' });
        return;
      }
      const session = matchmaker.createSession(socket.id, nickname);
      if (!session) {
        socket.emit('session:error', { code: 'server_busy', message: 'Server is busy. Try again shortly.' });
        return;
      }
      (socket.data as { sessionId?: string }).sessionId = session.id;
      void db.upsertSession(session.id, session.username, 'online');
      socket.emit('session:ready', { sessionId: session.id, username: session.username });
    });

    socket.on('session:resume', ({ sessionId }) => {
      if (!isValidSessionId(sessionId)) {
        socket.emit('session:error', { code: 'invalid_session', message: 'Unknown session.' });
        return;
      }
      const session = matchmaker.attachSocket(sessionId, socket.id);
      if (!session) {
        socket.emit('session:error', { code: 'unknown_session', message: 'Session expired. Start a new one.' });
        return;
      }
      (socket.data as { sessionId?: string }).sessionId = session.id;
      const room = matchmaker.roomOf(session.id);
      if (room && session.status === 'chatting') {
        const partner = matchmaker.partnerOf(room, session.id);
        if (partner?.socketId) {
          void socket.join(roomName(room.id));
          socket.emit('room:restored', {
            roomId: room.id,
            partnerUsername: partner.username,
          });
          return;
        }
        // Partner is gone: clean up the dead room.
        matchmaker.endRoom(room.id, 'disconnect');
        session.status = 'online';
        session.roomId = null;
      }
      socket.emit('session:ready', { sessionId: session.id, username: session.username });
    });

    socket.on('queue:join', async () => {
      const s = requireSession();
      if (!s) return;
      if (!queueJoinLimiter.consume(`q:${s.id}`)) {
        socket.emit('queue:error', { code: 'rate_limited', message: 'Slow down.' });
        return;
      }
      const joined = await matchmaker.joinQueue(s.id);
      if (!joined.ok) {
        const messages: Record<string, string> = {
          no_session: 'Start a session first.',
          in_room: 'You are already chatting.',
          already_queued: 'Already searching.',
          cooldown: 'You are switching too fast. Wait a minute.',
          banned: 'Temporarily blocked from matchmaking due to reports.',
        };
        socket.emit('queue:error', { code: joined.code, message: messages[joined.code] });
        return;
      }
      void db.setSessionStatus(s.id, 'queued');
      // Refresh presence so the stale-sweeper keeps live waiters.
      presenceTimer = setInterval(() => {
        const cur = sessionOf(socket);
        if (cur && cur.status === 'queued') void matchmaker.store.refreshPresence(cur.id);
      }, 45_000);
      presenceTimer.unref?.();
      socket.emit('queue:joined', { position: joined.position });

      const match = await matchmaker.findMatch(s.id);
      if (match) await completeMatch(match);
    });

    socket.on('queue:leave', async () => {
      const s = requireSession();
      if (!s) return;
      if (presenceTimer) {
        clearInterval(presenceTimer);
        presenceTimer = null;
      }
      await matchmaker.leaveQueue(s.id);
      void db.setSessionStatus(s.id, 'online');
      socket.emit('queue:left');
    });

    socket.on('message:send', async ({ text }) => {
      const s = requireSession();
      if (!s) return;
      const room = matchmaker.roomOf(s.id);
      if (!room || !matchmaker.assertMember(room, s.id)) {
        socket.emit('message:error', { code: 'not_in_room', message: 'You are not in a chat.' });
        return;
      }
      if (!messageLimiter.consume(`m:${s.id}`)) {
        socket.emit('message:error', { code: 'rate_limited', message: 'You are sending messages too fast.' });
        return;
      }
      const parsed = messageText(text);
      if (!parsed.ok) {
        socket.emit('message:error', {
          code: parsed.code,
          message: parsed.code === 'too_long' ? `Messages are limited to ${config.maxMessageLength} characters.` : 'Invalid message.',
        });
        return;
      }
      const now = Date.now();
      // Duplicate-spam detection: same text twice within 30 s.
      if (s.lastMessageText === parsed.text && now - s.lastMessageAt < 30_000) {
        s.suspicion += 1;
        socket.emit('message:error', { code: 'duplicate', message: 'Duplicate message blocked.' });
        return;
      }
      s.lastMessageText = parsed.text;
      s.lastMessageAt = now;

      const filtered = filterProfanity(parsed.text);
      if (filtered.flagged) s.suspicion += filtered.hits;
      if (countUrls(parsed.text) > 2) s.suspicion += 2;
      if (isShouting(parsed.text)) s.suspicion += 1;

      const msg = { id: randomUUID(), sender: s.username, text: filtered.text, ts: now };
      io.to(roomName(room.id)).emit('message:new', msg);
      socket.emit('message:sent', { id: msg.id, ts: msg.ts });
    });

    socket.on('typing:start', () => {
      const s = sessionOf(socket);
      const room = s && matchmaker.roomOf(s.id);
      if (!s || !room || !matchmaker.assertMember(room, s.id)) return;
      socket.to(roomName(room.id)).emit('typing:update', { username: s.username, typing: true });
    });

    socket.on('typing:stop', () => {
      const s = sessionOf(socket);
      const room = s && matchmaker.roomOf(s.id);
      if (!s || !room || !matchmaker.assertMember(room, s.id)) return;
      socket.to(roomName(room.id)).emit('typing:update', { username: s.username, typing: false });
    });

    socket.on('chat:next', async () => {
      const s = requireSession();
      if (!s) return;
      if (presenceTimer) {
        clearInterval(presenceTimer);
        presenceTimer = null;
      }
      await endRoomFor(s, 'next', 'next');
      const { match, queued, queueCode } = await matchmaker.next(s.id);
      if (!queued) {
        const messages: Record<string, string> = {
          banned: 'Temporarily blocked from matchmaking due to reports.',
          cooldown: 'You are switching too fast. Wait a minute.',
          in_room: 'You are already chatting.',
          already_queued: 'Already searching.',
          no_session: 'Start a session first.',
        };
        socket.emit('queue:error', {
          code: queueCode ?? 'cooldown',
          message: messages[queueCode ?? 'cooldown'] ?? 'Could not search right now.',
        });
        return;
      }
      if (match) {
        const delivered = await completeMatch(match);
        if (!delivered) socket.emit('next:searching');
      } else {
        socket.emit('next:searching');
        presenceTimer = setInterval(() => {
          const cur = sessionOf(socket);
          if (cur && cur.status === 'queued') void matchmaker.store.refreshPresence(cur.id);
        }, 45_000);
        presenceTimer.unref?.();
      }
    });

    socket.on('chat:leave', async () => {
      const s = requireSession();
      if (!s) return;
      if (presenceTimer) {
        clearInterval(presenceTimer);
        presenceTimer = null;
      }
      await endRoomFor(s, 'leave', 'leave');
      socket.emit('room:ended', { reason: 'leave' });
    });

    socket.on('user:report', async ({ reason, details }) => {
      const s = requireSession();
      if (!s) return;
      if (!reportLimiter.consume(`r:${s.id}`)) {
        socket.emit('report:error', { code: 'rate_limited', message: 'Too many reports.' });
        return;
      }
      const room = matchmaker.roomOf(s.id);
      if (!room || !matchmaker.assertMember(room, s.id)) {
        socket.emit('report:error', { code: 'not_in_room', message: 'Nothing to report right now.' });
        return;
      }
      const cleanReason = typeof reason === 'string' && REPORT_REASONS.has(reason) ? reason : 'other';
      void details; // Details are accepted but never stored (privacy: minimal data).
      const partner = matchmaker.partnerOf(room, s.id);
      if (!partner) {
        socket.emit('report:error', { code: 'not_in_room', message: 'Nothing to report right now.' });
        return;
      }
      const { banned } = matchmaker.recordReport(s.id, partner.id);
      void db.insertReport(s.id, partner.id, room.id, cleanReason);
      if (banned) {
        // Force the reported user out of the room. endRoomFor notifies the
        // *reporter* (the reported user's partner here) with a generic
        // 'disconnect' so no ban signal leaks.
        await endRoomFor(partner, 'blocked', 'disconnect');
        const partnerSocket = partner.socketId
          ? (io.sockets.sockets.get(partner.socketId) as IoSocket | undefined)
          : undefined;
        partnerSocket?.emit('room:ended', { reason: 'error' });
      }
      socket.emit('report:ok');
    });

    socket.on('user:block', async () => {
      const s = requireSession();
      if (!s) return;
      const room = matchmaker.roomOf(s.id);
      if (!room || !matchmaker.assertMember(room, s.id)) {
        socket.emit('block:ok');
        return;
      }
      const partner = matchmaker.partnerOf(room, s.id);
      if (partner) {
        matchmaker.addBlock(s.id, partner.id);
        void db.insertBlock(s.id, partner.id);
      }
      // The blocked party just sees the partner leaving.
      await endRoomFor(s, 'blocked', 'leave');
      socket.emit('block:ok');
    });

    socket.on('presence:ping', () => {
      const s = sessionOf(socket);
      if (!s) return;
      matchmaker.touch(s);
      if (s.status === 'queued') void matchmaker.store.refreshPresence(s.id);
      socket.emit('presence:pong');
    });

    socket.on('disconnect', async () => {
      if (presenceTimer) {
        clearInterval(presenceTimer);
        presenceTimer = null;
      }
      const result = await matchmaker.handleDisconnect(socket.id);
      if (!result) return;
      void db.setSessionStatus(result.session.id, 'offline');
      if (result.endedRoomId && result.partner?.socketId) {
        const partnerSocket = io.sockets.sockets.get(result.partner.socketId) as IoSocket | undefined;
        if (partnerSocket) {
          await partnerSocket.leave(roomName(result.endedRoomId));
          partnerSocket.emit('partner:left', { reason: 'disconnect' });
        }
      }
    });
  });

  // ── Maintenance ──────────────────────────────────────────────────────────
  const sweepTimer = setInterval(() => {
    void matchmaker.sweep().catch(() => undefined);
  }, 60_000);
  sweepTimer.unref?.();
  // Daily 30-day retention purge of Supabase metadata (no-op if unconfigured).
  const purgeTimer = setInterval(
    () => {
      void db.purgeOldData().catch(() => undefined);
    },
    24 * 60 * 60_000,
  );
  purgeTimer.unref?.();

  return {
    app,
    io,
    matchmaker,
    start(port = config.port): Promise<number> {
      return new Promise((resolve) => {
        httpServer.listen(port, () => {
          const addr = httpServer.address();
          const bound = typeof addr === 'object' && addr ? addr.port : port;
          resolve(bound);
        });
      });
    },
    stop(): Promise<void> {
      return new Promise((resolve) => {
        clearInterval(sweepTimer);
        clearInterval(purgeTimer);
        io.close(() => {
          // io.close() tears down the underlying HTTP server too; only close
          // it here if it is still listening (avoids ERR_SERVER_NOT_RUNNING).
          if (httpServer.listening) {
            httpServer.close(() => resolve());
          } else {
            resolve();
          }
        });
      });
    },
  };
}

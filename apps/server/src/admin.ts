// Admin moderation: token-gated HTTP API plus the in-memory moderation state
// behind it (per-room message buffers for review, session/IP blocklist).
//
// Message buffers live ONLY in server memory, are capped per room, and are
// discarded when the chat ends (or by periodic sweep). Nothing is written to
// disk. The admin API is disabled entirely unless ADMIN_TOKEN or
// ADMIN_PASSWORD_HASH is set. Moderators sign in with a username + password
// (POST /admin/login) and receive a 12-hour session token sent as
// x-admin-token; a configured ADMIN_TOKEN also works as a master key.

import { Router, type Request, type Response, type NextFunction } from 'express';
import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { promisify } from 'node:util';
import { config } from './config.js';
import type { Matchmaker } from './matchmaker.js';

// promisify() picks the no-options overload in the type system; re-type it.
const scryptAsync = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;
// Must match the parameters used when generating ADMIN_PASSWORD_HASH.
const SCRYPT_OPTS: ScryptOptions = { N: 16384, r: 8, p: 1 };
const SESSION_TTL_MS = 12 * 3600 * 1000;
/** Session token -> expiry timestamp (in-memory; single instance). */
const sessions = new Map<string, number>();

// ── Explicit-content flagging ─────────────────────────────────────────────
// Lightweight keyword signal so moderators can spot explicit chats quickly.
// Flagging never blocks or censors by itself; a human reviews flagged rooms.
const EXPLICIT_KEYWORDS = [
  'porn',
  'xxx',
  'nude',
  'nudes',
  'naked',
  'boob',
  'boobs',
  'tits',
  'pussy',
  'dick',
  'cock',
  'blowjob',
  'handjob',
  'orgasm',
  'cum',
  'horny',
  'sexy pic',
  'send pic',
  'camgirl',
  'onlyfans',
  'escort',
  'hookup',
  'sext',
  'dickpic',
];

const explicitPattern = new RegExp(
  `\\b(${EXPLICIT_KEYWORDS.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`,
  'i',
);

/** Best-effort signal that a message may be sexually explicit. */
export function flagExplicit(text: string): boolean {
  return explicitPattern.test(text);
}

// ── Moderation state ──────────────────────────────────────────────────────

export interface ModMessage {
  id: string;
  sessionId: string;
  username: string;
  text: string;
  ts: number;
  flagged: boolean;
}

export interface BlockRecord {
  sessionId?: string;
  ip?: string;
  reason: string;
  createdAt: number;
}

const MAX_BUFFERED_PER_ROOM = 100;

export interface Moderation {
  recordMessage(roomId: string, msg: ModMessage): void;
  getMessages(roomId: string, after?: number): ModMessage[];
  roomMessageCount(roomId: string): number;
  roomFlaggedCount(roomId: string): number;
  /** Drop buffers for rooms that no longer exist. */
  sweepRooms(activeRoomIds: Set<string>): void;
  block(target: { sessionId?: string; ip?: string; reason?: string }): BlockRecord[];
  unblock(target: { sessionId?: string; ip?: string }): boolean;
  isBlocked(sessionId: string, ip?: string): boolean;
  listBlocks(): BlockRecord[];
}

export function createModeration(): Moderation {
  const buffers = new Map<string, ModMessage[]>();
  const blockedSessions = new Map<string, BlockRecord>();
  const blockedIps = new Map<string, BlockRecord>();

  return {
    recordMessage(roomId, msg) {
      let buf = buffers.get(roomId);
      if (!buf) {
        buf = [];
        buffers.set(roomId, buf);
      }
      buf.push(msg);
      if (buf.length > MAX_BUFFERED_PER_ROOM) buf.splice(0, buf.length - MAX_BUFFERED_PER_ROOM);
    },

    getMessages(roomId, after = 0) {
      return (buffers.get(roomId) ?? []).filter((m) => m.ts > after);
    },

    roomMessageCount(roomId) {
      return buffers.get(roomId)?.length ?? 0;
    },

    roomFlaggedCount(roomId) {
      return buffers.get(roomId)?.filter((m) => m.flagged).length ?? 0;
    },

    sweepRooms(activeRoomIds) {
      for (const roomId of buffers.keys()) {
        if (!activeRoomIds.has(roomId)) buffers.delete(roomId);
      }
    },

    block({ sessionId, ip, reason }) {
      const created: BlockRecord[] = [];
      const rec: BlockRecord = {
        sessionId,
        ip,
        reason: reason?.slice(0, 200) || 'moderator block',
        createdAt: Date.now(),
      };
      if (sessionId) {
        blockedSessions.set(sessionId, rec);
        created.push(rec);
      }
      if (ip && ip !== 'unknown') {
        blockedIps.set(ip, rec);
        created.push(rec);
      }
      return created;
    },

    unblock({ sessionId, ip }) {
      let removed = false;
      if (sessionId && blockedSessions.delete(sessionId)) removed = true;
      if (ip && blockedIps.delete(ip)) removed = true;
      return removed;
    },

    isBlocked(sessionId, ip) {
      if (blockedSessions.has(sessionId)) return true;
      if (ip && blockedIps.has(ip)) return true;
      return false;
    },

    listBlocks() {
      const seen = new Set<BlockRecord>();
      const out: BlockRecord[] = [];
      for (const rec of blockedSessions.values()) {
        if (!seen.has(rec)) {
          seen.add(rec);
          out.push(rec);
        }
      }
      for (const rec of blockedIps.values()) {
        if (!seen.has(rec)) {
          seen.add(rec);
          out.push(rec);
        }
      }
      return out.sort((a, b) => b.createdAt - a.createdAt);
    },
  };
}

// ── Admin HTTP API ────────────────────────────────────────────────────────

export interface AdminDeps {
  matchmaker: Matchmaker;
  moderation: Moderation;
  /** End the session's room (as a block) and disconnect its socket(s). */
  blockAndDisconnect: (target: { sessionId?: string; ip?: string }) => Promise<number>;
}

function secretMatches(provided: string, expected: string): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Hash a plain password for ADMIN_PASSWORD_HASH (scrypt, random salt). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = (await scrypt(password, salt, 64, SCRYPT_OPTS)) as Buffer;
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const parts = hash.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1], 'hex');
  const expected = Buffer.from(parts[2], 'hex');
  if (salt.length < 8 || expected.length < 16) return false;
  try {
    const derived = (await scrypt(password, salt, expected.length, SCRYPT_OPTS)) as Buffer;
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

function validSession(token: string): boolean {
  if (!token) return false;
  const exp = sessions.get(token);
  if (exp === undefined) return false;
  if (exp <= Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function adminEnabled(): boolean {
  return config.adminToken !== '' || config.adminPasswordHash !== '';
}

function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!adminEnabled()) {
    res.status(503).json({ error: 'admin_disabled' });
    return;
  }
  const provided = req.header('x-admin-token') ?? '';
  if (secretMatches(provided, config.adminToken) || validSession(provided)) {
    next();
    return;
  }
  res.status(401).json({ error: 'unauthorized' });
}

export function createAdminRouter(deps: AdminDeps): Router {
  const { matchmaker, moderation, blockAndDisconnect } = deps;
  const router = Router();

  // Username + password sign-in. Issues a 12-hour session token sent back
  // as x-admin-token. Rate-limited per IP by the /admin limiter in server.ts.
  router.post('/login', async (req, res) => {
    if (!adminEnabled() || !config.adminPasswordHash) {
      res.status(503).json({ error: 'admin_disabled' });
      return;
    }
    const { username, password } = (req.body ?? {}) as {
      username?: unknown;
      password?: unknown;
    };
    let ok = false;
    if (typeof username === 'string' && typeof password === 'string') {
      ok =
        secretMatches(username, config.adminUser) &&
        (await verifyPassword(password, config.adminPasswordHash));
    }
    if (!ok) {
      res.status(401).json({ error: 'invalid_credentials' });
      return;
    }
    if (sessions.size > 5000) {
      const now = Date.now();
      for (const [t, e] of sessions) if (e <= now) sessions.delete(t);
    }
    const token = randomBytes(32).toString('hex');
    sessions.set(token, Date.now() + SESSION_TTL_MS);
    res.json({ token, expiresInSec: SESSION_TTL_MS / 1000 });
  });

  router.use(authMiddleware);

  router.get('/stats', async (_req, res) => {
    const rooms = [...matchmaker.rooms.values()];
    let flaggedRooms = 0;
    for (const room of rooms) {
      if (moderation.roomFlaggedCount(room.id) > 0) flaggedRooms += 1;
    }
    res.json({
      online: matchmaker.onlineCount(),
      queued: await matchmaker.queuedCount(),
      activeRooms: rooms.length,
      flaggedRooms,
      blocked: moderation.listBlocks().length,
      uptimeSec: Math.floor(process.uptime()),
    });
  });

  router.get('/rooms', (_req, res) => {
    const out = [...matchmaker.rooms.values()].map((room) => {
      const a = matchmaker.sessions.get(room.a);
      const b = matchmaker.sessions.get(room.b);
      return {
        roomId: room.id,
        startedAt: room.createdAt,
        messageCount: moderation.roomMessageCount(room.id),
        flaggedCount: moderation.roomFlaggedCount(room.id),
        a: a ? { sessionId: a.id, username: a.username, ip: a.ip ?? null } : null,
        b: b ? { sessionId: b.id, username: b.username, ip: b.ip ?? null } : null,
      };
    });
    res.json({ rooms: out });
  });

  router.get('/rooms/:roomId/messages', (req, res) => {
    const after = Number.parseInt((req.query.after as string) ?? '0', 10) || 0;
    res.json({ messages: moderation.getMessages(req.params.roomId, after) });
  });

  router.post('/block', async (req, res) => {
    const { sessionId, ip, reason } = req.body as {
      sessionId?: string;
      ip?: string;
      reason?: string;
    };
    if (!sessionId && !ip) {
      res.status(400).json({ error: 'sessionId or ip required' });
      return;
    }
    const records = moderation.block({ sessionId, ip, reason });
    const disconnected = await blockAndDisconnect({ sessionId, ip });
    res.json({ ok: true, records, disconnected });
  });

  router.post('/unblock', (req, res) => {
    const { sessionId, ip } = req.body as { sessionId?: string; ip?: string };
    const removed = moderation.unblock({ sessionId, ip });
    res.json({ ok: true, removed });
  });

  router.get('/blocks', (_req, res) => {
    res.json({ blocks: moderation.listBlocks() });
  });

  return router;
}

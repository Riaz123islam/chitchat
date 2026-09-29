// Matchmaking queue store with two backends:
//  - RedisQueueStore: Upstash Redis via the REST client (stateless, no
//    persistent connections — ideal for the 10k commands/day free tier).
//    All match operations are atomic Lua scripts.
//  - MemoryQueueStore: single-process fallback used for local dev, tests, and
//    when Redis is not configured.
//
// Upstash free-tier budget: each queue join/leave is 1 command, each match
// attempt is 1 command. Presence heartbeats stay in process memory.

import { Redis } from '@upstash/redis';
import { config } from './config.js';
import type { QueueMember } from './types.js';

export interface QueueStore {
  /** Add (or refresh) a member. Idempotent per session id. */
  join(member: QueueMember): Promise<void>;
  /** Remove a member. */
  leave(sessionId: string): Promise<void>;
  /** Number of members currently waiting. */
  size(): Promise<number>;
  /** 1-based position of a member, or null when not queued. */
  position(sessionId: string): Promise<number | null>;
  /**
   * Atomically find and remove a partner for `sessionId`.
   * Never returns the requester; skips excluded (blocked) and stale members.
   */
  takePartner(sessionId: string, exclude: Set<string>): Promise<QueueMember | null>;
  /** Refresh presence so stale-sweepers don't drop live members. */
  refreshPresence(sessionId: string): Promise<void>;
  clearPresence(sessionId: string): Promise<void>;
  /** Drop members whose heartbeat expired. Returns removed count. */
  sweepStale(): Promise<number>;
}

const QUEUE_KEY = 'chitchat:queue';

// ── In-memory store ──────────────────────────────────────────────────────────

export class MemoryQueueStore implements QueueStore {
  private members: QueueMember[] = [];
  private presence = new Map<string, number>();

  async join(member: QueueMember): Promise<void> {
    await this.leave(member.sessionId);
    this.members.push(member);
    this.presence.set(member.sessionId, Date.now());
  }

  async leave(sessionId: string): Promise<void> {
    this.members = this.members.filter((m) => m.sessionId !== sessionId);
  }

  async size(): Promise<number> {
    return this.members.length;
  }

  async position(sessionId: string): Promise<number | null> {
    const i = this.members.findIndex((m) => m.sessionId === sessionId);
    return i === -1 ? null : i + 1;
  }

  async takePartner(sessionId: string, exclude: Set<string>): Promise<QueueMember | null> {
    const cutoff = Date.now() - config.queueStaleMs;
    const idx = this.members.findIndex(
      (m) => m.sessionId !== sessionId && !exclude.has(m.sessionId) && m.joinedAt >= cutoff,
    );
    if (idx === -1) {
      await this.sweepStale();
      return null;
    }
    const [partner] = this.members.splice(idx, 1);
    return partner;
  }

  async refreshPresence(sessionId: string): Promise<void> {
    this.presence.set(sessionId, Date.now());
  }

  async clearPresence(sessionId: string): Promise<void> {
    this.presence.delete(sessionId);
  }

  async sweepStale(): Promise<number> {
    const cutoff = Date.now() - config.queueStaleMs;
    const before = this.members.length;
    this.members = this.members.filter((m) => m.joinedAt >= cutoff);
    for (const [id, ts] of this.presence) {
      if (ts < cutoff) this.presence.delete(id);
    }
    return before - this.members.length;
  }
}

// ── Redis (Upstash REST) store ───────────────────────────────────────────────
// Queue is a sorted set: score = joinedAt, member = compact JSON.
// Presence is refreshed separately so queue scans stay cheap.

// Atomically take a partner: scan by join order, skip self/excluded/stale,
// remove the chosen member, then purge stale members. One command.
const TAKE_PARTNER_LUA = `
local members = redis.call('ZRANGE', KEYS[1], 0, -1)
local excluded = cjson.decode(ARGV[4])
local cutoff = tonumber(ARGV[2]) - tonumber(ARGV[3])
for _, m in ipairs(members) do
  local ok, obj = pcall(cjson.decode, m)
  if ok and type(obj) == 'table' and obj.s ~= ARGV[1] and tonumber(obj.j) >= cutoff then
    local skip = false
    for _, e in ipairs(excluded) do
      if e == obj.s then skip = true break end
    end
    if not skip then
      redis.call('ZREM', KEYS[1], m)
      return m
    end
  end
end
redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, cutoff)
return false
`;

// Atomically (re-)join: remove any existing entry for this session, then add.
const JOIN_LUA = `
local members = redis.call('ZRANGE', KEYS[1], 0, -1)
for _, m in ipairs(members) do
  local ok, obj = pcall(cjson.decode, m)
  if ok and type(obj) == 'table' and obj.s == ARGV[2] then
    redis.call('ZREM', KEYS[1], m)
  end
end
redis.call('ZADD', KEYS[1], ARGV[3], ARGV[1])
redis.call('SET', KEYS[2], '1', 'EX', ARGV[4])
return 1
`;

function encode(m: QueueMember): string {
  return JSON.stringify({ s: m.sessionId, u: m.username, j: m.joinedAt });
}

function decode(raw: string): QueueMember {
  const o = JSON.parse(raw) as { s: string; u: string; j: number };
  return { sessionId: o.s, username: o.u, joinedAt: o.j };
}

export class RedisQueueStore implements QueueStore {
  private redis: Redis;

  constructor() {
    this.redis = new Redis({ url: config.upstashUrl, token: config.upstashToken });
  }

  private presenceKey(sessionId: string): string {
    return `chitchat:presence:${sessionId}`;
  }

  async join(member: QueueMember): Promise<void> {
    await this.redis.eval(
      JOIN_LUA,
      [QUEUE_KEY, this.presenceKey(member.sessionId)],
      [encode(member), member.sessionId, String(member.joinedAt), String(config.presenceTtlSec)],
    );
  }

  async leave(sessionId: string): Promise<void> {
    // Remove by scanning for the session id (member JSON embeds it).
    const members = await this.redis.zrange<string[]>(QUEUE_KEY, 0, -1);
    const target = members.find((m) => {
      try {
        return decode(m).sessionId === sessionId;
      } catch {
        return false;
      }
    });
    if (target) await this.redis.zrem(QUEUE_KEY, target);
    await this.clearPresence(sessionId);
  }

  async size(): Promise<number> {
    return this.redis.zcard(QUEUE_KEY);
  }

  async position(sessionId: string): Promise<number | null> {
    const members = await this.redis.zrange<string[]>(QUEUE_KEY, 0, -1);
    const i = members.findIndex((m) => {
      try {
        return decode(m).sessionId === sessionId;
      } catch {
        return false;
      }
    });
    return i === -1 ? null : i + 1;
  }

  async takePartner(sessionId: string, exclude: Set<string>): Promise<QueueMember | null> {
    const raw = await this.redis.eval<string[], string | null>(
      TAKE_PARTNER_LUA,
      [QUEUE_KEY],
      [sessionId, String(Date.now()), String(config.queueStaleMs), JSON.stringify([...exclude])],
    );
    if (!raw) return null;
    try {
      return decode(raw);
    } catch {
      return null;
    }
  }

  async refreshPresence(sessionId: string): Promise<void> {
    await this.redis.set(this.presenceKey(sessionId), '1', { ex: config.presenceTtlSec });
  }

  async clearPresence(sessionId: string): Promise<void> {
    await this.redis.del(this.presenceKey(sessionId));
  }

  async sweepStale(): Promise<number> {
    const cutoff = Date.now() - config.queueStaleMs;
    return this.redis.zremrangebyscore(QUEUE_KEY, 0, cutoff);
  }
}

/** Factory: Redis when configured, otherwise the in-memory fallback. */
export function createQueueStore(): QueueStore {
  if (config.useRedis) {
    try {
      return new RedisQueueStore();
    } catch {
      return new MemoryQueueStore();
    }
  }
  return new MemoryQueueStore();
}

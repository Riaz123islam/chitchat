// Server-side matchmaking. Owns sessions, rooms, blocks and bans.
//
// Safety invariants (all enforced here, never trusted to the client):
//  - a user is never matched with themselves
//  - a user is never in the queue and a room at the same time
//  - duplicate queue joins are collapsed, not duplicated
//  - stale queue entries expire
//  - room membership is validated on the server for every action
//  - blocked pairs are never matched

import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { generateSessionId, generateUsername, isValidSessionId } from './identity.js';
import { countWithin, pruneOlderThan } from './ratelimit.js';
import { createQueueStore, type QueueStore } from './store.js';
import type { Room, RoomEndReason, Session } from './types.js';

export type QueueJoinResult =
  | { ok: true; position: number }
  | { ok: false; code: 'no_session' | 'in_room' | 'already_queued' | 'cooldown' | 'banned' };

const NEXT_WINDOW_MS = 5 * 60_000;
const NEXT_LIMIT = 8; // >8 "next" presses in 5 min → 60 s cooldown
const COOLDOWN_MS = 60_000;
const REPORT_BAN_THRESHOLD = 5; // 5 reports against a session → 1 h queue ban
const BAN_MS = 60 * 60_000;
const MAX_SESSIONS = 50_000;

export interface Match {
  room: Room;
  me: Session;
  partner: Session;
}

export class Matchmaker {
  readonly sessions = new Map<string, Session>();
  readonly rooms = new Map<string, Room>();
  /** blocker session id → set of blocked session ids */
  readonly blocks = new Map<string, Set<string>>();
  /** reported session id → report timestamps */
  private readonly reportsAgainst = new Map<string, number[]>();
  /** session id → timestamp until which queue joins are rejected */
  private readonly bannedUntil = new Map<string, number>();
  /** session id → cooldown expiry for next-spam */
  private readonly cooldownUntil = new Map<string, number>();
  readonly store: QueueStore;

  constructor(store?: QueueStore) {
    this.store = store ?? createQueueStore();
  }

  // ── Sessions ─────────────────────────────────────────────────────────────

  createSession(socketId: string): Session | null {
    if (this.sessions.size >= MAX_SESSIONS) return null;
    const id = generateSessionId();
    let username = generateUsername();
    // Avoid username collisions among live sessions (cheap loop, tiny space).
    const taken = new Set([...this.sessions.values()].map((s) => s.username));
    let guard = 0;
    while (taken.has(username) && guard++ < 10) username = generateUsername();
    const now = Date.now();
    const session: Session = {
      id,
      username,
      socketId,
      status: 'online',
      roomId: null,
      createdAt: now,
      lastSeen: now,
      nextPresses: [],
      suspicion: 0,
      lastMessageText: '',
      lastMessageAt: 0,
    };
    this.sessions.set(id, session);
    return session;
  }

  getSession(id: string): Session | undefined {
    if (!isValidSessionId(id)) return undefined;
    return this.sessions.get(id);
  }

  getSessionBySocket(socketId: string): Session | undefined {
    for (const s of this.sessions.values()) {
      if (s.socketId === socketId) return s;
    }
    return undefined;
  }

  attachSocket(sessionId: string, socketId: string): Session | null {
    const s = this.getSession(sessionId);
    if (!s) return null;
    s.socketId = socketId;
    s.lastSeen = Date.now();
    if (s.status === 'offline') s.status = s.roomId ? 'chatting' : 'online';
    return s;
  }

  touch(session: Session): void {
    session.lastSeen = Date.now();
  }

  // ── Queue ────────────────────────────────────────────────────────────────

  async joinQueue(sessionId: string): Promise<QueueJoinResult> {
    const s = this.sessions.get(sessionId);
    if (!s) return { ok: false, code: 'no_session' };
    if (s.roomId) return { ok: false, code: 'in_room' };
    if (s.status === 'queued') return { ok: false, code: 'already_queued' };
    const now = Date.now();
    if ((this.bannedUntil.get(sessionId) ?? 0) > now) return { ok: false, code: 'banned' };
    if ((this.cooldownUntil.get(sessionId) ?? 0) > now) return { ok: false, code: 'cooldown' };
    s.status = 'queued';
    s.lastSeen = now;
    await this.store.join({ sessionId: s.id, username: s.username, joinedAt: now });
    const position = (await this.store.position(sessionId)) ?? 1;
    return { ok: true, position };
  }

  async leaveQueue(sessionId: string): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (s && s.status === 'queued') s.status = 'online';
    await this.store.leave(sessionId);
    await this.store.clearPresence(sessionId);
  }

  /** Try to match `sessionId` with a waiting stranger. */
  async findMatch(sessionId: string): Promise<Match | null> {
    const me = this.sessions.get(sessionId);
    if (!me || me.status !== 'queued' || me.roomId) return null;
    const exclude = this.exclusionsFor(sessionId);
    const partnerMember = await this.store.takePartner(sessionId, exclude);
    if (!partnerMember) return null;
    const partner = this.sessions.get(partnerMember.sessionId);
    // Partner vanished (server restart / expired session): keep looking once.
    if (!partner || partner.status !== 'queued' || partner.roomId) {
      return this.findMatch(sessionId);
    }
    // Both sides leave the queue now that they're matched — otherwise the
    // requester's entry would linger and could be handed to someone else.
    await this.store.leave(sessionId);
    const room = this.createRoom(me, partner);
    return { room, me, partner };
  }

  private exclusionsFor(sessionId: string): Set<string> {
    const out = new Set<string>();
    const mine = this.blocks.get(sessionId);
    if (mine) for (const id of mine) out.add(id);
    for (const [blocker, blocked] of this.blocks) {
      if (blocked.has(sessionId)) out.add(blocker);
    }
    return out;
  }

  // ── Rooms ────────────────────────────────────────────────────────────────

  private createRoom(a: Session, b: Session): Room {
    const room: Room = {
      id: randomUUID(),
      a: a.id,
      b: b.id,
      createdAt: Date.now(),
      endedAt: null,
      endReason: null,
    };
    this.rooms.set(room.id, room);
    for (const s of [a, b]) {
      s.status = 'chatting';
      s.roomId = room.id;
      s.lastSeen = Date.now();
    }
    void this.store.clearPresence(a.id);
    void this.store.clearPresence(b.id);
    return room;
  }

  roomOf(sessionId: string): Room | null {
    const s = this.sessions.get(sessionId);
    if (!s?.roomId) return null;
    return this.rooms.get(s.roomId) ?? null;
  }

  partnerOf(room: Room, sessionId: string): Session | null {
    const other = room.a === sessionId ? room.b : room.b === sessionId ? room.a : null;
    return other ? (this.sessions.get(other) ?? null) : null;
  }

  /** Server-side membership check. Never trust the client's room id. */
  assertMember(room: Room, sessionId: string): boolean {
    return room.a === sessionId || room.b === sessionId;
  }

  endRoom(roomId: string, reason: RoomEndReason): { room: Room; participants: Session[] } | null {
    const room = this.rooms.get(roomId);
    if (!room || room.endedAt) return null;
    room.endedAt = Date.now();
    room.endReason = reason;
    const participants: Session[] = [];
    for (const id of [room.a, room.b]) {
      const s = this.sessions.get(id);
      if (s) {
        s.roomId = null;
        if (s.status === 'chatting') s.status = 'online';
        s.lastSeen = Date.now();
        participants.push(s);
      }
    }
    this.rooms.delete(roomId);
    return { room, participants };
  }

  /** "Next": leave the current room and go back to matchmaking. */
  async next(sessionId: string): Promise<{
    match: Match | null;
    endedRoomId: string | null;
    queued: boolean;
    queueCode?: string;
  }> {
    const s = this.sessions.get(sessionId);
    if (!s) return { match: null, endedRoomId: null, queued: false, queueCode: 'no_session' };
    const now = Date.now();
    s.nextPresses = pruneOlderThan([...s.nextPresses, now], NEXT_WINDOW_MS, now);
    let endedRoomId: string | null = null;
    if (s.roomId) {
      const ended = this.endRoom(s.roomId, 'next');
      endedRoomId = ended ? ended.room.id : null;
    } else {
      await this.leaveQueue(sessionId);
    }
    if (countWithin(s.nextPresses, NEXT_WINDOW_MS, now) > NEXT_LIMIT) {
      this.cooldownUntil.set(sessionId, now + COOLDOWN_MS);
    }
    const joined = await this.joinQueue(sessionId);
    if (!joined.ok) return { match: null, endedRoomId, queued: false, queueCode: joined.code };
    const match = await this.findMatch(sessionId);
    return { match, endedRoomId, queued: true };
  }

  // ── Moderation ───────────────────────────────────────────────────────────

  addBlock(blockerId: string, blockedId: string): void {
    if (blockerId === blockedId) return;
    let set = this.blocks.get(blockerId);
    if (!set) {
      set = new Set();
      this.blocks.set(blockerId, set);
    }
    set.add(blockedId);
  }

  recordReport(reporterId: string, reportedId: string): { banned: boolean } {
    if (reporterId === reportedId) return { banned: false };
    const now = Date.now();
    const list = pruneOlderThan(this.reportsAgainst.get(reportedId) ?? [], 24 * 60 * 60_000, now);
    list.push(now);
    this.reportsAgainst.set(reportedId, list);
    if (list.length >= REPORT_BAN_THRESHOLD) {
      this.bannedUntil.set(reportedId, now + BAN_MS);
      return { banned: true };
    }
    return { banned: false };
  }

  isBanned(sessionId: string): boolean {
    return (this.bannedUntil.get(sessionId) ?? 0) > Date.now();
  }

  // ── Disconnect ───────────────────────────────────────────────────────────

  /**
   * Handle a socket disconnect. Removes the session from the queue, ends any
   * room it was in, and returns the data the socket layer needs to notify the
   * remaining participant.
   */
  async handleDisconnect(socketId: string): Promise<{
    session: Session;
    endedRoomId: string | null;
    partner: Session | null;
  } | null> {
    const session = this.getSessionBySocket(socketId);
    if (!session) return null;
    session.socketId = null;
    session.lastSeen = Date.now();
    let endedRoomId: string | null = null;
    let partner: Session | null = null;
    if (session.status === 'queued') {
      await this.leaveQueue(session.id);
      session.status = 'offline';
    } else if (session.roomId) {
      const room = this.rooms.get(session.roomId);
      if (room) {
        partner = this.partnerOf(room, session.id);
        const ended = this.endRoom(room.id, 'disconnect');
        endedRoomId = ended ? ended.room.id : null;
      }
      session.status = 'offline';
    } else {
      session.status = 'offline';
    }
    await this.store.clearPresence(session.id);
    return { session, endedRoomId, partner };
  }

  /** Periodic maintenance: drop stale queue entries, expire bans, GC sessions. */
  async sweep(): Promise<void> {
    await this.store.sweepStale();
    const now = Date.now();
    for (const [id, until] of this.bannedUntil) {
      if (until <= now) this.bannedUntil.delete(id);
    }
    for (const [id, until] of this.cooldownUntil) {
      if (until <= now) this.cooldownUntil.delete(id);
    }
    for (const [id, s] of this.sessions) {
      if (s.socketId === null && now - s.lastSeen > config.sessionIdleMs) {
        this.sessions.delete(id);
        this.blocks.delete(id);
        this.reportsAgainst.delete(id);
        // Remove blocks pointing at the expired session.
        for (const set of this.blocks.values()) set.delete(id);
      }
    }
  }

  queuedCount(): Promise<number> {
    return this.store.size();
  }

  onlineCount(): number {
    let n = 0;
    for (const s of this.sessions.values()) {
      if (s.socketId !== null) n += 1;
    }
    return n;
  }
}

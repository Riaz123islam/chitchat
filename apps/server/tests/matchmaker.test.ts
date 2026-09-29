import { beforeEach, describe, expect, it } from 'vitest';
import { Matchmaker } from '../src/matchmaker.js';
import { MemoryQueueStore } from '../src/store.js';

describe('Matchmaker', () => {
  let mm: Matchmaker;

  beforeEach(() => {
    mm = new Matchmaker(new MemoryQueueStore());
  });

  async function queuedSession(sockId: string) {
    const s = mm.createSession(sockId)!;
    const joined = await mm.joinQueue(s.id);
    expect(joined.ok).toBe(true);
    return s;
  }

  it('matches two waiting users and leaves a third waiting', async () => {
    const a = await queuedSession('sock-a');
    const b = await queuedSession('sock-b');
    const c = await queuedSession('sock-c');

    const matchA = await mm.findMatch(a.id);
    expect(matchA).not.toBeNull();
    expect(matchA!.partner.id).toBe(b.id);
    expect(matchA!.me.id).toBe(a.id);

    // A and B are chatting; C finds nobody.
    expect(a.status).toBe('chatting');
    expect(b.status).toBe('chatting');
    const matchC = await mm.findMatch(c.id);
    expect(matchC).toBeNull();
    expect(await mm.queuedCount()).toBe(1);
  });

  it('never matches a user with themselves', async () => {
    const a = await queuedSession('sock-a');
    const match = await mm.findMatch(a.id);
    expect(match).toBeNull();
  });

  it('rejects duplicate queue joins and in-room joins', async () => {
    const a = await queuedSession('sock-a');
    const dup = await mm.joinQueue(a.id);
    expect(dup).toEqual({ ok: false, code: 'already_queued' });

    const b = await queuedSession('sock-b');
    await mm.findMatch(a.id);
    const inRoom = await mm.joinQueue(a.id);
    expect(inRoom).toEqual({ ok: false, code: 'in_room' });
    expect(b.status).toBe('chatting');
  });

  it('next: ends the room and re-queues the requester', async () => {
    const a = await queuedSession('sock-a');
    const b = await queuedSession('sock-b');
    const c = await queuedSession('sock-c');

    const first = await mm.findMatch(a.id);
    expect(first!.partner.id).toBe(b.id);
    const roomId = first!.room.id;

    const { match, endedRoomId, queued } = await mm.next(a.id);
    expect(queued).toBe(true);
    expect(endedRoomId).toBe(roomId);
    // B is back online, not in a room.
    expect(b.status).toBe('online');
    expect(b.roomId).toBeNull();
    // A immediately matches with waiting C.
    expect(match).not.toBeNull();
    expect(match!.partner.id).toBe(c.id);
  });

  it('never matches blocked pairs', async () => {
    const a = await queuedSession('sock-a');
    const b = await queuedSession('sock-b');
    mm.addBlock(a.id, b.id);

    const match = await mm.findMatch(a.id);
    expect(match).toBeNull();

    const c = await queuedSession('sock-c');
    const match2 = await mm.findMatch(a.id);
    expect(match2!.partner.id).toBe(c.id);
  });

  it('bans a session after enough reports', async () => {
    const a = await queuedSession('sock-a');
    for (let i = 0; i < 4; i++) {
      expect(mm.recordReport(`reporter-${i}`, a.id).banned).toBe(false);
    }
    expect(mm.recordReport('reporter-4', a.id).banned).toBe(true);
    expect(mm.isBanned(a.id)).toBe(true);
  });

  it('disconnect removes the user from the queue and ends their room', async () => {
    const a = await queuedSession('sock-a');
    const b = await queuedSession('sock-b');
    await mm.findMatch(a.id);

    const result = await mm.handleDisconnect('sock-a');
    expect(result).not.toBeNull();
    expect(result!.partner!.id).toBe(b.id);
    expect(result!.endedRoomId).not.toBeNull();
    expect(b.status).toBe('online');
    expect(b.roomId).toBeNull();
    expect(await mm.queuedCount()).toBe(0);
  });

  it('disconnect while queued just dequeues', async () => {
    const a = await queuedSession('sock-a');
    await mm.handleDisconnect('sock-a');
    expect(await mm.queuedCount()).toBe(0);
  });

  it('assertMember validates room membership', async () => {
    const a = await queuedSession('sock-a');
    const b = await queuedSession('sock-b');
    const c = await queuedSession('sock-c');
    const match = (await mm.findMatch(a.id))!;
    expect(mm.assertMember(match.room, a.id)).toBe(true);
    expect(mm.assertMember(match.room, b.id)).toBe(true);
    expect(mm.assertMember(match.room, c.id)).toBe(false);
  });
});

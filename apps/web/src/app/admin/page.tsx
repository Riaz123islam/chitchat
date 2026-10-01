// Admin moderation panel (unlisted route). Token-gated: the admin enters the
// ADMIN_TOKEN once per browser session; it's sent as x-admin-token to the
// chat server's /admin API. Not linked from the public site.
'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { resolveSocketUrl } from '@/lib/socket';

function apiBase(): string {
  if (typeof window === 'undefined') return '';
  return `${resolveSocketUrl()}/admin`;
}

function getToken(): string | null {
  try {
    return sessionStorage.getItem('chitchat:admin-token');
  } catch {
      /* ignore */
    return null;
  }
}

interface Stats {
  online: number;
  queued: number;
  activeRooms: number;
  flaggedRooms: number;
  blocked: number;
  uptimeSec: number;
}

interface RoomPeer {
  sessionId: string;
  username: string;
  ip: string | null;
}

interface RoomInfo {
  roomId: string;
  startedAt: number;
  messageCount: number;
  flaggedCount: number;
  a: RoomPeer | null;
  b: RoomPeer | null;
}

interface ModMessage {
  id: string;
  sessionId: string;
  username: string;
  text: string;
  ts: number;
  flagged: boolean;
}

interface BlockRecord {
  sessionId?: string;
  ip?: string;
  reason: string;
  createdAt: number;
}

function timeAgo(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

export default function AdminPage() {
  const [token, setToken] = useState<string | null>(null);
  const [tokenInput, setTokenInput] = useState('');
  const [authError, setAuthError] = useState('');
  const [stats, setStats] = useState<Stats | null>(null);
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [blocks, setBlocks] = useState<BlockRecord[]>([]);
  const [tab, setTab] = useState<'chats' | 'blocks'>('chats');
  const [openRoom, setOpenRoom] = useState<string | null>(null);
  const [messages, setMessages] = useState<ModMessage[]>([]);
  const [notice, setNotice] = useState('');
  const lastTs = useRef(0);

  useEffect(() => {
    setToken(getToken());
  }, []);

  const api = useCallback(
    async (path: string, init?: Parameters<typeof fetch>[1]) => {
      const res = await fetch(`${apiBase()}${path}`, {
        ...init,
        headers: { 'x-admin-token': token ?? '', 'content-type': 'application/json', ...(init?.headers ?? {}) },
      });
      if (res.status === 401) {
        try {
          sessionStorage.removeItem('chitchat:admin-token');
        } catch {
      /* ignore */}
        setToken(null);
        setAuthError('Wrong token. Try again.');
        throw new Error('unauthorized');
      }
      if (!res.ok) throw new Error(`request failed: ${res.status}`);
      return res.json();
    },
    [token],
  );

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const [s, r, b] = await Promise.all([
        api('/stats'),
        api('/rooms'),
        api('/blocks'),
      ]);
      setStats(s);
      setRooms(r.rooms);
      setBlocks(b.blocks);
    } catch {
      /* auth errors handled in api() */
    }
  }, [api, token]);

  useEffect(() => {
    if (!token) return;
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [token, refresh]);

  // Live message polling for the open room.
  useEffect(() => {
    if (!token || !openRoom) return;
    lastTs.current = 0;
    setMessages([]);
    let cancelled = false;
    const load = async () => {
      try {
        const data = await api(`/rooms/${openRoom}/messages?after=${lastTs.current}`);
        if (cancelled) return;
        const msgs: ModMessage[] = data.messages;
        if (msgs.length > 0) {
          lastTs.current = Math.max(...msgs.map((m) => m.ts), lastTs.current);
          setMessages((prev) => [...prev, ...msgs]);
        }
      } catch {
      /* ignore */
        /* ignore transient failures */
      }
    };
    load();
    const t = setInterval(load, 3000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [token, openRoom, api]);

  const submitToken = (e: FormEvent) => {
    e.preventDefault();
    const t = tokenInput.trim();
    if (!t) return;
    try {
      sessionStorage.setItem('chitchat:admin-token', t);
    } catch {
      /* ignore */}
    setAuthError('');
    setToken(t);
  };

  const blockPeer = async (peer: RoomPeer, roomId: string) => {
    if (!window.confirm(`Block ${peer.username}? They'll be disconnected immediately and can't come back.`)) return;
    try {
      await api('/block', {
        method: 'POST',
        body: JSON.stringify({ sessionId: peer.sessionId, ip: peer.ip, reason: 'moderator block from admin panel' }),
      });
      setNotice(`Blocked ${peer.username}.`);
      setOpenRoom((r) => (r === roomId ? null : r));
      refresh();
    } catch {
      /* ignore */
      setNotice('Block failed.');
    }
  };

  const unblock = async (b: BlockRecord) => {
    try {
      await api('/unblock', { method: 'POST', body: JSON.stringify({ sessionId: b.sessionId, ip: b.ip }) });
      setNotice('Unblocked.');
      refresh();
    } catch {
      /* ignore */
      setNotice('Unblock failed.');
    }
  };

  if (!token) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-4">
        <form onSubmit={submitToken} className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-900 p-6">
          <h1 className="text-lg font-semibold text-zinc-100">Moderation sign in</h1>
          <p className="mt-1 text-sm text-zinc-400">Enter the admin token to monitor chats.</p>
          <input
            type="password"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            placeholder="Admin token"
            className="mt-4 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-indigo-400 focus:outline-none"
          />
          {authError && <p className="mt-2 text-sm text-red-400">{authError}</p>}
          <button
            type="submit"
            className="mt-4 w-full rounded-xl bg-indigo-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-400"
          >
            Sign in
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-zinc-950 px-4 py-6 text-zinc-100">
      <div className="mx-auto max-w-5xl">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold">ChitChat moderation</h1>
          <button
            onClick={() => {
              try {
                sessionStorage.removeItem('chitchat:admin-token');
              } catch {
      /* ignore */}
              setToken(null);
            }}
            className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
          >
            Sign out
          </button>
        </div>

        {notice && (
          <p className="mt-3 rounded-xl bg-indigo-500/10 px-4 py-2 text-sm text-indigo-200">{notice}</p>
        )}

        {stats && (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Stat label="Online" value={stats.online} />
            <Stat label="In queue" value={stats.queued} />
            <Stat label="Active chats" value={stats.activeRooms} />
            <Stat label="Flagged chats" value={stats.flaggedRooms} alert={stats.flaggedRooms > 0} />
            <Stat label="Blocked" value={stats.blocked} />
          </div>
        )}

        <div className="mt-6 flex gap-2">
          <Tab active={tab === 'chats'} onClick={() => setTab('chats')}>
            Live chats ({rooms.length})
          </Tab>
          <Tab active={tab === 'blocks'} onClick={() => setTab('blocks')}>
            Blocklist ({blocks.length})
          </Tab>
        </div>

        {tab === 'chats' && (
          <div className="mt-4 space-y-3">
            {rooms.length === 0 && <p className="text-sm text-zinc-500">No active chats right now.</p>}
            {rooms.map((room) => (
              <div key={room.roomId} className="rounded-2xl border border-zinc-800 bg-zinc-900 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm">
                    <span className="font-semibold text-zinc-100">{room.a?.username ?? '?'}</span>
                    <span className="text-zinc-500"> ↔ </span>
                    <span className="font-semibold text-zinc-100">{room.b?.username ?? '?'}</span>
                    <span className="ml-2 text-xs text-zinc-500">started {timeAgo(room.startedAt)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {room.flaggedCount > 0 && (
                      <span className="rounded-full bg-red-500/15 px-2.5 py-1 text-xs font-semibold text-red-300">
                        {room.flaggedCount} flagged
                      </span>
                    )}
                    <span className="text-xs text-zinc-500">{room.messageCount} msgs</span>
                    <button
                      onClick={() => setOpenRoom((r) => (r === room.roomId ? null : room.roomId))}
                      className="rounded-lg bg-indigo-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-400"
                    >
                      {openRoom === room.roomId ? 'Hide' : 'View chat'}
                    </button>
                  </div>
                </div>

                {openRoom === room.roomId && (
                  <div className="mt-3 border-t border-zinc-800 pt-3">
                    <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                      {messages.length === 0 && (
                        <p className="text-sm text-zinc-500">No messages yet — new ones appear live.</p>
                      )}
                      {messages.map((m) => (
                        <div
                          key={m.id}
                          className={`rounded-xl px-3 py-2 text-sm ${
                            m.flagged ? 'bg-red-500/10 text-red-100' : 'bg-zinc-800 text-zinc-200'
                          }`}
                        >
                          <span className="font-semibold">{m.username}</span>
                          {m.flagged && (
                            <span className="ml-2 rounded bg-red-500/20 px-1.5 py-0.5 text-[10px] font-bold text-red-300">
                              FLAGGED
                            </span>
                          )}
                          <p className="mt-0.5 break-words">{m.text}</p>
                        </div>
                      ))}
                    </div>
                    <div className="mt-3 flex gap-2">
                      {room.a && (
                        <button
                          onClick={() => blockPeer(room.a!, room.roomId)}
                          className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-500"
                        >
                          Block {room.a.username}
                        </button>
                      )}
                      {room.b && (
                        <button
                          onClick={() => blockPeer(room.b!, room.roomId)}
                          className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-500"
                        >
                          Block {room.b.username}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {tab === 'blocks' && (
          <div className="mt-4 space-y-2">
            {blocks.length === 0 && <p className="text-sm text-zinc-500">Nobody blocked.</p>}
            {blocks.map((b, i) => (
              <div
                key={`${b.sessionId ?? ''}-${b.ip ?? ''}-${i}`}
                className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3"
              >
                <div className="text-sm">
                  <p className="text-zinc-200">
                    {b.sessionId ? `session ${b.sessionId.slice(0, 8)}…` : ''}
                    {b.sessionId && b.ip ? ' · ' : ''}
                    {b.ip ? `ip ${b.ip}` : ''}
                  </p>
                  <p className="text-xs text-zinc-500">
                    {b.reason} · {timeAgo(b.createdAt)}
                  </p>
                </div>
                <button
                  onClick={() => unblock(b)}
                  className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800"
                >
                  Unblock
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function Stat({ label, value, alert }: { label: string; value: number; alert?: boolean }) {
  return (
    <div className={`rounded-2xl border p-4 ${alert ? 'border-red-800 bg-red-500/5' : 'border-zinc-800 bg-zinc-900'}`}>
      <p className={`text-2xl font-bold ${alert ? 'text-red-300' : 'text-zinc-100'}`}>{value}</p>
      <p className="text-xs text-zinc-500">{label}</p>
    </div>
  );
}

function Tab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-xl px-4 py-2 text-sm font-semibold ${
        active ? 'bg-indigo-500 text-white' : 'border border-zinc-700 text-zinc-300 hover:bg-zinc-800'
      }`}
    >
      {children}
    </button>
  );
}

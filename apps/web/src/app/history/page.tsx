'use client';

// Chat history. Signed-in users read from the server (/api/history);
// guests read the history kept in this browser's cache.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Brand, GhostButton } from '@/components/ui';
import { useAuth } from '@/components/auth-provider';
import { loadGuestHistory, type GuestChat } from '@/lib/guestHistory';
import { resolveSocketUrl } from '@/lib/socket';

interface ServerChat {
  id: string;
  room_id: string;
  partner_username: string;
  /** The account owner's anonymous username in that chat (for mine/theirs). */
  username: string;
  messages: Array<{ id: string; sender: string; text: string; ts: number }>;
  end_reason: string | null;
  ended_at: string;
}

interface ChatView {
  key: string;
  partnerUsername: string;
  endedAt: number;
  messages: Array<{ id: string; sender: string; text: string; ts: number; mine: boolean }>;
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const day = sameDay ? 'Today' : d.toDateString() === yesterday.toDateString() ? 'Yesterday' : d.toLocaleDateString();
  return `${day}, ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

export default function HistoryPage() {
  const { loading, user, getAccessToken, signOut } = useAuth();
  const [chats, setChats] = useState<ChatView[] | null>(null);
  const [selected, setSelected] = useState<ChatView | null>(null);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (loading) return;
    const load = async () => {
      if (user) {
        try {
          const token = await getAccessToken();
          const res = await fetch(`${resolveSocketUrl()}/api/history`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            cache: 'no-store',
          });
          if (!res.ok) throw new Error(res.status === 401 ? 'auth' : 'server');
          const data = (await res.json()) as { chats: ServerChat[] };
          setChats(
            data.chats.map((c) => ({
              key: c.id,
              partnerUsername: c.partner_username,
              endedAt: new Date(c.ended_at).getTime(),
              messages: c.messages.map((m) => ({ ...m, mine: m.sender === c.username })),
            })),
          );
        } catch {
          setError('Could not load your history. Try again later.');
          setChats([]);
        }
      } else {
        setChats(
          loadGuestHistory().map((c: GuestChat) => ({
            key: c.roomId,
            partnerUsername: c.partnerUsername,
            endedAt: c.endedAt,
            messages: c.messages,
          })),
        );
      }
    };
    load();
  }, [loading, user, getAccessToken]);

  if (loading || chats === null) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <p className="text-zinc-500">Loading history…</p>
      </div>
    );
  }

  const deleteAccount = async () => {
    setDeleting(true);
    try {
      const token = await getAccessToken();
      const res = await fetch(`${resolveSocketUrl()}/api/account`, {
        method: 'DELETE',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error('delete failed');
      await signOut();
      window.location.href = '/';
    } catch {
      setError('Could not delete your account. Try again later.');
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="px-6 py-4">
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <Brand compact />
          <Link href="/">
            <GhostButton>Home</GhostButton>
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 pb-16">
        <h1 className="text-2xl font-bold tracking-tight">Chat history</h1>
        <p className="mt-2 text-sm text-zinc-400">
          {user
            ? 'Saved to your account — available on every device.'
            : 'Saved only in this browser. Sign up to keep history across devices.'}
        </p>

        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

        {!error && chats.length === 0 && (
          <div className="mt-10 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-8 text-center">
            <p className="text-zinc-300">No chats yet.</p>
            <p className="mt-2 text-sm text-zinc-500">
              Finished conversations will appear here.
            </p>
            <div className="mt-6">
              <Link href="/">
                <GhostButton>Start chatting</GhostButton>
              </Link>
            </div>
          </div>
        )}

        {selected ? (
          <div className="mt-6">
            <button
              onClick={() => setSelected(null)}
              className="text-sm text-indigo-400 hover:text-indigo-300"
            >
              ← All chats
            </button>            <h2 className="mt-3 font-semibold text-zinc-100">
              Chat with {selected.partnerUsername}
            </h2>
            <p className="text-xs text-zinc-500">{formatDate(selected.endedAt)}</p>
            <div className="mt-4 flex flex-col gap-2">
              {selected.messages.map((m) => (
                <div
                  key={m.id}
                  className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm leading-relaxed ${
                    m.mine
                      ? 'self-end bg-indigo-500 text-white'
                      : 'self-start bg-zinc-800 text-zinc-100'
                  }`}
                >
                  <span className="mb-0.5 block text-[11px] opacity-70">{m.sender}</span>
                  {m.text}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="mt-6 flex flex-col gap-2">
            {chats.map((c) => {
              const preview = c.messages[c.messages.length - 1];
              return (
                <button
                  key={c.key}
                  onClick={() => setSelected(c)}
                  className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 text-left transition hover:border-zinc-600"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-medium text-zinc-100">{c.partnerUsername}</span>
                    <span className="shrink-0 text-xs text-zinc-500">{formatDate(c.endedAt)}</span>
                  </div>
                  {preview && (
                    <p className="mt-1 truncate text-sm text-zinc-400">
                      {preview.mine ? 'You: ' : ''}
                      {preview.text}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-zinc-600">{c.messages.length} messages</p>
                </button>
              );
            })}
          </div>
        )}

        {user && !selected && (
          <div className="mt-10 rounded-2xl border border-red-500/20 bg-red-500/5 p-5">
            <h2 className="text-sm font-semibold text-red-200">Danger zone</h2>
            {!confirmDelete ? (
              <>
                <p className="mt-2 text-sm text-zinc-400">
                  Permanently delete your account and all of your chat history.
                </p>
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="mt-3 rounded-full border border-red-500/40 px-4 py-2 text-sm font-medium text-red-300 transition hover:bg-red-500/10"
                >
                  Delete my account
                </button>
              </>
            ) : (
              <>
                <p className="mt-2 text-sm text-zinc-300">
                  This cannot be undone. Delete your account and all chat history?
                </p>
                <div className="mt-3 flex gap-3">
                  <button
                    onClick={deleteAccount}
                    disabled={deleting}
                    className="rounded-full bg-red-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-400 disabled:opacity-50"
                  >
                    {deleting ? 'Deleting…' : 'Yes, delete everything'}
                  </button>
                  <button
                    onClick={() => setConfirmDelete(false)}
                    disabled={deleting}
                    className="rounded-full border border-zinc-700 px-4 py-2 text-sm text-zinc-300 transition hover:border-zinc-500"
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

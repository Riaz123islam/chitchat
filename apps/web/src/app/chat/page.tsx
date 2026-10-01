'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { getSocket, resetSocket } from '@/lib/socket';
import { clearSession, loadSession, saveSession, type ChatSession } from '@/lib/session';
import { GhostButton } from '@/components/ui';

interface ChatMsg {
  id: string;
  sender: string;
  text: string;
  ts: number;
  mine: boolean;
  system?: boolean;
}

type Phase = 'restoring' | 'searching' | 'chatting' | 'partner-left' | 'connection-lost';

const REPORT_REASONS = [
  { id: 'harassment', label: 'Harassment or bullying' },
  { id: 'threats', label: 'Threats or intimidation' },
  { id: 'spam', label: 'Spam or flooding' },
  { id: 'scam', label: 'Scam or phishing' },
  { id: 'sexual_content', label: 'Sexual content' },
  { id: 'hate_speech', label: 'Hate speech' },
  { id: 'personal_info', label: 'Asking for personal info' },
  { id: 'other', label: 'Other' },
];

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 sm:items-center"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="animate-fade-up w-full max-w-sm rounded-2xl border border-zinc-700 bg-zinc-900 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold">{title}</h2>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

export default function ChatPage() {
  const router = useRouter();
  const [session, setSession] = useState<ChatSession | null>(null);
  const [phase, setPhase] = useState<Phase>('restoring');
  const [partner, setPartner] = useState('');
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [draft, setDraft] = useState('');
  const [typing, setTyping] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [notice, setNotice] = useState('');
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState('harassment');
  const [confirmAction, setConfirmAction] = useState<'block' | 'leave' | null>(null);

  const listRef = useRef<HTMLDivElement>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restoreTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionRef = useRef<ChatSession | null>(null);
  sessionRef.current = session;
  const partnerRef = useRef('');
  partnerRef.current = partner;
  const phaseRef = useRef<Phase>('restoring');
  phaseRef.current = phase;

  const showNotice = useCallback((text: string) => {
    setNotice(text);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(''), 4000);
  }, []);

  const pushSystem = useCallback((text: string) => {
    setMessages((m) => [
      ...m,
      { id: `sys-${Date.now()}-${Math.random()}`, sender: '', text, ts: Date.now(), mine: false, system: true },
    ]);
  }, []);

  // ── Socket lifecycle ─────────────────────────────────────────────────────
  useEffect(() => {
    const saved = loadSession();
    if (!saved) {
      router.replace('/');
      return;
    }
    setSession(saved);

    const socket = getSocket();
    setPhase('restoring');

    // Restore is idempotent server-side: re-emit until it answers, so a
    // single dropped handshake doesn't strand the user on the spinner.
    let resumeAttempts = 0;
    const resume = () => {
      const s = sessionRef.current;
      if (s && socket.connected) {
        resumeAttempts += 1;
        socket.emit('session:resume', { sessionId: s.sessionId });
      }
    };
    const retryTimer = setInterval(() => {
      if (phaseRef.current === 'restoring' && resumeAttempts < 4) resume();
    }, 7000);

    const onConnect = () => {
      setReconnecting(false);
      resume();
    };
    const onConnectError = () => {
      // Socket can't reach the server at all: don't leave the user on the
      // restoring spinner forever.
      if (phaseRef.current === 'restoring') setPhase('connection-lost');
    };
    const onReconnectAttempt = () => setReconnecting(true);
    const onDisconnect = () => setReconnecting(true);
    const onReconnect = () => {
      setReconnecting(false);
      resume();
    };

    const onRestored = (p: { partnerUsername: string }) => {
      setPartner(p.partnerUsername);
      setPhase('chatting');
      pushSystem(`Reconnected with ${p.partnerUsername}.`);
    };
    const onReady = (p: { sessionId: string; username: string }) => {
      // Resume found no live room → back to searching.
      saveSession(p);
      setSession(p);
      setPhase('searching');
      socket.emit('queue:join');
    };
    const onSessionError = (p: { code: string; message: string }) => {
      if (p.code === 'unknown_session' || p.code === 'invalid_session') {
        clearSession();
        router.replace('/');
      } else {
        showNotice(p.message);
        setPhase('connection-lost');
      }
    };
    const onMatch = (p: { partnerUsername: string }) => {
      setPartner(p.partnerUsername);
      setMessages([]);
      setPhase('chatting');
      pushSystem(`You're now chatting with ${p.partnerUsername}. Say hi!`);
    };
    const onMessage = (m: { id: string; sender: string; text: string; ts: number }) => {
      const me = sessionRef.current?.username === m.sender;
      setMessages((prev) => {
        if (prev.some((x) => x.id === m.id)) return prev;
        return [...prev, { ...m, mine: me }];
      });
    };
    const onMessageError = (p: { code: string; message: string }) => showNotice(p.message);
    const onTyping = (p: { username: string; typing: boolean }) => {
      if (p.username !== sessionRef.current?.username) setTyping(p.typing);
    };
    const onPartnerLeft = (p: { reason: string }) => {
      setTyping(false);
      setPhase('partner-left');
      pushSystem(
        p.reason === 'next'
          ? `${partnerRef.current || 'Stranger'} moved on to someone new.`
          : 'Stranger disconnected.',
      );
    };
    const onNextSearching = () => {
      setMessages([]);
      setPhase('searching');
    };
    const onRoomEnded = () => {
      clearSession();
      resetSocket();
      router.replace('/');
    };
    const onQueueError = (p: { code: string; message: string }) => {
      showNotice(p.message);
      setPhase('searching');
    };
    const onReportOk = () => {
      setReportOpen(false);
      showNotice('Report received. Thanks for helping keep ChitChat safe.');
    };
    const onBlockOk = () => {
      setConfirmAction(null);
      showNotice('User blocked. You will not be matched with them again.');
      setMessages([]);
      setPhase('searching');
      socket.emit('queue:join');
    };

    socket.on('connect', onConnect);
    socket.on('connect_error', onConnectError);
    socket.io.on('reconnect_attempt', onReconnectAttempt);
    socket.on('disconnect', onDisconnect);
    socket.io.on('reconnect', onReconnect);
    socket.on('room:restored', onRestored);
    socket.on('session:ready', onReady);
    socket.on('session:error', onSessionError);
    socket.on('match:found', onMatch);
    socket.on('message:new', onMessage);
    socket.on('message:error', onMessageError);
    socket.on('typing:update', onTyping);
    socket.on('partner:left', onPartnerLeft);
    socket.on('next:searching', onNextSearching);
    socket.on('room:ended', onRoomEnded);
    socket.on('queue:error', onQueueError);
    socket.on('report:ok', onReportOk);
    socket.on('block:ok', onBlockOk);

    if (socket.connected) resume();

    // Safety net: if the restore handshake never completes (server not
    // answering, dropped events), stop spinning and offer a retry.
    restoreTimer.current = setTimeout(() => {
      if (phaseRef.current === 'restoring') setPhase('connection-lost');
    }, 32_000);

    const ping = setInterval(() => {
      if (socket.connected) socket.emit('presence:ping');
    }, 30_000);

    return () => {
      clearInterval(ping);
      clearInterval(retryTimer);
      if (restoreTimer.current) clearTimeout(restoreTimer.current);
      if (typingTimer.current) clearTimeout(typingTimer.current);
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
      socket.off('connect', onConnect);
      socket.off('connect_error', onConnectError);
      socket.io.off('reconnect_attempt', onReconnectAttempt);
      socket.off('disconnect', onDisconnect);
      socket.io.off('reconnect', onReconnect);
      socket.off('room:restored', onRestored);
      socket.off('session:ready', onReady);
      socket.off('session:error', onSessionError);
      socket.off('match:found', onMatch);
      socket.off('message:new', onMessage);
      socket.off('message:error', onMessageError);
      socket.off('typing:update', onTyping);
      socket.off('partner:left', onPartnerLeft);
      socket.off('next:searching', onNextSearching);
      socket.off('room:ended', onRoomEnded);
      socket.off('queue:error', onQueueError);
      socket.off('report:ok', onReportOk);
      socket.off('block:ok', onBlockOk);
    };
  }, [router, pushSystem, showNotice]);

  // ── Auto-scroll ──────────────────────────────────────────────────────────
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, typing, phase]);

  // ── Actions ──────────────────────────────────────────────────────────────
  const send = useCallback(() => {
    const text = draft.trim();
    if (!text || phase !== 'chatting') return;
    if (text.length > 2000) {
      showNotice('Messages are limited to 2000 characters.');
      return;
    }
    getSocket().emit('message:send', { text });
    getSocket().emit('typing:stop');
    if (typingTimer.current) clearTimeout(typingTimer.current);
    setDraft('');
  }, [draft, phase, showNotice]);

  const handleDraft = (value: string) => {
    setDraft(value);
    const socket = getSocket();
    if (phase !== 'chatting') return;
    if (value.trim()) {
      socket.emit('typing:start');
      if (typingTimer.current) clearTimeout(typingTimer.current);
      typingTimer.current = setTimeout(() => socket.emit('typing:stop'), 2000);
    } else {
      socket.emit('typing:stop');
    }
  };

  const doNext = () => {
    setTyping(false);
    setPhase('searching');
    getSocket().emit('chat:next');
  };

  const doLeave = () => {
    try {
      getSocket().emit('chat:leave');
    } catch {
      /* ignore */
    }
    clearSession();
    resetSocket();
    router.push('/');
  };

  const doBlock = () => {
    getSocket().emit('user:block');
  };

  const doReport = () => {
    getSocket().emit('user:report', { reason: reportReason });
  };

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="flex h-dvh flex-col bg-zinc-950">
      {/* Header */}
      <header className="border-b border-zinc-800/80 px-4 py-3">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="relative flex h-2.5 w-2.5 shrink-0">
              <span
                className={`absolute inline-flex h-full w-full rounded-full ${
                  phase === 'chatting' ? 'bg-emerald-400' : 'bg-zinc-600'
                }`}
              />
              {phase === 'chatting' && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              )}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">
                {phase === 'chatting' || phase === 'partner-left'
                  ? partner || 'Stranger'
                  : phase === 'searching'
                    ? 'Finding a stranger…'
                    : 'ChitChat'}
              </p>
              <p className="text-xs text-zinc-500">
                {phase === 'chatting'
                  ? 'Online now'
                  : phase === 'searching'
                    ? 'In queue'
                    : reconnecting
                      ? 'Reconnecting…'
                      : 'Anonymous chat'}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {(phase === 'chatting' || phase === 'partner-left') && (
              <>
                <GhostButton onClick={doNext} title="End this chat and find someone new">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M5 4l10 8-10 8V4Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                    <path d="M19 5v14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  </svg>
                  Next
                </GhostButton>
                <GhostButton onClick={() => setReportOpen(true)} title="Report this user">
                  Report
                </GhostButton>
                <GhostButton onClick={() => setConfirmAction('block')} title="Block this user">
                  Block
                </GhostButton>
              </>
            )}
            <GhostButton onClick={() => setConfirmAction('leave')} title="Leave the chat">
              Leave
            </GhostButton>
          </div>
        </div>
      </header>

      {reconnecting && (
        <div className="bg-amber-500/10 px-4 py-2 text-center text-xs text-amber-200">
          Connection interrupted — reconnecting…
        </div>
      )}

      {/* Messages */}
      <div ref={listRef} className="chat-scroll mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-4 py-4">
        {phase === 'restoring' || phase === 'searching' ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="h-10 w-10 animate-spin rounded-full border-2 border-zinc-700 border-t-indigo-400" />
            <p className="mt-4 text-sm text-zinc-400">
              {phase === 'restoring' ? 'Restoring your session…' : 'Looking for a stranger…'}
            </p>
          </div>
        ) : phase === 'connection-lost' ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <p className="text-sm text-zinc-400">Lost connection to the chat server.</p>
            <div className="mt-4">
              <GhostButton onClick={() => router.push('/searching')}>Try again</GhostButton>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {messages.length === 0 && phase === 'chatting' && (
              <p className="py-10 text-center text-sm text-zinc-500">
                No messages yet. Say hi — you&rsquo;re completely anonymous.
              </p>
            )}
            {messages.map((m) =>
              m.system ? (
                <p
                  key={m.id}
                  className="animate-fade-up mx-auto rounded-full bg-zinc-800/80 px-4 py-1.5 text-center text-xs text-zinc-400"
                >
                  {m.text}
                </p>
              ) : (
                <div key={m.id} className={`flex ${m.mine ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[80%] rounded-2xl px-4 py-2.5 sm:max-w-[70%] ${
                      m.mine
                        ? 'rounded-br-md bg-indigo-500 text-white'
                        : 'rounded-bl-md bg-zinc-800 text-zinc-100'
                    }`}
                  >
                    {!m.mine && (
                      <p className="mb-0.5 text-xs font-semibold text-indigo-300">{m.sender}</p>
                    )}
                    {/* React escapes text content by default — no HTML injection possible. */}
                    <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">{m.text}</p>
                    <p className={`mt-1 text-right text-[11px] ${m.mine ? 'text-indigo-200' : 'text-zinc-500'}`}>
                      {fmtTime(m.ts)}
                    </p>
                  </div>
                </div>
              ),
            )}
            {typing && phase === 'chatting' && (
              <div className="flex justify-start">
                <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-md bg-zinc-800 px-4 py-3">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="h-1.5 w-1.5 animate-typing-bounce rounded-full bg-zinc-400"
                      style={{ animationDelay: `${i * 0.2}s` }}
                    />
                  ))}
                </div>
              </div>
            )}
            {phase === 'partner-left' && (
              <div className="animate-fade-up mx-auto mt-2 flex flex-col items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/60 px-6 py-5 text-center">
                <p className="text-sm text-zinc-300">The stranger left the chat.</p>
                <div className="flex gap-2">
                  <GhostButton onClick={doNext}>Find someone new</GhostButton>
                  <GhostButton onClick={doLeave}>Leave</GhostButton>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Input */}
      {phase === 'chatting' && (
        <div className="border-t border-zinc-800/80 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
          <div className="mx-auto flex max-w-2xl items-end gap-2">
            <textarea
              value={draft}
              onChange={(e) => handleDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder="Type a message… (Enter to send)"
              rows={1}
              maxLength={2000}
              aria-label="Message"
              className="chat-input max-h-32 flex-1 rounded-2xl border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-[15px] text-zinc-100 placeholder:text-zinc-500 focus:border-indigo-400 focus:outline-none"
            />
            <button
              type="button"
              onClick={send}
              disabled={!draft.trim()}
              aria-label="Send message"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-indigo-500 text-white shadow-lg shadow-indigo-500/25 transition hover:bg-indigo-400 active:scale-95 disabled:opacity-40"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7Z"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
          <p className="mx-auto mt-1.5 max-w-2xl text-center text-[11px] text-zinc-600">
            You&rsquo;re anonymous. Never share personal information.
          </p>
        </div>
      )}

      {/* Toast */}
      {notice && (
        <div className="fixed bottom-24 left-1/2 z-40 w-max max-w-[90vw] -translate-x-1/2 animate-fade-up rounded-full bg-zinc-800 px-5 py-2.5 text-center text-sm text-zinc-100 shadow-xl">
          {notice}
        </div>
      )}

      {/* Report modal */}
      {reportOpen && (
        <Modal title="Report user" onClose={() => setReportOpen(false)}>
          <p className="text-sm text-zinc-400">
            Reporting <span className="font-semibold text-zinc-200">{partner || 'this user'}</span>. No
            message content is stored with your report.
          </p>
          <div className="mt-4 flex flex-col gap-2">
            {REPORT_REASONS.map((r) => (
              <label
                key={r.id}
                className={`flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-2.5 text-sm transition ${
                  reportReason === r.id
                    ? 'border-indigo-400 bg-indigo-500/10'
                    : 'border-zinc-700 hover:border-zinc-500'
                }`}
              >
                <input
                  type="radio"
                  name="report-reason"
                  checked={reportReason === r.id}
                  onChange={() => setReportReason(r.id)}
                  className="accent-indigo-500"
                />
                {r.label}
              </label>
            ))}
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <GhostButton onClick={() => setReportOpen(false)}>Cancel</GhostButton>
            <button
              type="button"
              onClick={doReport}
              className="rounded-full bg-red-500 px-5 py-2 text-sm font-semibold text-white transition hover:bg-red-400 active:scale-[0.98]"
            >
              Submit report
            </button>
          </div>
        </Modal>
      )}

      {/* Confirm modal */}
      {confirmAction && (
        <Modal
          title={confirmAction === 'block' ? 'Block this user?' : 'Leave the chat?'}
          onClose={() => setConfirmAction(null)}
        >
          <p className="text-sm leading-relaxed text-zinc-400">
            {confirmAction === 'block'
              ? 'They will be removed from this chat and you will never be matched with them again.'
              : 'This ends the conversation for both of you. Your anonymous session will be discarded.'}
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <GhostButton onClick={() => setConfirmAction(null)}>Cancel</GhostButton>
            <button
              type="button"
              onClick={() => {
                if (confirmAction === 'block') doBlock();
                else doLeave();
              }}
              className="rounded-full bg-indigo-500 px-5 py-2 text-sm font-semibold text-white transition hover:bg-indigo-400 active:scale-[0.98]"
            >
              Confirm
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

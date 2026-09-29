'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getSocket, resetSocket } from '@/lib/socket';
import { loadSession, saveSession } from '@/lib/session';
import { Brand, GhostButton } from '@/components/ui';

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

// Minimal typing for the Cloudflare Turnstile widget API (loaded via script tag).
const getTurnstile = (): any => (window as unknown as { turnstile?: unknown }).turnstile;

interface TokenCallback {
  // eslint-disable-next-line no-unused-vars -- parameter name required by TS, only the type is used
  (token: string): void;
}

function TurnstileWidget({ onToken }: { onToken: TokenCallback }) {
  const ref = useRef<HTMLDivElement>(null);
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;

  useEffect(() => {
    let widgetId: string | undefined;
    let disposed = false;
    const render = () => {
      const w = getTurnstile();
      if (!disposed && w && ref.current && !widgetId) {
        widgetId = w.render(ref.current, {
          sitekey: TURNSTILE_SITE_KEY,
          theme: 'dark',
          callback: (token: string) => onTokenRef.current(token),
        });
      }
    };
    render();
    const existing = document.querySelector('script[data-cf-turnstile]');
    if (!existing) {
      const script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
      script.async = true;
      script.defer = true;
      script.dataset.cfTurnstile = '1';
      script.onload = render;
      document.head.appendChild(script);
    }
    const t = setInterval(render, 800);
    return () => {
      disposed = true;
      clearInterval(t);
      try {
        const w = getTurnstile();
        if (widgetId && w) w.remove(widgetId);
      } catch {
        /* ignore */
      }
    };
  }, []);

  return <div ref={ref} className="flex justify-center" />;
}

type Phase = 'verifying' | 'connecting' | 'searching' | 'error';

export default function SearchingPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>(TURNSTILE_SITE_KEY ? 'verifying' : 'connecting');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0); // bump to retry
  const [token, setToken] = useState<string | undefined>(undefined);

  const start = useCallback(
    (turnstileToken?: string) => {
      const socket = getSocket();
      setPhase('connecting');
      setError('');

      const fail = (message: string) => {
        setError(message);
        setPhase('error');
      };

      const beginSearch = () => {
        const saved = loadSession();
        if (saved) {
          socket.emit('session:resume', { sessionId: saved.sessionId });
        } else {
          socket.emit('session:start', turnstileToken ? { turnstileToken } : {});
        }
      };

      const onConnect = () => beginSearch();
      const onReady = (p: { sessionId: string; username: string }) => {
        saveSession(p);
        socket.emit('queue:join');
        setPhase('searching');
      };
      const onRestored = () => router.replace('/chat');
      const onMatch = () => router.replace('/chat');
      const onQueueError = (p: { code: string; message: string }) => fail(p.message || 'Could not join the queue.');
      const onSessionError = (p: { code: string; message: string }) => {
        if (p.code === 'unknown_session' || p.code === 'invalid_session') {
          try {
            sessionStorage.removeItem('chitchat:session');
          } catch {
            /* ignore */
          }
          socket.emit('session:start', turnstileToken ? { turnstileToken } : {});
        } else {
          fail(p.message || 'Could not start a session.');
        }
      };
      const onConnectError = () => {
        // Render's free tier cold-starts in ~30-60s; surface that honestly.
        setError(
          'Still connecting… the server may be waking up (this can take up to a minute on the free tier).',
        );
      };

      socket.on('connect', onConnect);
      socket.on('session:ready', onReady);
      socket.on('room:restored', onRestored);
      socket.on('match:found', onMatch);
      socket.on('queue:error', onQueueError);
      socket.on('session:error', onSessionError);
      socket.on('connect_error', onConnectError);

      if (socket.connected) beginSearch();

      // If we're still not connected after 45s, show the error state.
      const watchdog = setTimeout(() => {
        if (!socket.connected) {
          setError(
            'Could not reach the chat server. It may be waking up — wait a moment and retry.',
          );
          setPhase('error');
        }
      }, 45_000);

      return () => {
        clearTimeout(watchdog);
        socket.off('connect', onConnect);
        socket.off('session:ready', onReady);
        socket.off('room:restored', onRestored);
        socket.off('match:found', onMatch);
        socket.off('queue:error', onQueueError);
        socket.off('session:error', onSessionError);
        socket.off('connect_error', onConnectError);
      };
    },
    [router],
  );

  useEffect(() => {
    if (TURNSTILE_SITE_KEY && !token) return; // wait for the challenge
    return start(token);
  }, [start, token, attempt]);

  const retry = () => {
    resetSocket();
    setAttempt((n) => n + 1);
  };

  const cancel = () => {
    try {
      getSocket().emit('queue:leave');
    } catch {
      /* ignore */
    }
    router.push('/');
  };

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="px-6 py-4">
        <div className="mx-auto max-w-3xl">
          <Brand compact />
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        {phase === 'verifying' && (
          <div className="animate-fade-up flex flex-col items-center gap-6">
            <h1 className="text-2xl font-bold tracking-tight">One quick check</h1>
            <p className="max-w-sm text-sm text-zinc-400">
              Please complete the verification below to start chatting.
            </p>
            <TurnstileWidget onToken={(t) => setToken(t)} />
          </div>
        )}

        {(phase === 'connecting' || phase === 'searching') && (
          <div className="animate-fade-up flex flex-col items-center">
            <div className="relative flex h-20 w-20 items-center justify-center">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-500 opacity-20" />
              <span className="absolute inline-flex h-14 w-14 animate-ping rounded-full bg-indigo-500 opacity-20 [animation-delay:0.4s]" />
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="text-indigo-400">
                <path
                  d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5c-1.5 0-2.9-.4-4.1-1L3 20l1.1-4.4A8.5 8.5 0 1 1 21 11.5Z"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <h1 className="mt-8 text-2xl font-bold tracking-tight">
              {phase === 'connecting' ? 'Connecting…' : 'Looking for a stranger…'}
            </h1>
            <p className="mt-3 max-w-sm text-sm leading-relaxed text-zinc-400">
              {phase === 'connecting'
                ? 'Setting up your anonymous session.'
                : 'You are in the queue. This usually takes a few seconds.'}
            </p>
            {error && <p className="mt-4 max-w-sm text-sm text-amber-300">{error}</p>}
            <div className="mt-8">
              <GhostButton onClick={cancel}>Cancel</GhostButton>
            </div>
          </div>
        )}

        {phase === 'error' && (
          <div className="animate-fade-up flex flex-col items-center">
            <h1 className="text-2xl font-bold tracking-tight">Hmm, that didn&rsquo;t work</h1>
            <p className="mt-3 max-w-sm text-sm leading-relaxed text-zinc-400">{error}</p>
            <div className="mt-8 flex gap-3">
              <GhostButton onClick={retry}>Try again</GhostButton>
              <GhostButton onClick={() => router.push('/')}>Go home</GhostButton>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

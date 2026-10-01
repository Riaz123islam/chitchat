'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Brand, Footer, Logo, PrimaryButton } from '@/components/ui';
import { useAuth } from '@/components/auth-provider';
import { resolveSocketUrl } from '@/lib/socket';

function useOnlineCount() {
  const [online, setOnline] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const base = resolveSocketUrl();
        const res = await fetch(`${base}/api/stats`, { cache: 'no-store' });
        if (res.ok && alive) {
          const data = (await res.json()) as { online: number };
          setOnline(data.online);
        }
      } catch {
        /* server asleep or unreachable — hide the count */
      }
    };
    load();
    const t = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  return online;
}

export default function LandingPage() {
  const router = useRouter();
  const online = useOnlineCount();
  const [nickname, setNickname] = useState('');
  const { enabled: authEnabled, loading: authLoading, user, signOut } = useAuth();

  const startChatting = () => {
    try {
      const clean = nickname.trim().replace(/\s+/g, ' ');
      if (clean) sessionStorage.setItem('chitchat:nickname', clean);
      else sessionStorage.removeItem('chitchat:nickname');
    } catch {
      /* storage unavailable — proceed with a random nickname */
    }
    router.push('/searching');
  };

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="px-6 py-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <Brand />
          {online !== null && online > 0 && (
            <div className="flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-300">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
              </span>
              {online} online now
            </div>
          )}
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
        <div className="animate-fade-up flex flex-col items-center">
          <Logo size={72} />
          <h1 className="mt-6 max-w-2xl text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
            Talk to someone you&rsquo;ve never met.
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-zinc-400">
            ChitChat pairs you with a random stranger for a private 1-to-1 text chat.
            Jump in as a guest — no sign-up needed — or create an account to keep
            your chat history across devices.
          </p>
          <div className="mt-9 flex flex-col items-center gap-3">
            <input
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder="Choose a nickname (optional)"
              maxLength={20}
              autoComplete="off"
              aria-label="Choose a nickname"
              className="w-64 rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-center text-zinc-100 placeholder:text-zinc-500 focus:border-violet-400 focus:outline-none"
            />
            <PrimaryButton onClick={startChatting}>
              Continue as Guest
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M5 12h14m-6-6 6 6-6 6"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </PrimaryButton>
            {!authLoading && (
              authEnabled ? (
                user ? (
                  <div className="flex items-center gap-3 text-sm text-zinc-400">
                    <span className="max-w-48 truncate">Signed in as {user.email}</span>
                    <Link href="/history" className="text-indigo-400 hover:text-indigo-300">
                      History
                    </Link>
                    <button
                      onClick={() => signOut()}
                      className="text-zinc-500 underline-offset-2 hover:text-zinc-300 hover:underline"
                    >
                      Log out
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-4 text-sm">
                    <Link href="/login" className="text-indigo-400 hover:text-indigo-300">
                      Log in
                    </Link>
                    <Link href="/signup" className="text-indigo-400 hover:text-indigo-300">
                      Sign up
                    </Link>
                    <Link href="/history" className="text-zinc-500 hover:text-zinc-300">
                      Guest history
                    </Link>
                  </div>
                )
              ) : (
                <Link href="/history" className="text-sm text-zinc-500 hover:text-zinc-300">
                  Guest history
                </Link>
              )
            )}
          </div>
          <p className="mt-4 text-sm text-zinc-500">
            Pick your own nickname, or we&rsquo;ll give you a random one like{' '}
            <span className="text-zinc-300">CuriousFox42</span>. Nobody knows who you are.
          </p>
        </div>

        <div className="mt-16 grid w-full max-w-4xl gap-4 text-left sm:grid-cols-3">
          {[
            {
              title: 'Guest-first, always',
              body: 'Chat instantly with no account. Guests stay anonymous; an optional account keeps history across devices.',
            },
            {
              title: 'One stranger at a time',
              body: 'Private rooms for exactly two people. Hit Next whenever you want someone new.',
            },
            {
              title: 'Built-in safety',
              body: 'Rate limits, profanity filtering, reporting and blocking keep chats civil.',
            },
          ].map((f) => (
            <div
              key={f.title}
              className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5"
            >
              <h2 className="font-semibold text-zinc-100">{f.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">{f.body}</p>
            </div>
          ))}
        </div>

        <div className="mt-10 max-w-xl rounded-2xl border border-amber-500/20 bg-amber-500/5 p-5 text-left">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-amber-200">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            A quick safety note
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-zinc-400">
            Strangers are still strangers. Never share personal information — your real name,
            address, photos, or social accounts. If someone makes you uncomfortable, report and
            block them, then move on.
          </p>
        </div>
      </main>

      <Footer />
    </div>
  );
}

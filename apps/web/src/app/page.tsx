'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Brand, Footer, Logo, PrimaryButton } from '@/components/ui';
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
            ChitChat pairs you with a random stranger for a private, anonymous 1-to-1 text chat.
            No sign-up. No names. No message history. Just conversation.
          </p>
          <div className="mt-9">
            <PrimaryButton onClick={() => router.push('/searching')}>
              Start Chatting
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
          </div>
          <p className="mt-4 text-sm text-zinc-500">
            You&rsquo;ll get a random nickname like <span className="text-zinc-300">CuriousFox42</span>.
            Nobody knows who you are.
          </p>
        </div>

        <div className="mt-16 grid w-full max-w-4xl gap-4 text-left sm:grid-cols-3">
          {[
            {
              title: 'Anonymous by default',
              body: 'No accounts, no emails, no phone numbers. Your session vanishes when you leave.',
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

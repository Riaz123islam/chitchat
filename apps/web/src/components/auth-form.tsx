'use client';

// Shared email+password form for the login and signup pages.

import { useState } from 'react';
import type { FormEvent } from 'react';
import { Brand, PrimaryButton } from '@/components/ui';

const inputClass =
  'w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-zinc-100 placeholder:text-zinc-500 focus:border-violet-400 focus:outline-none';

export function AuthForm({
  title,
  subtitle,
  submitLabel,
  onSubmit,
}: {
  title: string;
  subtitle: string;
  submitLabel: string;
  // eslint-disable-next-line no-unused-vars -- callback signature
  onSubmit: (email: string, password: string) => Promise<string | null>;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const cleanEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setError('Enter a valid email address.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    setBusy(true);
    const err = await onSubmit(cleanEmail, password);
    setBusy(false);
    if (err) setError(err);
  };

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="px-6 py-4">
        <div className="mx-auto max-w-3xl">
          <Brand compact />
        </div>
      </header>
      <main className="flex flex-1 items-center justify-center px-6">
        <form
          onSubmit={submit}
          className="animate-fade-up w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6"
        >
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          <p className="mt-2 text-sm text-zinc-400">{subtitle}</p>
          <div className="mt-6 flex flex-col gap-3">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email address"
              autoComplete="email"
              aria-label="Email address"
              className={inputClass}
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              autoComplete={title === 'Sign up' ? 'new-password' : 'current-password'}
              aria-label="Password"
              className={inputClass}
            />
          </div>
          {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
          <div className="mt-5">
            <PrimaryButton disabled={busy} type="submit">
              {busy ? 'Please wait…' : submitLabel}
            </PrimaryButton>
          </div>
        </form>
      </main>
    </div>
  );
}

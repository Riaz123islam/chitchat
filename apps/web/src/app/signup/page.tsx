'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AuthForm } from '@/components/auth-form';
import { useAuth } from '@/components/auth-provider';

export default function SignupPage() {
  const router = useRouter();
  const { enabled, loading, user, signUp } = useAuth();
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!loading && user) router.replace('/');
  }, [loading, user, router]);

  if (loading) return null;
  if (!enabled) {
    return (
      <div className="flex min-h-dvh items-center justify-center px-6 text-center">
        <p className="max-w-sm text-zinc-400">
          Accounts aren&rsquo;t available on this server yet — you can still chat as a guest.
        </p>
      </div>
    );
  }

  if (done) {
    return (
      <div className="flex min-h-dvh items-center justify-center px-6 text-center">
        <div className="max-w-sm">
          <h1 className="text-2xl font-bold tracking-tight">Check your inbox</h1>
          <p className="mt-3 text-sm leading-relaxed text-zinc-400">
            We sent a confirmation link to your email. Click it, then log in to start
            chatting with history.
          </p>
          <p className="mt-6 text-sm">
            <Link href="/login" className="text-indigo-400 hover:text-indigo-300">
              Go to login
            </Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <AuthForm
        title="Sign up"
        subtitle="One account, your chats saved across every device."
        submitLabel="Create account"
        onSubmit={async (email, password) => {
          const err = await signUp(email, password);
          // Supabase may require email confirmation before a session exists.
          if (!err) setDone(true);
          return err;
        }}
      />
      <p className="fixed bottom-6 left-0 right-0 text-center text-sm text-zinc-500">
        Already have an account?{' '}
        <Link href="/login" className="text-indigo-400 hover:text-indigo-300">
          Log in
        </Link>
      </p>
    </>
  );
}

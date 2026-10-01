'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AuthForm } from '@/components/auth-form';
import { useAuth } from '@/components/auth-provider';

export default function LoginPage() {
  const router = useRouter();
  const { enabled, loading, user, signIn } = useAuth();

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

  return (
    <>
      <AuthForm
        title="Log in"
        subtitle="Welcome back. Your chat history is waiting."
        submitLabel="Log in"
        onSubmit={async (email, password) => {
          const err = await signIn(email, password);
          if (!err) router.replace('/');
          return err;
        }}
      />
      <p className="fixed bottom-6 left-0 right-0 text-center text-sm text-zinc-500">
        New here?{' '}
        <Link href="/signup" className="text-indigo-400 hover:text-indigo-300">
          Create an account
        </Link>
      </p>
    </>
  );
}

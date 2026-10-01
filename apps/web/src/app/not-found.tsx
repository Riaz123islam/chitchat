import Link from 'next/link';
import { Brand } from '@/components/ui';

const linkCls =
  'inline-flex items-center justify-center gap-1.5 rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-200 transition hover:border-zinc-500 hover:bg-zinc-800 active:scale-[0.98]';

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="px-6 py-4">
        <div className="mx-auto max-w-3xl">
          <Brand compact />
        </div>
      </header>
      <main className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <p className="text-7xl font-bold text-zinc-800">404</p>
        <h1 className="mt-4 text-2xl font-bold tracking-tight">This stranger doesn&rsquo;t exist</h1>
        <p className="mt-3 max-w-sm text-sm text-zinc-400">
          The page you&rsquo;re looking for wandered off. Let&rsquo;s get you back to a real
          conversation.
        </p>
        <div className="mt-8 flex gap-3">
          <Link href="/searching" className={linkCls}>
            Start chatting
          </Link>
          <Link href="/" className={linkCls}>
            Go home
          </Link>
        </div>
      </main>
    </div>
  );
}

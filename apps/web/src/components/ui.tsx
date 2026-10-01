import Link from 'next/link';
import type { ReactNode } from 'react';

/** Original ChitChat mark: two overlapping speech bubbles. */
export function Logo({ size = 36 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
      className="shrink-0"
    >
      <path
        d="M8 10h24a6 6 0 0 1 6 6v10a6 6 0 0 1-6 6H20l-8 7v-7H8a6 6 0 0 1-6-6V16a6 6 0 0 1 6-6Z"
        fill="url(#cc-g1)"
      />
      <path
        d="M28 30h8a4 4 0 0 1 4 4v5a4 4 0 0 1-4 4h-2v4l-5-4h-1a4 4 0 0 1-4-4v-5a4 4 0 0 1 4-4Z"
        fill="#34d399"
        opacity="0.9"
      />
      <defs>
        <linearGradient id="cc-g1" x1="2" y1="10" x2="38" y2="39" gradientUnits="userSpaceOnUse">
          <stop stopColor="#818cf8" />
          <stop offset="1" stopColor="#6366f1" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <Logo size={compact ? 30 : 36} />
      <span className={`font-bold tracking-tight ${compact ? 'text-lg' : 'text-xl'}`}>
        ChitChat
      </span>
    </Link>
  );
}

export function PrimaryButton({
  children,
  onClick,
  disabled,
  type = 'button',
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center justify-center gap-2 rounded-full bg-indigo-500 px-8 py-3.5 text-base font-semibold text-white shadow-lg shadow-indigo-500/25 transition hover:bg-indigo-400 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

export function GhostButton({
  children,
  onClick,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="inline-flex items-center justify-center gap-1.5 rounded-full border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-200 transition hover:border-zinc-500 hover:bg-zinc-800 active:scale-[0.98]"
    >
      {children}
    </button>
  );
}

export function Footer() {
  return (
    <footer className="border-t border-zinc-800/80 px-6 py-8">
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-4 text-center">
        <Brand compact />
        <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-zinc-400">
          <Link href="/safety" className="transition hover:text-zinc-100">
            Safety
          </Link>
          <Link href="/privacy" className="transition hover:text-zinc-100">
            Privacy
          </Link>
          <Link href="/terms" className="transition hover:text-zinc-100">
            Terms
          </Link>
        </nav>
        <p className="max-w-md text-xs leading-relaxed text-zinc-500">
          ChitChat is anonymous by design. Be kind, never share personal information, and report
          anyone who makes you uncomfortable.
        </p>
      </div>
    </footer>
  );
}

/** Narrow centered page shell for the policy/safety pages. */
export function DocShell({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-zinc-800/80 px-6 py-4">
        <div className="mx-auto max-w-3xl">
          <Brand compact />
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm text-zinc-500">Last updated: {updated}</p>
        <div className="prose-doc mt-8 space-y-5 text-[15px] leading-relaxed text-zinc-300 [&_h2]:pt-4 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-zinc-100 [&_li]:ml-5 [&_li]:list-disc [&_strong]:text-zinc-100">
          {children}
        </div>
      </main>
      <Footer />
    </div>
  );
}

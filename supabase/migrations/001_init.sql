-- ChitChat Supabase schema
-- Run in the Supabase SQL editor (or via `supabase db push`).
-- Free tier: 500 MB database. These tables are tiny by design; chat messages
-- are NEVER stored here.

-- Anonymous sessions. One row per "Start Chatting" session. Expires logically
-- via status/last_seen; a scheduled cleanup deletes rows older than 30 days.
create table if not exists public.anonymous_sessions (
  id uuid primary key,
  anonymous_username text not null,
  status text not null default 'online'
    check (status in ('online', 'queued', 'chatting', 'offline')),
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now()
);
create index if not exists idx_anonymous_sessions_last_seen
  on public.anonymous_sessions (last_seen);

-- Chat rooms. Metadata only — no message content is ever persisted.
create table if not exists public.chat_rooms (
  id uuid primary key,
  user_a uuid not null references public.anonymous_sessions (id) on delete cascade,
  user_b uuid not null references public.anonymous_sessions (id) on delete cascade,
  status text not null default 'active'
    check (status in ('active', 'ended')),
  end_reason text,
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  check (user_a <> user_b)
);
create index if not exists idx_chat_rooms_created_at
  on public.chat_rooms (created_at);

-- User reports. Stores metadata only, never message text.
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.anonymous_sessions (id) on delete cascade,
  reported_user_id uuid not null references public.anonymous_sessions (id) on delete cascade,
  room_id uuid references public.chat_rooms (id) on delete set null,
  reason text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_reports_created_at
  on public.reports (created_at);
create index if not exists idx_reports_reported_user
  on public.reports (reported_user_id);

-- Blocks. Session-scoped; prevents the pair from being matched again while
-- either session is alive.
create table if not exists public.blocks (
  id uuid primary key default gen_random_uuid(),
  blocker_id uuid not null references public.anonymous_sessions (id) on delete cascade,
  blocked_id uuid not null references public.anonymous_sessions (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (blocker_id, blocked_id)
);

-- Retention: the backend runs this cleanup automatically on a daily timer
-- (see db.purgeOldData). The statements below are kept as a manual fallback.
-- delete from public.blocks where created_at < now() - interval '30 days';
-- delete from public.reports where created_at < now() - interval '30 days';
-- delete from public.chat_rooms where created_at < now() - interval '30 days';
-- delete from public.anonymous_sessions where last_seen < now() - interval '30 days';

-- Row Level Security: the server uses the service-role key and bypasses RLS.
-- No client ever talks to Supabase directly, so deny everything else.
alter table public.anonymous_sessions enable row level security;
alter table public.chat_rooms enable row level security;
alter table public.reports enable row level security;
alter table public.blocks enable row level security;

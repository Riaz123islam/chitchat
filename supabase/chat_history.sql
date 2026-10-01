-- ChitChat — chat_history table
-- Run this once in your Supabase dashboard: SQL Editor → New query → paste → Run.
--
-- RLS is deliberately disabled for this table because the chat server reads
-- and writes it with the service-role key (full access). All authorization
-- happens in the server (Supabase JWT verification), never from the browser.

create table if not exists public.chat_history (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users (id) on delete cascade,
  username    text        not null,          -- the owner's anonymous nickname in that chat
  room_id     text        not null,
  partner_username text   not null,
  messages    jsonb       not null default '[]'::jsonb,
  end_reason  text,
  ended_at    timestamptz not null default now()
);

create index if not exists chat_history_user_idx
  on public.chat_history (user_id, ended_at desc);

alter table public.chat_history disable row level security;

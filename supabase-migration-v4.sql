-- ═══════════════════════════════════════════════════════════
--  Easea v4 — "今日有前進" migration
--  Run this in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════

-- Add progress fields to existing tasks table
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS progress_today   boolean      NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_progress_at timestamptz  DEFAULT null;

-- (If you're creating the table fresh, use the full schema below)

-- ═══════════════════════════════════════════════════════════
--  Full schema (new project)
-- ═══════════════════════════════════════════════════════════
/*
create extension if not exists "pgcrypto";

create table public.tasks (
  id                uuid        primary key default gen_random_uuid(),
  user_id           uuid        not null references auth.users(id) on delete cascade,
  title             text        not null,
  due_date          date        not null,
  status            text        not null default 'active',
  intent_state      text        not null default 'LATER',
  intent_meta       jsonb,
  auto_shifted      boolean     default false,
  steps             jsonb       default '[]'::jsonb,
  progress_today    boolean     not null default false,
  last_progress_at  timestamptz default null,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

create index idx_tasks_user_id  on public.tasks(user_id);
create index idx_tasks_due_date on public.tasks(due_date);

alter table public.tasks enable row level security;

create policy "view own"   on public.tasks for select using (auth.uid() = user_id);
create policy "insert own" on public.tasks for insert with check (auth.uid() = user_id);
create policy "update own" on public.tasks for update using (auth.uid() = user_id);
create policy "delete own" on public.tasks for delete using (auth.uid() = user_id);
*/

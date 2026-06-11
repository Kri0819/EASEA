# Easea v11 — Supabase Google OAuth 設定步驟

## 一、Supabase 啟用 Google OAuth

### 1. 在 Google Cloud Console 建立 OAuth 憑證

1. 前往 https://console.cloud.google.com/
2. 建立新專案（或選現有）→ APIs & Services → Credentials
3. Create Credentials → OAuth 2.0 Client IDs
4. Application type: **Web application**
5. Authorised redirect URIs 加入：
   ```
   https://YOUR_PROJECT_ID.supabase.co/auth/v1/callback
   ```
6. 儲存後取得：
   - `Client ID`
   - `Client Secret`

---

### 2. 在 Supabase 啟用 Google Provider

1. Supabase Dashboard → Authentication → Providers → Google
2. 貼上 `Client ID` 和 `Client Secret`
3. 儲存

---

### 3. 設定 Redirect URL

Supabase Dashboard → Authentication → URL Configuration：

- **Site URL**: `https://your-vercel-domain.vercel.app`
- **Redirect URLs** 加入:
  ```
  https://your-vercel-domain.vercel.app
  https://your-vercel-domain.vercel.app/**
  http://localhost:5173
  http://localhost:5173/**
  ```

---

## 二、Supabase 資料庫 Schema

在 Supabase SQL Editor 執行：

```sql
create extension if not exists "pgcrypto";

create table if not exists public.tasks (
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

-- Indexes
create index if not exists idx_tasks_user_id  on public.tasks(user_id);
create index if not exists idx_tasks_due_date on public.tasks(due_date);

-- Row Level Security — 每個人只能看到自己的資料
alter table public.tasks enable row level security;

create policy "view own tasks"   on public.tasks for select using (auth.uid() = user_id);
create policy "insert own tasks" on public.tasks for insert with check (auth.uid() = user_id);
create policy "update own tasks" on public.tasks for update using (auth.uid() = user_id);
create policy "delete own tasks" on public.tasks for delete using (auth.uid() = user_id);
```

---

## 三、環境變數

`.env.local`：

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
VITE_SUPABASE_ANON=your-anon-public-key
```

---

## 四、跨裝置同步原理

```
手機 Google 登入
    ↓
Supabase 驗證 → 取得 user.id
    ↓
所有 tasks 以 user_id 儲存在 PostgreSQL
    ↓
電腦登入同一個 Google 帳號
    ↓
同樣的 user.id → 拿到同樣的 tasks
```

RLS（Row Level Security）確保每個帳號只能看到自己的資料，完全隔離。

---

## 五、部署到 Vercel

```bash
npm install
npm run build

# 或直接 push GitHub，Vercel 自動 build
```

Vercel 環境變數設定：
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON`

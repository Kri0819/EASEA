# Supabase Google OAuth 設定指南

## 一、Google Cloud Console

1. 前往 https://console.cloud.google.com
2. 建立新專案（或使用現有專案）
3. 左側選單 → **APIs & Services** → **Credentials**
4. 點 **+ CREATE CREDENTIALS** → **OAuth client ID**
5. Application type 選 **Web application**
6. 名稱填 `Easea`
7. **Authorized redirect URIs** 加入：
   ```
   https://YOUR_PROJECT_ID.supabase.co/auth/v1/callback
   ```
8. 建立後複製：
   - **Client ID**
   - **Client Secret**

---

## 二、Supabase Dashboard

1. 前往 https://supabase.com → 你的專案
2. **Authentication** → **Providers** → **Google**
3. 開啟 **Enable Google provider**
4. 貼上 Google 的 **Client ID** 和 **Client Secret**
5. **Authorized Callback URL** 會自動填好，確認格式：
   ```
   https://YOUR_PROJECT_ID.supabase.co/auth/v1/callback
   ```
6. 儲存

---

## 三、Supabase Site URL 設定

1. **Authentication** → **URL Configuration**
2. **Site URL** 填入：
   ```
   https://easea.vercel.app
   ```
3. **Redirect URLs** 加入：
   ```
   https://easea.vercel.app
   https://easea.vercel.app/
   ```
4. 儲存

---

## 四、Vercel 環境變數

在 Vercel Dashboard → 你的專案 → Settings → Environment Variables：

```
VITE_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
VITE_SUPABASE_ANON=your-anon-public-key
```

---

## 五、資料庫 Schema（如果還沒建立）

在 Supabase SQL Editor 執行：

```sql
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

alter table public.tasks enable row level security;

create policy "view own"   on public.tasks for select using (auth.uid() = user_id);
create policy "insert own" on public.tasks for insert with check (auth.uid() = user_id);
create policy "update own" on public.tasks for update using (auth.uid() = user_id);
create policy "delete own" on public.tasks for delete using (auth.uid() = user_id);
```

---

## 六、跨裝置同步原理

- 每個 Google 帳號對應一個 `user_id`
- 所有 tasks 都有 `user_id` 欄位
- Row Level Security 確保每人只能看到自己的資料
- 手機 / 電腦 / 平板 用同一個 Google 帳號登入 → 資料完全一致

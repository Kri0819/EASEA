# Easea — Ocean Flow OS

> 時間像水一樣流動。你只需要做現在這一件事。

---

## 一、本機開發

```bash
# 1. 安裝依賴
npm install

# 2. 複製環境變數範本
cp .env.example .env.local
# → 填入你的 Supabase URL 和 anon key（可先留空，會用 demo 模式）

# 3. 啟動開發伺服器
npm run dev
# → http://localhost:5173
```

---

## 二、環境變數

編輯 `.env.local`：

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
VITE_SUPABASE_ANON=your-anon-public-key
```

> 留空 = Demo 模式（本機 localStorage，不需要 Supabase）

---

## 三、Supabase 設定（要跨裝置同步才需要）

### 3-1 在 Supabase SQL Editor 執行：

```sql
create extension if not exists "pgcrypto";

create table public.tasks (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  title         text not null,
  due_date      date not null,
  status        text not null default 'active',
  intent_state  text not null default 'LATER',
  intent_meta   jsonb,
  auto_shifted  boolean default false,
  steps         jsonb default '[]'::jsonb,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

create index idx_tasks_user_id  on public.tasks(user_id);
create index idx_tasks_due_date on public.tasks(due_date);

alter table public.tasks enable row level security;

create policy "view own"   on public.tasks for select using (auth.uid() = user_id);
create policy "insert own" on public.tasks for insert with check (auth.uid() = user_id);
create policy "update own" on public.tasks for update using (auth.uid() = user_id);
create policy "delete own" on public.tasks for delete using (auth.uid() = user_id);
```

### 3-2 Auth 設定（Magic Link）
- Supabase Dashboard → Authentication → Providers → **Email** → 啟用
- 確認 **「Enable Email OTP / Magic Link」** 已開啟（預設開啟）
- Site URL 設為你的 Vercel 網址，例如 `https://easea.vercel.app`
- Redirect URLs 加入：`https://easea.vercel.app/**`

> 使用者輸入 email → 收到 magic link → 點擊即自動登入，不需要密碼。

---

## 四、生成 PWA 圖示

```bash
# 安裝 sharp（只需要一次）
npm install -D sharp

# 生成所有尺寸圖示
node generate-icons.mjs
```

這會在 `public/icons/` 產生所有需要的 PNG，以及 `public/apple-touch-icon.png`。

> 如果你有自己設計的 logo，把 SVG 替換到 `generate-icons.mjs` 裡的 `SVG` 變數即可。

---

## 五、Build

```bash
npm run build
# → 輸出到 dist/
```

---

## 六、部署到 Vercel（推薦）

### 方法 A — Vercel CLI

```bash
npm install -g vercel
vercel

# 設定環境變數
vercel env add VITE_SUPABASE_URL
vercel env add VITE_SUPABASE_ANON
vercel --prod
```

### 方法 B — GitHub + Vercel Dashboard（最簡單）

1. 把這個資料夾 push 到 GitHub
2. 前往 https://vercel.com → Import Project → 選你的 repo
3. Framework: **Vite**
4. Build Command: `npm run build`
5. Output Directory: `dist`
6. Environment Variables: 加入 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_ANON`
7. Deploy ✅

---

## 七、安裝成 PWA

### iPhone / iPad（Safari）
1. 用 Safari 開啟網站
2. 點分享按鈕 →「加入主畫面」
3. 命名 Easea → 加入

### Android（Chrome）
1. 用 Chrome 開啟網站
2. 右上角選單 →「安裝應用程式」或「加到主畫面」
3. 安裝 ✅

### 桌面（Chrome / Edge）
1. 網址列右側會出現安裝圖示
2. 點擊 → 安裝

---

## 八、專案結構

```
easea-pwa/
├── src/
│   ├── main.jsx          ← React 入口
│   └── App.jsx           ← 完整 Easea app（單檔）
├── public/
│   ├── icons/            ← PWA 圖示（node generate-icons.mjs 產生）
│   ├── apple-touch-icon.png
│   └── favicon.ico
├── index.html            ← HTML 入口 + iOS meta tags
├── vite.config.js        ← Vite + PWA plugin 設定
├── vercel.json           ← Vercel SPA routing
├── generate-icons.mjs    ← 圖示生成腳本
├── .env.example          ← 環境變數範本
├── .gitignore
└── package.json
```

---

## 九、技術棧

| 項目 | 技術 |
|------|------|
| 前端 | React 18 + Vite 5 |
| PWA | vite-plugin-pwa + Workbox |
| Auth | Supabase Auth（GoTrue HTTP API） |
| 資料庫 | Supabase PostgreSQL + REST API |
| 部署 | Vercel |
| 離線 | Service Worker + localStorage cache |

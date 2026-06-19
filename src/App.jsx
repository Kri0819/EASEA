// ╔══════════════════════════════════════════════════════════════╗
// ║  EASEA  —  Ocean Flow OS                                     ║
// ║  § 1–6   unchanged: config / utils / auth / data / theme / auth-ctx
// ║  § 7–15  full Ocean Flow UI rewrite                         ║
// ╚══════════════════════════════════════════════════════════════╝
import './styles/tokens.css';
import './styles/animations.css';
import './styles/layout.css';
import './styles/task.css';
import './styles/login.css';
import './styles/sheet.css';
import './styles/ocean.css';

import { useTasks }         from './hooks/useTasks.js';
import { useIntentFlow }    from './hooks/useIntentFlow.js';
import { useTaskAnimation } from './hooks/useTaskAnimation.js';
import EaseaLogo            from './EaseaLogo.jsx';

import {
  useState, useEffect, useCallback,
  useContext, createContext, useRef, useMemo,
} from "react";

// ─────────────────────────────────────────────────────────────────
//  § 1  CONFIG
// ─────────────────────────────────────────────────────────────────
const SB_URL  = import.meta.env.VITE_SUPABASE_URL  || "";
const SB_ANON = import.meta.env.VITE_SUPABASE_ANON || "";
const IS_MOCK = !SB_URL || !SB_ANON;

// ─── Brand
const BRAND_TAGLINE = "Let tasks find their natural distance.";

// ─────────────────────────────────────────────────────────────────
//  § 2  Utils
// ─────────────────────────────────────────────────────────────────
const todayStr = () => new Date().toISOString().slice(0, 10);
const addDays  = (d, n) => { const dt = new Date(d); dt.setDate(dt.getDate() + n); return dt.toISOString().slice(0, 10); };
const uid      = () => crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
const sleep    = ms => new Promise(r => setTimeout(r, ms));

function rollover(tasks) {
  const t = todayStr();
  return (tasks || []).map(task => {
    if (task.status === "done") return task;
    if (task.due_date < t) return { ...task, due_date: t, auto_shifted: true };
    return task;
  });
}

// ─────────────────────────────────────────────────────────────────
//  Intent State Machine
// ─────────────────────────────────────────────────────────────────
const IntentMachine = {
  SHELF: { promote: "LATER" },
  LATER: { promote: "SOON",  demote: "SHELF" },
  SOON:  { promote: "NOW",   demote: "LATER" },
  NOW:   {                   demote: "SOON"  },
};

const IntentUI = {
  NOW:   { label: "此刻", hint: "此刻處理",   cls: "intent-now"   },
  SOON:  { label: "稍後", hint: "稍後再碰",   cls: "intent-soon"  },
  LATER: { label: "晚點", hint: "今天不用急", cls: "intent-later" },
  SHELF: { label: "留著", hint: "先留在那裡", cls: "intent-shelf" },
};

const intentWeight = { NOW: 100, SOON: 70, LATER: 40, SHELF: 10 };

const flowScore = t => {
  const base    = intentWeight[t.intent_state ?? "LATER"];
  const overdue = t.due_date < todayStr() ? 20 : 0;
  const touched = t.intent_meta?.last_touch ? 5 : 0;
  return base + overdue + touched;
};

const mkIntent = (state = "LATER") => ({
  intent_state: state,
  intent_meta:  { last_touch: null, reason: null },
});

function makeSeed() {
  return rollover([
    { id: uid(), title: "打電話給牙醫",    steps: [], due_date: todayStr(),             status: "active", auto_shifted: false, ...mkIntent("NOW"),   progress_today: false, last_progress_at: null },
    { id: uid(), title: "整理產品需求文件", steps: [{ id: uid(), title: "讀完文件", is_completed: true }, { id: uid(), title: "寫回饋意見", is_completed: false }], due_date: todayStr(), status: "active", auto_shifted: false, ...mkIntent("SOON"),  progress_today: true,  last_progress_at: Date.now() - 1000 * 60 * 30 },
    { id: uid(), title: "回覆信件",        steps: [], due_date: addDays(todayStr(), -1), status: "active", auto_shifted: false, ...mkIntent("SOON"),  progress_today: false, last_progress_at: null },
    { id: uid(), title: "買菜",            steps: [{ id: uid(), title: "牛奶和雞蛋", is_completed: false }, { id: uid(), title: "蔬菜水果", is_completed: false }], due_date: todayStr(), status: "active", auto_shifted: false, ...mkIntent("LATER"), progress_today: false, last_progress_at: null },
    { id: uid(), title: "完成簡報",        steps: [], due_date: todayStr(),             status: "active", auto_shifted: false, ...mkIntent("SHELF"), progress_today: false, last_progress_at: null },
  ]);
}

// ─────────────────────────────────────────────────────────────────
//  § 3  Auth adapter — Google OAuth via Supabase
// ─────────────────────────────────────────────────────────────────
const SESSION_KEY = "easea_session_v3";

// ── Mock: demo mode, skip OAuth ──
const mockAuth = {
  async signInWithGoogle() {
    await sleep(500);
    const session = {
      user: { id: "demo-user-001", email: "demo@easea.app", name: "Demo User" },
      access_token: uid(),
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    return session;
  },
  async signOut() { localStorage.removeItem(SESSION_KEY); },
  async getSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch { return null; }
  },
  onAuthStateChange(cb) {
    const read = () => { try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch { return null; } };
    cb(read());
    const id = setInterval(() => cb(read()), 3000);
    return () => clearInterval(id);
  },
};

// ── Real Supabase Google OAuth ──
const sbAuth = {
  // Redirect to Google OAuth — Supabase handles the entire flow
  async signInWithGoogle() {
    const redirectTo = window.location.origin;
    window.location.href =
      `${SB_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirectTo)}`;
  },
  async signOut() {
    const s = await this.getSession();
    if (s) {
      await fetch(`${SB_URL}/auth/v1/logout`, {
        method: "POST",
        headers: { apikey: SB_ANON, Authorization: `Bearer ${s.access_token}` },
      }).catch(() => {});
    }
    localStorage.removeItem(SESSION_KEY);
  },
  async getSession() {
    // After OAuth redirect, Supabase puts tokens in URL hash or query
    if (typeof window !== "undefined") {
      const hash   = window.location.hash;
      const search = window.location.search;
      const raw    = hash.startsWith("#") ? hash.slice(1) : search.startsWith("?") ? search.slice(1) : "";
      if (raw) {
        const params       = new URLSearchParams(raw);
        const accessToken  = params.get("access_token");
        const refreshToken = params.get("refresh_token");
        if (accessToken) {
          // Fetch user profile from Supabase
          const res = await fetch(`${SB_URL}/auth/v1/user`, {
            headers: { apikey: SB_ANON, Authorization: `Bearer ${accessToken}` },
          });
          if (res.ok) {
            const user    = await res.json();
            const session = {
              user: {
                id:     user.id,
                email:  user.email,
                name:   user.user_metadata?.full_name || user.email,
                avatar: user.user_metadata?.avatar_url || null,
              },
              access_token:  accessToken,
              refresh_token: refreshToken,
            };
            localStorage.setItem(SESSION_KEY, JSON.stringify(session));
            // Clean URL
            window.history.replaceState(null, "", window.location.pathname);
            return session;
          }
        }
      }
    }
    // Try stored session, refresh if possible
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    try {
      const s = JSON.parse(raw);
      if (s.refresh_token) {
        const res = await fetch(`${SB_URL}/auth/v1/token?grant_type=refresh_token`, {
          method: "POST",
          headers: { "Content-Type": "application/json", apikey: SB_ANON },
          body: JSON.stringify({ refresh_token: s.refresh_token }),
        });
        if (res.ok) {
          const data  = await res.json();
          const fresh = {
            user: {
              id:     data.user.id,
              email:  data.user.email,
              name:   data.user.user_metadata?.full_name || data.user.email,
              avatar: data.user.user_metadata?.avatar_url || null,
            },
            access_token:  data.access_token,
            refresh_token: data.refresh_token,
          };
          localStorage.setItem(SESSION_KEY, JSON.stringify(fresh));
          return fresh;
        }
      }
      return s;
    } catch { return null; }
  },
  onAuthStateChange(cb) {
    this.getSession().then(s => cb(s)).catch(() => cb(null));
    const id = setInterval(() => {
      try { cb(JSON.parse(localStorage.getItem(SESSION_KEY) || "null")); } catch { cb(null); }
    }, 5000);
    return () => clearInterval(id);
  },
};

const authAdapter = IS_MOCK ? mockAuth : sbAuth;

// ─────────────────────────────────────────────────────────────────
//  § 4  Tasks data adapter
// ─────────────────────────────────────────────────────────────────
const cacheKey  = userId => `easea_tasks_v3_${userId}`;
const sbHeaders = (token, extra={}) => ({ apikey:SB_ANON, Authorization:`Bearer ${token||SB_ANON}`, "Content-Type":"application/json", ...extra });
const fromDB = r => ({ id:r.id, title:r.title, due_date:r.due_date, status:r.status, intent_state:r.intent_state??"LATER", intent_meta:r.intent_meta??{last_touch:null,reason:null}, auto_shifted:r.auto_shifted, steps:r.steps||[], progress_today:r.progress_today??false, last_progress_at:r.last_progress_at??null });
const toDB   = (t,uid) => ({ id:t.id, user_id:uid, title:t.title, due_date:t.due_date, status:t.status, intent_state:t.intent_state??"LATER", intent_meta:t.intent_meta??null, auto_shifted:t.auto_shifted, steps:t.steps, progress_today:t.progress_today??false, last_progress_at:t.last_progress_at??null, updated_at:new Date().toISOString() });

const tasksDB = {
  getLocal(userId)       { try { const r=localStorage.getItem(cacheKey(userId)); return r?rollover(JSON.parse(r)):null; } catch { return null; } },
  setLocal(userId, data) { try { localStorage.setItem(cacheKey(userId),JSON.stringify(data)); } catch {} },
  async fetchAll(userId,token) {
    const res = await fetch(`${SB_URL}/rest/v1/tasks?user_id=eq.${userId}&order=created_at.asc&select=*`,{headers:sbHeaders(token)});
    if (!res.ok) throw new Error("fetch failed");
    return (await res.json()).map(fromDB);
  },
  async upsert(task,userId,token) {
    const res = await fetch(`${SB_URL}/rest/v1/tasks`,{method:"POST",headers:sbHeaders(token,{Prefer:"resolution=merge-duplicates,return=minimal"}),body:JSON.stringify(toDB(task,userId))});
    if (!res.ok) throw new Error("upsert failed");
  },
  async remove(taskId,token) {
    const res = await fetch(`${SB_URL}/rest/v1/tasks?id=eq.${taskId}`,{method:"DELETE",headers:sbHeaders(token)});
    if (!res.ok) throw new Error("delete failed");
  },
};

// ─────────────────────────────────────────────────────────────────
//  § 5  ThemeContext
// ─────────────────────────────────────────────────────────────────
const ThemeCtx = createContext({ theme:"light", resolved:"light", setTheme:()=>{} });

function ThemeProvider({ children }) {
  const [theme, _set] = useState(()=>{
    const saved = localStorage.getItem("easea_theme");
    // only accept light or dark; default to light
    return saved === "dark" ? "dark" : "light";
  });

  const resolved = theme; // no system mode
  const setTheme = useCallback(t => {
    const v = t === "dark" ? "dark" : "light";
    _set(v);
    localStorage.setItem("easea_theme", v);
  }, []);

  useEffect(()=>{
    document.documentElement.setAttribute("data-theme", resolved);
    document.body.setAttribute("data-theme", resolved);
  }, [resolved]);

  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-theme", resolved);
    document.body.setAttribute("data-theme", resolved);
  }

  return <ThemeCtx.Provider value={{theme, resolved, setTheme}}>{children}</ThemeCtx.Provider>;
}

// ─────────────────────────────────────────────────────────────────
//  § 6  AuthContext
// ─────────────────────────────────────────────────────────────────
const AuthCtx = createContext({ session:null, loading:true, signInWithGoogle:async()=>{}, signOut:async()=>{} });

function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(()=>{
    authAdapter.getSession().then(s=>{setSession(s);setLoading(false);}).catch(()=>setLoading(false));
    const unsub=authAdapter.onAuthStateChange(s=>setSession(s));
    return unsub;
  },[]);
  const signInWithGoogle = useCallback(async()=>{
    await authAdapter.signInWithGoogle();
    // In mock mode, read the session that was just set
    if (IS_MOCK) {
      const s = await authAdapter.getSession();
      setSession(s);
    }
    // In real mode, page redirects to Google — nothing more to do here
  },[]);
  const signOut = useCallback(async()=>{await authAdapter.signOut();setSession(null);},[]);
  return <AuthCtx.Provider value={{session,loading,signInWithGoogle,signOut}}>{children}</AuthCtx.Provider>;
}

// ─────────────────────────────────────────────────────────────────
//  § 7  LoginPage — Google OAuth
// ─────────────────────────────────────────────────────────────────
function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg" style={{flexShrink:0}}>
      <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908C16.658 14.013 17.64 11.705 17.64 9.2z" fill="#4285F4"/>
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z" fill="#34A853"/>
      <path d="M3.964 10.71c-.18-.54-.282-1.117-.282-1.71s.102-1.17.282-1.71V4.958H.957C.347 6.173 0 7.548 0 9s.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
    </svg>
  );
}

function LoginPage() {
  const { signInWithGoogle } = useContext(AuthCtx);
  const [busy, setBusy]      = useState(false);
  const [err,  setErr]       = useState("");

  const handleGoogle = async () => {
    setErr(""); setBusy(true);
    try { await signInWithGoogle(); }
    catch(e) { setErr(e.message || "登入失敗，請再試"); setBusy(false); }
  };

  return (
    <div className="login-ocean">
      <div className="l-orb l-orb1"/><div className="l-orb l-orb2"/><div className="l-orb l-orb3"/>
      <div className="login-glass">

        {/* ── Brand area ── */}
        <div className="login-brand-area">
          <EaseaLogo size={68} showText={false} />
          <p className="login-wordmark">E A S E A</p>
          <p className="login-tagline">{BRAND_TAGLINE}</p>
        </div>

        {err && <div className="lmsg err">{err}</div>}

        <button className="google-btn" onClick={handleGoogle} disabled={busy}>
          {busy
            ? <span className="google-btn-inner"><span className="tide-spin-sm"/><span>連線中…</span></span>
            : <span className="google-btn-inner"><GoogleIcon/><span>使用 Google 登入</span></span>
          }
        </button>

        {IS_MOCK && <p className="ldemo">Demo 模式 · 點擊直接進入</p>}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
//  § 8  OceanOrb — a task as a floating light orb
// ─────────────────────────────────────────────────────────────────

// Orb sizes vary slightly by intent — NOW is largest
const ORB_SIZE = { NOW: 72, SOON: 62, LATER: 54, SHELF: 46 };

// Orb color palette — layered ellipses, same visual language as EaseaLogo
const ORB_PALETTE = [
  { outer:'#C8D8F8', mid:'#B8B0E8', inner:'#F4D8C8' }, // blue-purple-peach (default)
  { outer:'#C0DDF0', mid:'#A8C8E0', inner:'#E8D4C0' }, // sea-blue-sand
  { outer:'#D0C8F0', mid:'#B8A8E0', inner:'#F0D8D8' }, // lavender-blush
  { outer:'#B8D8E8', mid:'#A0C0D8', inner:'#E0D0B8' }, // aqua-warm
];

function OrbSVG({ size, palette, isDone }) {
  const id = `orb-${size}-${palette.outer.slice(1,4)}`;
  const op = isDone ? 0.35 : 1;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none"
      style={{ filter: isDone ? 'grayscale(.5)' : 'none', opacity: op }}>
      <defs>
        <radialGradient id={`${id}-o`} cx="48%" cy="44%" r="52%">
          <stop offset="0%"  stopColor={palette.outer} stopOpacity=".62"/>
          <stop offset="100%" stopColor={palette.outer} stopOpacity=".06"/>
        </radialGradient>
        <radialGradient id={`${id}-m`} cx="46%" cy="54%" r="52%">
          <stop offset="0%"  stopColor={palette.mid} stopOpacity=".74"/>
          <stop offset="100%" stopColor={palette.mid} stopOpacity=".08"/>
        </radialGradient>
        <radialGradient id={`${id}-i`} cx="58%" cy="43%" r="52%">
          <stop offset="0%"  stopColor={palette.inner} stopOpacity=".80"/>
          <stop offset="100%" stopColor={palette.inner} stopOpacity=".00"/>
        </radialGradient>
        <radialGradient id={`${id}-c`} cx="38%" cy="34%" r="40%">
          <stop offset="0%"  stopColor="#FFFFFF" stopOpacity=".82"/>
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity=".00"/>
        </radialGradient>
        <filter id={`${id}-s`} x="-15%" y="-15%" width="130%" height="130%">
          <feGaussianBlur stdDeviation="2.2"/>
        </filter>
        <filter id={`${id}-d`} x="-150%" y="-150%" width="400%" height="400%">
          <feGaussianBlur stdDeviation="0.6"/>
        </filter>
      </defs>
      {/* 3 offset ellipses */}
      <ellipse cx="50" cy="48" rx="45" ry="42" fill={`url(#${id}-o)`} transform="rotate(-6 50 48)"/>
      <ellipse cx="46" cy="54" rx="34" ry="38" fill={`url(#${id}-m)`} transform="rotate(8 46 54)"/>
      <ellipse cx="56" cy="43" rx="30" ry="26" fill={`url(#${id}-i)`} transform="rotate(-10 56 43)"/>
      <ellipse cx="48" cy="46" rx="22" ry="20" fill={`url(#${id}-c)`} transform="rotate(5 48 46)"/>
      {/* 3 light dots */}
      <circle cx="36" cy="46" r="2.2" fill="white" opacity=".88" filter={`url(#${id}-d)`}/>
      <circle cx="52" cy="60" r="1.4" fill="white" opacity=".68" filter={`url(#${id}-d)`}/>
      <circle cx="63" cy="42" r="0.9" fill="white" opacity=".52" filter={`url(#${id}-d)`}/>
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────
//  § 9  KelpChain — steps growing down from an orb
// ─────────────────────────────────────────────────────────────────
function KelpChain({ task, onToggleStep, onAddStep, onMarkProgress }) {
  const [adding,  setAdding]  = useState(false);
  const [stepIn,  setStepIn]  = useState("");
  const steps     = task.steps || [];
  const hasProgress = task.progress_today === true;

  const doAdd = () => {
    if (!stepIn.trim()) return;
    onAddStep(task.id, stepIn.trim());
    setStepIn(""); setAdding(false);
  };

  return (
    <div className="kelp-chain">
      {steps.map((s, i) => (
        <div key={s.id} style={{ display:'flex', flexDirection:'column', alignItems:'center',
          animationDelay: `${i * 55}ms` }}>
          <div className="kelp-line" style={{ height: i === 0 ? 24 : 28 }} />
          <div className="kelp-node appearing" style={{ animationDelay:`${i * 55}ms` }}>
            <button
              className={`kelp-check${s.is_completed ? ' done' : ''}`}
              onClick={e => { e.stopPropagation(); onToggleStep(task.id, s.id); }}
            >
              {s.is_completed && <TinyCheck size={7}/>}
            </button>
            <span className={`kelp-label${s.is_completed ? ' done' : ''}`}>{s.title}</span>
          </div>
        </div>
      ))}

      {/* Add step */}
      <div className="kelp-add-row" style={{ flexDirection:'column', alignItems:'center' }}>
        <div className="kelp-add-line" style={{ height: steps.length > 0 ? 20 : 16 }} />
        {!adding ? (
          <button className="kelp-add-btn" onClick={e => { e.stopPropagation(); setAdding(true); }}>
            + 步驟
          </button>
        ) : (
          <div className="kelp-input-row" onClick={e => e.stopPropagation()}>
            <input className="kelp-input" autoFocus placeholder="步驟名稱…"
              value={stepIn} onChange={e => setStepIn(e.target.value)}
              onKeyDown={e => { if(e.key==='Enter') doAdd(); if(e.key==='Escape') setAdding(false); }}/>
            <button className="kelp-confirm" onClick={doAdd}>加</button>
          </div>
        )}
      </div>

      {/* Progress touch */}
      {!hasProgress && (
        <button className="sea-progress-touch"
          onClick={e => { e.stopPropagation(); onMarkProgress(task.id); }}>
          今天有碰過
        </button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
//  § 10  SeaSurface — the ocean with floating orbs
// ─────────────────────────────────────────────────────────────────

// Stable positions with repulsion — orbs won't crowd each other
function stablePos(id, canvasW = 1400, canvasH = 1000) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(31, h) + id.charCodeAt(i)) | 0;
  const cx = canvasW / 2;
  const cy = canvasH / 2;
  // Spread across 80% of canvas
  const x = cx - 380 + Math.abs(h % 760);
  const y = cy - 280 + Math.abs(((h >> 8) & 0xFFFF) % 560);
  return { x, y };
}

// Build positions with repulsion pass — push apart any orbs that are too close
function buildPositions(tasks) {
  const MIN_DIST = 190; // px — accounts for orb + label text width
  const positions = {};
  tasks.forEach(t => { positions[t.id] = stablePos(t.id); });

  // 5 relaxation passes for better separation
  for (let pass = 0; pass < 5; pass++) {
    const ids = Object.keys(positions);
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = positions[ids[i]];
        const b = positions[ids[j]];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < MIN_DIST && dist > 0) {
          const push = (MIN_DIST - dist) / 2;
          const nx = dx / dist;
          const ny = dy / dist;
          positions[ids[i]] = { x: a.x - nx * push, y: a.y - ny * push };
          positions[ids[j]] = { x: b.x + nx * push, y: b.y + ny * push };
        }
      }
    }
  }
  return positions;
}

// Pan clamping
const clampPan = (v, viewport, surface) => {
  if (surface <= viewport) return 0;
  const min = -(surface - viewport);
  return Math.max(min, Math.min(0, v));
};

const CANVAS_W = 1400;
const CANVAS_H = 1000;

function SeaSurface({ tasks, onToggleDone, onToggleStep, onShiftIntent, onMarkProgress, onAddStep, onDelete }) {
  const today   = todayStr();
  const stream  = useMemo(() =>
    tasks.filter(tk => tk.status !== 'done' && (tk.due_date === today || tk.auto_shifted))
         .sort((a,b) => flowScore(b) - flowScore(a)),
    [tasks, today]
  );
  const doneTasks = useMemo(() =>
    tasks.filter(tk => tk.status === 'done' && tk.due_date === today),
    [tasks, today]
  );

  // Build all positions once — repulsion applied across active + done tasks
  const positions = useMemo(
    () => buildPositions([...stream, ...doneTasks]),
    [stream, doneTasks]
  );

  const canvasRef = useRef(null);
  const dragRef   = useRef({ startX:0, startY:0, panX:0, panY:0, moved:false });

  // Start pan so canvas center aligns with viewport center
  const getInitialPan = () => {
    const vw = window.innerWidth  || 430;
    const vh = window.innerHeight || 700;
    return {
      x: clampPan(-(CANVAS_W / 2 - vw / 2),  vw, CANVAS_W),
      y: clampPan(-(CANVAS_H / 2 - vh / 2.5), vh, CANVAS_H),
    };
  };

  const [focused,  setFocused]  = useState(null);
  const [pan,      setPan]      = useState(getInitialPan);
  const [dragging, setDragging] = useState(false);

  // On focus: animate pan to center the tapped orb
  const focusTask = useCallback((task) => {
    if (dragRef.current.moved) return;
    setFocused(task.id);
    const pos = positions[task.id] || stablePos(task.id);
    const vw  = canvasRef.current?.clientWidth  || window.innerWidth  || 430;
    const vh  = canvasRef.current?.clientHeight || window.innerHeight || 700;
    setPan({
      x: clampPan(-(pos.x - vw / 2),   vw, CANVAS_W),
      y: clampPan(-(pos.y - vh / 2.8),  vh, CANVAS_H),
    });
  }, [positions]);

  const unfocus = useCallback(() => {
    setFocused(null);
    setPan(getInitialPan());
  }, []);

  // Pointer events for pan
  const onPointerDown = useCallback(e => {
    if (focused) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, panX: pan.x, panY: pan.y, moved: false };
    setDragging(true);
  }, [pan, focused]);

  const onPointerMove = useCallback(e => {
    if (!dragging) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    if (Math.abs(dx) + Math.abs(dy) > 5) dragRef.current.moved = true;
    const vw = canvasRef.current?.clientWidth  || window.innerWidth  || 430;
    const vh = canvasRef.current?.clientHeight || window.innerHeight || 700;
    setPan({
      x: clampPan(dragRef.current.panX + dx, vw, CANVAS_W),
      y: clampPan(dragRef.current.panY + dy, vh, CANVAS_H),
    });
  }, [dragging]);

  const onPointerUp = useCallback(() => {
    setDragging(false);
    setTimeout(() => { dragRef.current.moved = false; }, 50);
  }, []);

  const hr    = new Date().getHours();
  const greet = hr < 5 ? '深夜了。' : hr < 12 ? '早安。' : hr < 18 ? '午安。' : '晚安。';

  const IntentMachineRef = IntentMachine; // closure

  return (
    <div className="ocean-view" style={{ padding: 0, position:'relative' }}>

      {/* Back hint when focused */}
      {focused && (
        <button className="sea-back" onClick={unfocus}>← 返回海面</button>
      )}

      {/* Greeting */}
      {!focused && (
        <div className="sea-greeting">
          <p className="sea-greeting-text">{greet} {stream.length > 0 ? `${stream.length} 件漂著。` : '今天空空的。'}</p>
        </div>
      )}

      {/* Canvas */}
      <div
        ref={canvasRef}
        className="sea-canvas"
        onMouseDown={onPointerDown}
        onMouseMove={onPointerMove}
        onMouseUp={onPointerUp}
        onMouseLeave={onPointerUp}
        onTouchStart={e => onPointerDown(e.touches[0])}
        onTouchMove={e => onPointerMove(e.touches[0])}
        onTouchEnd={onPointerUp}
      >
        <div
          className={`sea-surface${focused ? ' animating' : ''}`}
          style={{ transform: `translate(${pan.x}px, ${pan.y}px)` }}
        >
          {stream.map((task, idx) => {
            const pos     = positions[task.id] || stablePos(task.id);
            const intent  = task.intent_state || 'LATER';
            const isFoc   = focused === task.id;
            const isDim   = focused && focused !== task.id;
            const palette = ORB_PALETTE[idx % ORB_PALETTE.length];
            const size    = ORB_SIZE[intent] || 56;
            const bobDur  = 4.5 + (idx * 0.7) % 2.5;
            const bobDel  = (idx * 0.9) % 3;

            return (
              <div
                key={task.id}
                className={`sea-orb-wrap${isFoc ? ' focused' : ''}${isDim ? ' dimmed' : ''}`}
                style={{
                  left: pos.x - size / 2,
                  top:  pos.y - size / 2,
                  '--bob-dur':   `${bobDur}s`,
                  '--bob-delay': `${bobDel}s`,
                }}
                onClick={() => !dragRef.current.moved && (isFoc ? unfocus() : focusTask(task))}
              >
                <div className="sea-orb">
                  <OrbSVG size={isFoc ? size * 1.15 : size} palette={palette} isDone={false}/>
                  {/* Intent dot */}
                  <span className={`sea-intent-dot sid-${intent.toLowerCase()}`}/>
                </div>

                <span className="sea-orb-label">{task.title}</span>

                {/* Kelp chain — only when focused */}
                {isFoc && (
                  <KelpChain
                    task={task}
                    onToggleStep={onToggleStep}
                    onAddStep={onAddStep}
                    onMarkProgress={onMarkProgress}
                  />
                )}
              </div>
            );
          })}

          {/* Done orbs — very faint, fixed positions */}
          {doneTasks.map((task, idx) => {
            const pos  = positions[task.id] || stablePos(task.id);
            const size = 38;
            return (
              <div key={task.id} className="sea-orb-wrap done-orb"
                style={{ left: pos.x - size / 2, top: pos.y - size / 2 }}>
                <OrbSVG size={size} palette={ORB_PALETTE[idx % ORB_PALETTE.length]} isDone={true}/>
                <span className="sea-orb-label" style={{ fontSize:11, opacity:.4 }}>{task.title}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Action bar — shown when focused */}
      {focused && (() => {
        const task   = tasks.find(t => t.id === focused);
        if (!task) return null;
        const intent = task.intent_state || 'LATER';
        const canP   = !!IntentMachineRef[intent]?.promote;
        const canD   = !!IntentMachineRef[intent]?.demote;
        return (
          <div className="sea-action-bar">
            <button className="sea-act-btn" onClick={() => { onToggleDone(task.id); unfocus(); }}>
              ✓ 完成
            </button>
            {canP && (
              <button className="sea-act-btn promote"
                onClick={() => onShiftIntent(task.id, 'promote')}>
                ↑ {IntentUI[IntentMachineRef[intent].promote].label}
              </button>
            )}
            {canD && (
              <button className="sea-act-btn"
                onClick={() => onShiftIntent(task.id, 'demote')}>
                ↓ {IntentUI[IntentMachineRef[intent].demote].label}
              </button>
            )}
            <button className="sea-act-btn danger"
              onClick={() => { onDelete(task.id); unfocus(); }}>
              移除
            </button>
          </div>
        );
      })()}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
//  § 11  TodayFlow — wraps SeaSurface
// ─────────────────────────────────────────────────────────────────
function TodayFlow({ tasks, onToggleDone, onToggleStep, onShiftIntent, onMarkProgress, onAddStep, onDelete }) {
  return (
    <SeaSurface
      tasks={tasks}
      onToggleDone={onToggleDone}
      onToggleStep={onToggleStep}
      onShiftIntent={onShiftIntent}
      onMarkProgress={onMarkProgress}
      onAddStep={onAddStep}
      onDelete={onDelete}
    />
  );
}



// ─────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────
//  § 12  AppShell — uses useTasks
// ─────────────────────────────────────────────────────────────────
function AppShell() {
  const { session }             = useContext(AuthCtx);
  const userId                  = session?.user?.id;
  const token                   = session?.access_token;
  const [menuOpen, setMenuOpen] = useState(false);
  const [showAdd,  setShowAdd]  = useState(false);

  const { tasks, synced, handlers, onAdd } = useTasks({
    userId,
    token,
    tasksDB,
    makeSeed,
    rollover,
    uid,
    isMock: IS_MOCK,
    IntentMachine,
  });

  return (
    <div className="app-shell">
      <div className="bg-orb o1"/><div className="bg-orb o2"/><div className="bg-orb o3"/>

      <header className="topbar">
        <div className="tb-brand-wrap">
          <EaseaLogo size={22} showText={false} />
          <span className="tb-wordmark">E A S E A</span>
        </div>
        <div className="tb-right">
          {!IS_MOCK && <div className={`sync-bead${synced ? " on" : ""}`}/>}
          <div style={{ position: "relative" }}>
            <button className="tb-avatar" onClick={() => setMenuOpen(o => !o)}>
              {(session?.user?.email || "U")[0].toUpperCase()}
            </button>
            {menuOpen && <UserMenu onClose={() => setMenuOpen(false)}/>}
          </div>
        </div>
      </header>

      <TodayFlow tasks={tasks} {...handlers}/>

      <button className="buoy" onClick={() => setShowAdd(true)} aria-label="加一件事">
        <PlusIco/>
      </button>

      {showAdd && <AddSheet onClose={() => setShowAdd(false)} onAdd={onAdd}/>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
//  § 13  Router + Root
// ─────────────────────────────────────────────────────────────────
function AppRouter() {
  const { session, loading } = useContext(AuthCtx);
  if (loading) return (
    <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"var(--bg)"}}>
      <div className="tide-spin"/>
    </div>
  );
  return session ? <AppShell/> : <LoginPage/>;
}

export default function Easea() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AppRouter/>
      </AuthProvider>
    </ThemeProvider>
  );
}

// ─────────────────────────────────────────────────────────────────
//  § 14  Icons
// ─────────────────────────────────────────────────────────────────
const TinyCheck = ({size=9}) => (
  <svg width={size} height={size} viewBox="0 0 10 10" fill="none">
    <path d="M2 5l2.5 2.5L8 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);
const PlusIco = () => (
  <svg width={16} height={16} viewBox="0 0 16 16" fill="none">
    <path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
  </svg>
);


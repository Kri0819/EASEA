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

import { useTasks }         from './hooks/useTasks.js';
import { useIntentFlow }    from './hooks/useIntentFlow.js';
import { useTaskAnimation } from './hooks/useTaskAnimation.js';

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
//  § 3  Auth adapter — Magic Link (OTP)
// ─────────────────────────────────────────────────────────────────
const SESSION_KEY = "easea_session_v3";

// ── Mock: simulate magic link in demo mode ──
// In mock mode we skip the actual email and just set the session directly
const mockAuth = {
  async sendOtp(email) {
    await sleep(600);
    // Auto-create user and session (demo shortcut — real Supabase sends email)
    const k = email.toLowerCase().trim();
    const id = (() => {
      try {
        const stored = JSON.parse(localStorage.getItem("easea_mock_users") || "{}");
        if (stored[k]) return stored[k];
        const newId = uid();
        stored[k] = newId;
        localStorage.setItem("easea_mock_users", JSON.stringify(stored));
        return newId;
      } catch { return uid(); }
    })();
    // Demo: immediately create session (real flow requires clicking email link)
    const session = { user: { id, email: k }, access_token: uid() };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    return { demoAutoLogin: true, session };
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

// ── Real Supabase Magic Link (GoTrue HTTP API) ──
const sbAuth = {
  // Send OTP / magic link email
  async sendOtp(email) {
    const res = await fetch(`${SB_URL}/auth/v1/otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SB_ANON },
      body: JSON.stringify({
        email: email.toLowerCase().trim(),
        create_user: true,       // auto-register on first use
        // type: "magiclink"     // default — sends a clickable link
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error_description || data.msg || "發送失敗，請稍後再試");
    }
    return { demoAutoLogin: false };
  },
  async signOut() {
    const s = await this.getSession();
    if (s) await fetch(`${SB_URL}/auth/v1/logout`, {
      method: "POST",
      headers: { apikey: SB_ANON, Authorization: `Bearer ${s.access_token}` },
    }).catch(() => {});
    localStorage.removeItem(SESSION_KEY);
  },
  async getSession() {
    // On initial load, check URL for access_token (magic link callback)
    if (typeof window !== "undefined") {
      const hash   = window.location.hash;
      const search = window.location.search;
      const params = new URLSearchParams(
        hash.startsWith("#") ? hash.slice(1) : search.startsWith("?") ? search.slice(1) : ""
      );
      const accessToken  = params.get("access_token");
      const refreshToken = params.get("refresh_token");
      const type         = params.get("type");
      if (accessToken && (type === "magiclink" || type === "signup" || type === "recovery" || !type)) {
        // Fetch user info
        const res = await fetch(`${SB_URL}/auth/v1/user`, {
          headers: { apikey: SB_ANON, Authorization: `Bearer ${accessToken}` },
        });
        if (res.ok) {
          const user = await res.json();
          const session = { user: { id: user.id, email: user.email }, access_token: accessToken, refresh_token: refreshToken };
          localStorage.setItem(SESSION_KEY, JSON.stringify(session));
          // Clean URL so tokens don't linger
          window.history.replaceState(null, "", window.location.pathname);
          return session;
        }
      }
    }
    // Otherwise try stored session with refresh
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
          const fresh = { user: { id: data.user.id, email: data.user.email }, access_token: data.access_token, refresh_token: data.refresh_token };
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
const AuthCtx = createContext({ session:null, loading:true, sendOtp:async()=>{}, signOut:async()=>{} });

function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(()=>{
    authAdapter.getSession().then(s=>{setSession(s);setLoading(false);}).catch(()=>setLoading(false));
    const unsub=authAdapter.onAuthStateChange(s=>setSession(s));
    return unsub;
  },[]);
  const sendOtp = useCallback(async(email)=>{
    const result = await authAdapter.sendOtp(email);
    // Demo mode: auto-login immediately
    if (result?.demoAutoLogin && result?.session) setSession(result.session);
    return result;
  },[]);
  const signOut = useCallback(async()=>{await authAdapter.signOut();setSession(null);},[]);
  return <AuthCtx.Provider value={{session,loading,sendOtp,signOut}}>{children}</AuthCtx.Provider>;
}

// ─────────────────────────────────────────────────────────────────
//  § 7  LoginPage — Magic Link
// ─────────────────────────────────────────────────────────────────
function LoginPage() {
  const { sendOtp }        = useContext(AuthCtx);
  const [email,  setEmail] = useState("");
  const [sent,   setSent]  = useState(false);
  const [err,    setErr]   = useState("");
  const [busy,   setBusy]  = useState(false);

  const submit = async () => {
    setErr("");
    if (!email.trim() || !email.includes("@")) { setErr("請輸入有效的 Email"); return; }
    setBusy(true);
    try {
      await sendOtp(email.trim());
      setSent(true);
    } catch(e) { setErr(e.message || "發送失敗，請稍後再試"); }
    finally { setBusy(false); }
  };

  return (
    <div className="login-ocean">
      <div className="l-orb l-orb1" /><div className="l-orb l-orb2" /><div className="l-orb l-orb3" />
      <div className="login-glass">
        {/* Logo */}
        <div className="login-logo">
          <div className="logo-sphere" />
          <span className="logo-text"><span className="lt-a">E A S</span><span className="lt-b"> E A</span></span>
        </div>

        {!sent ? (
          <>
            <p className="login-title">登入你的 Ocean Flow</p>
            <p className="login-tag">輸入 Email，我們會寄送登入連結給你。</p>
            {err && <div className="lmsg err">{err}</div>}
            <input
              className="linput" type="email" placeholder="your@email.com"
              value={email} onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === "Enter" && submit()} autoFocus
            />
            <button className="lbtn" onClick={submit} disabled={busy}>
              {busy ? "寄送中…" : "寄送登入連結"}
            </button>
            {IS_MOCK && (
              <p className="ldemo">Demo 模式 · 輸入任意 Email 直接登入，不會真的寄信</p>
            )}
          </>
        ) : (
          <div className="login-sent">
            <div className="sent-icon">✉️</div>
            <p className="sent-title">登入信已寄出</p>
            <p className="sent-sub">請檢查 <strong>{email}</strong> 的信箱，點擊信中連結即可登入。</p>
            <button className="lbtn-ghost" onClick={() => { setSent(false); setEmail(""); }}>
              換一個 Email
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
//  § 8a  ProgressIndicator
//        Shows the dot + whisper when progress_today is true.
//        Props: hasProgress, isDone, justMarked
// ─────────────────────────────────────────────────────────────────
function ProgressIndicator({ hasProgress, isDone, justMarked, intent, intentHint }) {
  if (isDone) return null;
  if (hasProgress) {
    return (
      <span
        className={`progress-dot${justMarked ? " just-marked" : ""}`}
        title="今天有前進一點"
      />
    );
  }
  return (
    <span className={`tl-dot tld-${intent.toLowerCase()}`} title={intentHint} />
  );
}

// ─────────────────────────────────────────────────────────────────
//  § 8b  TaskSteps
//        Steps list + add-step input inside the drawer.
//        Props: taskId, steps, onToggleStep, onAddStep
// ─────────────────────────────────────────────────────────────────
function TaskSteps({ taskId, steps, onToggleStep, onAddStep }) {
  const [adding, setAdding] = useState(false);
  const [stepIn, setStepIn] = useState("");

  const doAdd = () => {
    if (!stepIn.trim()) return;
    onAddStep(taskId, stepIn.trim());
    setStepIn("");
    setAdding(false);
  };

  return (
    <>
      {steps.length > 0 && (
        <div className="tl-steps">
          {steps.map(s => (
            <div className="tls-row" key={s.id}>
              <button
                className={`tls-check${s.is_completed ? " done" : ""}`}
                onClick={() => onToggleStep(taskId, s.id)}
              >
                {s.is_completed && <TinyCheck size={7} />}
              </button>
              <span className={`tls-label${s.is_completed ? " done" : ""}`}>{s.title}</span>
            </div>
          ))}
        </div>
      )}
      {!adding
        ? <button className="tl-ghost" onClick={() => setAdding(true)}>+ 步驟</button>
        : (
          <div className="tl-addinput">
            <input
              autoFocus placeholder="步驟名稱…" value={stepIn}
              onChange={e => setStepIn(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") doAdd(); if (e.key === "Escape") setAdding(false); }}
            />
            <button onClick={doAdd}>加</button>
          </div>
        )
      }
    </>
  );
}

// ─────────────────────────────────────────────────────────────────
//  § 8c  TaskActions
//        Promote / demote / progress / remove buttons in drawer.
//        Props: taskId, intent, hasProgress, onShiftIntent,
//               onMarkProgress, onDelete, onJustMarked
// ─────────────────────────────────────────────────────────────────
function TaskActions({ taskId, intent, hasProgress, onShiftIntent, onMarkProgress, onDelete, onJustMarked }) {
  const canPromote = !!IntentMachine[intent]?.promote;
  const canDemote  = !!IntentMachine[intent]?.demote;

  const handleMarkProgress = () => {
    if (hasProgress) return;
    onMarkProgress(taskId);
    onJustMarked();
  };

  return (
    <div className="tl-actions">
      {!hasProgress && (
        <button className="tl-act progress" onClick={handleMarkProgress}>
          今天有碰過
        </button>
      )}
      <button
        className="tl-act promote"
        onClick={() => onShiftIntent(taskId, "promote")}
        disabled={!canPromote}
      >
        ↑ {canPromote ? IntentUI[IntentMachine[intent].promote].label : "—"}
      </button>
      <button
        className="tl-act demote"
        onClick={() => onShiftIntent(taskId, "demote")}
        disabled={!canDemote}
      >
        ↓ {canDemote ? IntentUI[IntentMachine[intent].demote].label : "—"}
      </button>
      <button className="tl-act remove" onClick={() => onDelete(taskId)}>
        移除
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
//  § 8  TaskLine
//       Orchestrates sub-components. Owns open/justMarked state.
//       All animation, CSS classes, and props unchanged.
// ─────────────────────────────────────────────────────────────────
function TaskLine({ task, index, onToggleDone, onToggleStep, onShiftIntent, onMarkProgress, onAddStep, onDelete, isLeaving }) {
  const [open,       setOpen]       = useState(false);
  const [justMarked, setJustMarked] = useState(false);

  const steps       = task.steps || [];
  const intent      = task.intent_state || "LATER";
  const ui          = IntentUI[intent];
  const isDone      = task.status === "done";
  const hasProgress = task.progress_today === true;

  const opacity = isDone ? 0.28 : Math.max(1 - index * 0.09, 0.72);
  const shiftY  = isDone ? 0    : index * 1.5;

  const handleJustMarked = () => {
    setJustMarked(true);
    setTimeout(() => setJustMarked(false), 2000);
  };

  return (
    <div
      className={`tl${isDone ? " tl-done" : ""}${isLeaving ? " tl-leaving" : ""}`}
      style={{ opacity, transform: `translateY(${shiftY}px)` }}
    >
      {/* Main row */}
      <div className="tl-row" onClick={() => !isDone && setOpen(o => !o)}>
        <button
          className={`tl-check${isDone ? " done" : ""}`}
          onClick={e => { e.stopPropagation(); onToggleDone(task.id); }}
        >
          {isDone && <TinyCheck />}
        </button>
        <span className={`tl-title${isDone ? " done" : ""}`}>{task.title}</span>
        <ProgressIndicator
          hasProgress={hasProgress}
          isDone={isDone}
          justMarked={justMarked}
          intent={intent}
          intentHint={ui.hint}
        />
      </div>

      {/* Soft whisper — very low key */}
      {hasProgress && !isDone && (
        <p className="progress-whisper">今天有前進一點。</p>
      )}

      {/* Expanded drawer */}
      {open && !isDone && (
        <div className="tl-drawer">
          <TaskSteps
            taskId={task.id}
            steps={steps}
            onToggleStep={onToggleStep}
            onAddStep={onAddStep}
          />
          <TaskActions
            taskId={task.id}
            intent={intent}
            hasProgress={hasProgress}
            onShiftIntent={onShiftIntent}
            onMarkProgress={onMarkProgress}
            onDelete={onDelete}
            onJustMarked={handleJustMarked}
          />
          <p className="tl-hint">{ui.hint}</p>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
//  § 9  AddSheet — frosted glass capture
// ─────────────────────────────────────────────────────────────────
function AddSheet({ onClose, onAdd }) {
  const [title, setTitle]   = useState("");
  const [intent,setIntent]  = useState("LATER");

  const STATES=[["NOW","此刻"],["SOON","稍後"],["LATER","晚點"],["SHELF","留著"]];

  const submit = () => {
    if(!title.trim()) return;
    onAdd({id:uid(),title:title.trim(),steps:[],due_date:todayStr(),status:"active",auto_shifted:false,...mkIntent(intent)});
    onClose();
  };

  return (
    <div className="sveil" onClick={onClose}>
      <div className="sglass" onClick={e=>e.stopPropagation()}>
        <div className="spull"/>
        <p className="swhisper">想到什麼，就先放進來。</p>
        <input className="sfield" autoFocus placeholder="現在想到的是⋯"
          value={title} onChange={e=>setTitle(e.target.value)}
          onKeyDown={e=>e.key==="Enter"&&submit()}/>
        <div className="sintents">
          {STATES.map(([s,l])=>(
            <button key={s} className={`sint sint-${s.toLowerCase()}${intent===s?" on":""}`} onClick={()=>setIntent(s)}>{l}</button>
          ))}
        </div>
        <button className="sdrop" onClick={submit}>放進今天</button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
//  § 10  UserMenu
// ─────────────────────────────────────────────────────────────────
function UserMenu({ onClose }) {
  const { session, signOut } = useContext(AuthCtx);
  const { theme, setTheme }  = useContext(ThemeCtx);
  const ref = useRef(null);
  useEffect(()=>{
    const h=e=>{if(ref.current&&!ref.current.contains(e.target))onClose();};
    setTimeout(()=>document.addEventListener("mousedown",h),0);
    return()=>document.removeEventListener("mousedown",h);
  },[onClose]);
  return (
    <div className="umenu" ref={ref}>
      <div className="u-email">{session?.user?.email}</div>
      <div className="u-themes">
        {[["light","☀️"],["dark","🌙"]].map(([t,i])=>(
          <button key={t} className={`uth${theme===t?" on":""}`} onClick={()=>setTheme(t)}>{i}</button>
        ))}
      </div>
      <button className="u-out" onClick={()=>{signOut();onClose();}}>登出</button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
//  § 11  TodayFlow — uses useIntentFlow + useTaskAnimation
// ─────────────────────────────────────────────────────────────────
const SURFACE = 3;

function TodayFlow({ tasks, onToggleDone, onToggleStep, onShiftIntent, onMarkProgress, onAddStep, onDelete }) {
  const today = todayStr();
  const [showRest, setShowRest] = useState(false);

  const { surface, rest, greet, sub } = useIntentFlow(tasks, today, flowScore);
  const { leaving, handleDone }       = useTaskAnimation(tasks, onToggleDone);

  const h = { onToggleDone: handleDone, onToggleStep, onShiftIntent, onMarkProgress, onAddStep, onDelete };

  return (
    <div className="ocean-view">
      <div className="ov-header">
        <h1 className="ov-greet">{greet}</h1>
        <p  className="ov-sub">{sub}</p>
      </div>

      <div className="ov-surface">
        {surface.length === 0 && rest.length === 0 && (
          <div className="ov-empty">
            <span className="ov-wave">🌊</span>
            <p className="ov-empty-title">今天空空的。</p>
            <p className="ov-empty-sub">什麼都不用管。</p>
          </div>
        )}

        {surface.map((tk, i) => (
          <TaskLine key={tk.id} task={tk} index={i} isLeaving={leaving.has(tk.id)} {...h} />
        ))}

        {rest.length > 0 && !showRest && (
          <button className="ov-more" onClick={() => setShowRest(true)}>
            還有 {rest.length} 件在後面
          </button>
        )}
        {showRest && rest.map((tk, i) => (
          <TaskLine key={tk.id} task={tk} index={SURFACE + i} isLeaving={leaving.has(tk.id)} {...h} />
        ))}
      </div>
    </div>
  );
}

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
        <span className="tb-brand">
          <span className="tb-orb" />
          <span className="tb-wordmark">
            <span className="tb-ea">Ea</span><span className="tb-sea">sea</span>
          </span>
        </span>
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


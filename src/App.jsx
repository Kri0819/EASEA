// ╔══════════════════════════════════════════════════════════════╗
// ║  EASEA  —  Ocean Flow OS                                     ║
// ║  § 1–6   unchanged: config / utils / auth / data / theme / auth-ctx
// ║  § 7–15  full Ocean Flow UI rewrite                         ║
// ╚══════════════════════════════════════════════════════════════╝
import {
  useState, useEffect, useCallback,
  useContext, createContext, useRef, useMemo,
} from "react";

// ─────────────────────────────────────────────────────────────────
//  § 1  CONFIG
// ─────────────────────────────────────────────────────────────────
const SB_URL  = "";
const SB_ANON = "";
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
    { id: uid(), title: "打電話給牙醫",    steps: [], due_date: todayStr(),             status: "active", auto_shifted: false, ...mkIntent("NOW")   },
    { id: uid(), title: "整理產品需求文件", steps: [{ id: uid(), title: "讀完文件", is_completed: true }, { id: uid(), title: "寫回饋意見", is_completed: false }], due_date: todayStr(), status: "active", auto_shifted: false, ...mkIntent("SOON")  },
    { id: uid(), title: "回覆信件",        steps: [], due_date: addDays(todayStr(), -1), status: "active", auto_shifted: false, ...mkIntent("SOON")  },
    { id: uid(), title: "買菜",            steps: [{ id: uid(), title: "牛奶和雞蛋", is_completed: false }, { id: uid(), title: "蔬菜水果", is_completed: false }], due_date: todayStr(), status: "active", auto_shifted: false, ...mkIntent("LATER") },
    { id: uid(), title: "完成簡報",        steps: [], due_date: todayStr(),             status: "active", auto_shifted: false, ...mkIntent("SHELF") },
  ]);
}

// ─────────────────────────────────────────────────────────────────
//  § 3  Auth adapter
// ─────────────────────────────────────────────────────────────────
const SESSION_KEY = "easea_session_v3";
const _mockUsers  = (() => { try { return JSON.parse(localStorage.getItem("easea_mock_users") || "{}"); } catch { return {}; } })();
const saveMock    = () => { try { localStorage.setItem("easea_mock_users", JSON.stringify(_mockUsers)); } catch {} };

const mockAuth = {
  async signIn(email, password) {
    await sleep(500);
    const k = email.toLowerCase().trim();
    if (!_mockUsers[k]) { _mockUsers[k] = { id: uid(), email: k, password }; saveMock(); }
    if (_mockUsers[k].password !== password) throw new Error("密碼不正確");
    const session = { user: { id: _mockUsers[k].id, email: k }, access_token: uid() };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    return session;
  },
  async signUp(email, password) { return this.signIn(email, password); },
  async signOut() { localStorage.removeItem(SESSION_KEY); },
  async getSession() { try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch { return null; } },
  onAuthStateChange(cb) {
    const read = () => { try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); } catch { return null; } };
    cb(read());
    const id = setInterval(() => cb(read()), 3000);
    return () => clearInterval(id);
  },
};

const sbAuth = {
  async signIn(email, password) {
    const res = await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, { method:"POST", headers:{"Content-Type":"application/json",apikey:SB_ANON}, body:JSON.stringify({email,password}) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error_description || data.msg || "登入失敗");
    const session = { user:{id:data.user.id,email:data.user.email}, access_token:data.access_token, refresh_token:data.refresh_token };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    return session;
  },
  async signUp(email, password) {
    const res = await fetch(`${SB_URL}/auth/v1/signup`, { method:"POST", headers:{"Content-Type":"application/json",apikey:SB_ANON}, body:JSON.stringify({email,password}) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error_description || data.msg || "註冊失敗");
    if (!data.access_token) return null;
    const session = { user:{id:data.user.id,email:data.user.email}, access_token:data.access_token, refresh_token:data.refresh_token };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    return session;
  },
  async signOut() {
    const s = await this.getSession();
    if (s) await fetch(`${SB_URL}/auth/v1/logout`,{method:"POST",headers:{apikey:SB_ANON,Authorization:`Bearer ${s.access_token}`}}).catch(()=>{});
    localStorage.removeItem(SESSION_KEY);
  },
  async getSession() {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    try {
      const s = JSON.parse(raw);
      if (s.refresh_token) {
        const res = await fetch(`${SB_URL}/auth/v1/token?grant_type=refresh_token`,{method:"POST",headers:{"Content-Type":"application/json",apikey:SB_ANON},body:JSON.stringify({refresh_token:s.refresh_token})});
        if (res.ok) { const data=await res.json(); const fresh={user:{id:data.user.id,email:data.user.email},access_token:data.access_token,refresh_token:data.refresh_token}; localStorage.setItem(SESSION_KEY,JSON.stringify(fresh)); return fresh; }
      }
      return s;
    } catch { return null; }
  },
  onAuthStateChange(cb) {
    this.getSession().then(s=>cb(s)).catch(()=>cb(null));
    const id = setInterval(()=>{ try{cb(JSON.parse(localStorage.getItem(SESSION_KEY)||"null"));}catch{cb(null);} },5000);
    return ()=>clearInterval(id);
  },
};

const authAdapter = IS_MOCK ? mockAuth : sbAuth;

// ─────────────────────────────────────────────────────────────────
//  § 4  Tasks data adapter
// ─────────────────────────────────────────────────────────────────
const cacheKey  = userId => `easea_tasks_v3_${userId}`;
const sbHeaders = (token, extra={}) => ({ apikey:SB_ANON, Authorization:`Bearer ${token||SB_ANON}`, "Content-Type":"application/json", ...extra });
const fromDB    = r => ({ id:r.id, title:r.title, due_date:r.due_date, status:r.status, intent_state:r.intent_state??"LATER", intent_meta:r.intent_meta??{last_touch:null,reason:null}, auto_shifted:r.auto_shifted, steps:r.steps||[] });
const toDB      = (t,uid) => ({ id:t.id, user_id:uid, title:t.title, due_date:t.due_date, status:t.status, intent_state:t.intent_state??"LATER", intent_meta:t.intent_meta??null, auto_shifted:t.auto_shifted, steps:t.steps, updated_at:new Date().toISOString() });

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
const ThemeCtx = createContext({ theme:"system", resolved:"light", setTheme:()=>{} });

function ThemeProvider({ children }) {
  const [theme,  _set]   = useState(()=>localStorage.getItem("easea_theme")||"system");
  const [sysDark,setSys] = useState(()=>window.matchMedia("(prefers-color-scheme: dark)").matches);

  useEffect(()=>{
    const mq=window.matchMedia("(prefers-color-scheme: dark)");
    const h=e=>setSys(e.matches);
    mq.addEventListener("change",h);
    return()=>mq.removeEventListener("change",h);
  },[]);

  const resolved = theme==="system"?(sysDark?"dark":"light"):theme;
  const setTheme = useCallback(t=>{_set(t);localStorage.setItem("easea_theme",t);},[]);

  // Apply to BOTH html and body so CSS vars cascade correctly in iframes
  useEffect(()=>{
    document.documentElement.setAttribute("data-theme", resolved);
    document.body.setAttribute("data-theme", resolved);
  },[resolved]);

  // Also apply synchronously on first render (before paint)
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-theme", resolved);
    document.body.setAttribute("data-theme", resolved);
  }

  return <ThemeCtx.Provider value={{theme,resolved,setTheme}}>{children}</ThemeCtx.Provider>;
}

// ─────────────────────────────────────────────────────────────────
//  § 6  AuthContext
// ─────────────────────────────────────────────────────────────────
const AuthCtx = createContext({ session:null, loading:true, signIn:async()=>{}, signUp:async()=>{}, signOut:async()=>{} });

function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(()=>{
    authAdapter.getSession().then(s=>{setSession(s);setLoading(false);}).catch(()=>setLoading(false));
    const unsub=authAdapter.onAuthStateChange(s=>setSession(s));
    return unsub;
  },[]);
  const signIn  = useCallback(async(e,p)=>{const s=await authAdapter.signIn(e,p);setSession(s);return s;},[]);
  const signUp  = useCallback(async(e,p)=>{const s=await authAdapter.signUp(e,p);setSession(s);return s;},[]);
  const signOut = useCallback(async()=>{await authAdapter.signOut();setSession(null);},[]);
  return <AuthCtx.Provider value={{session,loading,signIn,signUp,signOut}}>{children}</AuthCtx.Provider>;
}

// ─────────────────────────────────────────────────────────────────
//  § 7  LoginPage — Ocean Landing
// ─────────────────────────────────────────────────────────────────
function LoginPage() {
  const { signIn, signUp } = useContext(AuthCtx);
  const [tab,  setTab]  = useState("signin");
  const [email,setEmail]= useState("");
  const [pw,   setPw]   = useState("");
  const [pw2,  setPw2]  = useState("");
  const [err,  setErr]  = useState("");
  const [ok,   setOk]   = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setErr(""); setOk("");
    if (!email.trim()||!pw) { setErr("請填寫 Email 與密碼"); return; }
    if (tab==="signup"&&pw!==pw2) { setErr("兩次密碼不一致"); return; }
    setBusy(true);
    try {
      if (tab==="signin") { await signIn(email.trim(),pw); }
      else { const s=await signUp(email.trim(),pw); if(!s) setOk("確認信已寄出，請收信後再登入。"); }
    } catch(e) { setErr(e.message||"操作失敗，請再試"); }
    finally { setBusy(false); }
  };

  return (
    <div className="login-ocean">
      <div className="l-orb l-orb1" /><div className="l-orb l-orb2" /><div className="l-orb l-orb3" />
      <div className="login-glass">
        <div className="login-logo">
          <div className="logo-sphere" />
          <span className="logo-text"><span className="lt-a">E A S</span><span className="lt-b"> E A</span></span>
        </div>
        <p className="login-tag">時間像水一樣流動。<br/>你只需要做現在這一件事。</p>
        <div className="login-tabs">
          <button className={`ltab${tab==="signin"?" on":""}`} onClick={()=>{setTab("signin");setErr("");setOk("");}}>登入</button>
          <button className={`ltab${tab==="signup"?" on":""}`} onClick={()=>{setTab("signup");setErr("");setOk("");}}>註冊</button>
        </div>
        {err&&<div className="lmsg err">{err}</div>}
        {ok &&<div className="lmsg ok">{ok}</div>}
        <input className="linput" type="email"    placeholder="Email"    value={email} onChange={e=>setEmail(e.target.value)} onKeyDown={e=>e.key==="Enter"&&submit()} />
        <input className="linput" type="password" placeholder="密碼"     value={pw}    onChange={e=>setPw(e.target.value)}    onKeyDown={e=>e.key==="Enter"&&submit()} />
        {tab==="signup"&&<input className="linput" type="password" placeholder="確認密碼" value={pw2} onChange={e=>setPw2(e.target.value)} onKeyDown={e=>e.key==="Enter"&&submit()} />}
        <button className="lbtn" onClick={submit} disabled={busy}>{busy?"⋯":tab==="signin"?"進入":"建立帳號"}</button>
        {IS_MOCK&&<p className="ldemo">Demo 模式 · 任意帳號密碼即可</p>}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
//  § 8  TaskLine — floating line, depth-faded
// ─────────────────────────────────────────────────────────────────
function TaskLine({ task, index, onToggleDone, onToggleStep, onShiftIntent, onAddStep, onDelete, isLeaving }) {
  const [open,   setOpen]   = useState(false);
  const [adding, setAdding] = useState(false);
  const [stepIn, setStepIn] = useState("");

  const steps      = task.steps || [];
  const doneSteps  = steps.filter(s=>s.is_completed).length;
  const intent     = task.intent_state || "LATER";
  const ui         = IntentUI[intent];
  const isDone     = task.status === "done";
  const canPromote = !!IntentMachine[intent]?.promote;
  const canDemote  = !!IntentMachine[intent]?.demote;

  // Depth: first task = full opacity, each deeper task fades gently
  const opacity   = isDone ? 0.18 : Math.max(1 - index * 0.14, 0.32);
  const blur      = isDone ? 0    : Math.min(index * 0.28, 0.85);
  const shiftY    = isDone ? 0    : index * 1.5;

  const doAdd = () => { if(stepIn.trim()){onAddStep(task.id,stepIn.trim());setStepIn("");setAdding(false);} };

  return (
    <div
      className={`tl${isDone?" tl-done":""}${isLeaving?" tl-leaving":""}`}
      style={{ opacity, filter:`blur(${blur}px)`, transform:`translateY(${shiftY}px)` }}
    >
      <div className="tl-row" onClick={()=>!isDone&&setOpen(o=>!o)}>
        <button
          className={`tl-check${isDone?" done":""}`}
          onClick={e=>{e.stopPropagation();onToggleDone(task.id);}}
        >
          {isDone&&<TinyCheck/>}
        </button>
        <span className={`tl-title${isDone?" done":""}`}>{task.title}</span>
        {!isDone&&<span className={`tl-dot tld-${intent.toLowerCase()}`} title={ui.hint}/>}
      </div>

      {open&&!isDone&&(
        <div className="tl-drawer">
          {steps.length>0&&(
            <div className="tl-steps">
              {steps.map(s=>(
                <div className="tls-row" key={s.id}>
                  <button className={`tls-check${s.is_completed?" done":""}`} onClick={()=>onToggleStep(task.id,s.id)}>
                    {s.is_completed&&<TinyCheck size={7}/>}
                  </button>
                  <span className={`tls-label${s.is_completed?" done":""}`}>{s.title}</span>
                </div>
              ))}
            </div>
          )}
          {!adding
            ? <button className="tl-ghost" onClick={()=>setAdding(true)}>+ 步驟</button>
            : <div className="tl-addinput">
                <input autoFocus placeholder="步驟名稱…" value={stepIn}
                  onChange={e=>setStepIn(e.target.value)}
                  onKeyDown={e=>{if(e.key==="Enter")doAdd();if(e.key==="Escape")setAdding(false);}}/>
                <button onClick={doAdd}>加</button>
              </div>
          }
          <div className="tl-actions">
            <button className="tl-act promote" onClick={()=>onShiftIntent(task.id,"promote")} disabled={!canPromote}>
              ↑ {canPromote?IntentUI[IntentMachine[intent].promote].label:"—"}
            </button>
            <button className="tl-act demote"  onClick={()=>onShiftIntent(task.id,"demote")}  disabled={!canDemote}>
              ↓ {canDemote?IntentUI[IntentMachine[intent].demote].label:"—"}
            </button>
            <button className="tl-act remove"  onClick={()=>onDelete(task.id)}>移除</button>
          </div>
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
        {[["light","☀️"],["dark","🌙"],["system","💻"]].map(([t,i])=>(
          <button key={t} className={`uth${theme===t?" on":""}`} onClick={()=>setTheme(t)}>{i}</button>
        ))}
      </div>
      <button className="u-out" onClick={()=>{signOut();onClose();}}>登出</button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
//  § 11  TodayFlow — ocean surface, max 3, depth fade, no done section
// ─────────────────────────────────────────────────────────────────
const SURFACE = 3;

function TodayFlow({ tasks, onToggleDone, onToggleStep, onShiftIntent, onAddStep, onDelete }) {
  const t = todayStr();
  const [leaving,  setLeaving]  = useState(new Set());
  const [showRest, setShowRest] = useState(false);

  const handleDone = useCallback(id => {
    const task = tasks.find(tk=>tk.id===id);
    if (task&&task.status!=="done") {
      setLeaving(s=>new Set([...s,id]));
      setTimeout(()=>{
        onToggleDone(id);
        setLeaving(s=>{const ns=new Set(s);ns.delete(id);return ns;});
      }, 620);
    } else { onToggleDone(id); }
  },[tasks,onToggleDone]);

  const stream = useMemo(()=>tasks
    .filter(tk=>tk.status!=="done"&&(tk.due_date===t||tk.auto_shifted))
    .sort((a,b)=>flowScore(b)-flowScore(a)),
    [tasks,t]
  );

  const surface = stream.slice(0, SURFACE);
  const rest    = stream.slice(SURFACE);

  const hr    = new Date().getHours();
  const greet = hr<5?"深夜了。":hr<12?"早安。":hr<18?"午安。":"晚安。";
  const sub   = stream.length===0?"今天很輕。":stream.length===1?"一件一件就好。":stream.length<=3?"慢慢來。":"做不完沒關係。";

  const h = { onToggleDone:handleDone, onToggleStep, onShiftIntent, onAddStep, onDelete };

  return (
    <div className="ocean-view">
      <div className="ov-header">
        <h1 className="ov-greet">{greet}</h1>
        <p  className="ov-sub">{sub}</p>
      </div>

      <div className="ov-surface">
        {stream.length===0&&(
          <div className="ov-empty">
            <span className="ov-wave">🌊</span>
            <p className="ov-empty-title">今天空空的。</p>
            <p className="ov-empty-sub">什麼都不用管。</p>
          </div>
        )}

        {surface.map((tk,i)=>(
          <TaskLine key={tk.id} task={tk} index={i} isLeaving={leaving.has(tk.id)} {...h}/>
        ))}

        {rest.length>0&&!showRest&&(
          <button className="ov-more" onClick={()=>setShowRest(true)}>
            還有 {rest.length} 件在後面
          </button>
        )}
        {showRest&&rest.map((tk,i)=>(
          <TaskLine key={tk.id} task={tk} index={SURFACE+i} isLeaving={leaving.has(tk.id)} {...h}/>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
//  § 12  AppShell
// ─────────────────────────────────────────────────────────────────
function AppShell() {
  const { session }             = useContext(AuthCtx);
  const userId                  = session?.user?.id;
  const token                   = session?.access_token;
  const [menuOpen, setMenuOpen] = useState(false);
  const [showAdd,  setShowAdd]  = useState(false);
  const [tasks,    setTasks]    = useState(()=>tasksDB.getLocal(userId)||makeSeed());
  const [synced,   setSynced]   = useState(IS_MOCK);

  useEffect(()=>{
    if(IS_MOCK||!userId||!token) return;
    tasksDB.fetchAll(userId,token)
      .then(remote=>{const m=rollover(remote);setTasks(m);tasksDB.setLocal(userId,m);setSynced(true);})
      .catch(()=>setSynced(true));
  },[userId,token]);

  useEffect(()=>{if(userId)tasksDB.setLocal(userId,tasks);},[tasks,userId]);

  const push = useCallback(task=>{
    if(IS_MOCK||!userId||!token) return;
    tasksDB.upsert(task,userId,token).catch(()=>{});
  },[userId,token]);

  const del = useCallback(id=>{
    if(IS_MOCK||!userId||!token) return;
    tasksDB.remove(id,token).catch(()=>{});
  },[userId,token]);

  const mutate = useCallback((id,fn)=>{
    let changed;
    setTasks(ts=>ts.map(t=>t.id===id?(changed={...fn(t)}):t));
    if(changed) push(changed);
  },[push]);

  const handlers = {
    onToggleDone:   useCallback(id=>mutate(id,t=>({...t,status:t.status==="done"?"active":"done"})),[mutate]),
    onShiftIntent:  useCallback((id,action)=>{
      let changed;
      setTasks(ts=>ts.map(t=>{
        if(t.id!==id) return t;
        const cur  = t.intent_state||"LATER";
        const next = action==="promote"?IntentMachine[cur]?.promote:IntentMachine[cur]?.demote;
        return (changed={...t,intent_state:next||cur,intent_meta:{...t.intent_meta,last_touch:Date.now()}});
      }));
      if(changed) push(changed);
    },[push]),
    onToggleStep:   useCallback((tid,sid)=>{
      let changed;
      setTasks(ts=>ts.map(t=>{
        if(t.id!==tid) return t;
        const steps=t.steps.map(s=>s.id===sid?{...s,is_completed:!s.is_completed}:s);
        const all=steps.length>0&&steps.every(s=>s.is_completed);
        return (changed={...t,steps,status:all?"done":t.status==="done"?"active":t.status});
      }));
      if(changed) push(changed);
    },[push]),
    onAddStep:      useCallback((tid,title)=>{
      let changed;
      setTasks(ts=>ts.map(t=>t.id===tid?(changed={...t,steps:[...t.steps,{id:uid(),title,is_completed:false}]}):t));
      if(changed) push(changed);
    },[push]),
    onDelete:       useCallback(id=>{setTasks(ts=>ts.filter(t=>t.id!==id));del(id);},[del]),
  };

  return (
    <div className="app-shell">
      {/* Drifting background orbs */}
      <div className="bg-orb o1"/><div className="bg-orb o2"/><div className="bg-orb o3"/>

      {/* Top bar */}
      <header className="topbar">
        <span className="tb-brand"><span className="tb-ea">Ea</span><span className="tb-sea">sea</span></span>
        <div className="tb-right">
          {!IS_MOCK&&<div className={`sync-bead${synced?" on":""}`}/>}
          <div style={{position:"relative"}}>
            <button className="tb-avatar" onClick={()=>setMenuOpen(o=>!o)}>
              {(session?.user?.email||"U")[0].toUpperCase()}
            </button>
            {menuOpen&&<UserMenu onClose={()=>setMenuOpen(false)}/>}
          </div>
        </div>
      </header>

      <TodayFlow tasks={tasks} {...handlers}/>

      {/* Buoy FAB */}
      <button className="buoy" onClick={()=>setShowAdd(true)} aria-label="加一件事">
        <PlusIco/>
      </button>

      {showAdd&&<AddSheet onClose={()=>setShowAdd(false)} onAdd={task=>{setTasks(ts=>[...ts,task]);push(task);}}/>}
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
        <style>{CSS}</style>
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

// ─────────────────────────────────────────────────────────────────
//  § 15  CSS — Ocean Flow OS
// ─────────────────────────────────────────────────────────────────
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,300;0,400;0,500;1,300&family=Noto+Sans+TC:wght@300;400;500&display=swap');

*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}

/* ══ Tokens — Light (霧海白天) ══ */
:root {
  --bg:         #ECF0FA;
  --glass:      rgba(255,255,255,.54);
  --glass-str:  rgba(255,255,255,.82);
  --glass-bd:   rgba(210,220,248,.50);
  --fog:        rgba(255,255,255,.68);
  --fog-bd:     rgba(200,215,245,.40);

  --ink:        #28344A;
  --ink2:       #58698A;
  --ink3:       #8A9AB8;
  --ink4:       #C2CEDF;

  --orb1: rgba(185,200,240,.55);
  --orb2: rgba(215,190,235,.45);
  --orb3: rgba(165,215,238,.42);

  --accent:     #6E8ED8;
  --accent-d:   #5070C4;
  --accent-s:   rgba(110,142,216,.12);
}

/* ══ Tokens — Dark (深海夜晚) ══ */
:root[data-theme="dark"],
body[data-theme="dark"] {
  --bg:         #08121C;
  --glass:      rgba(14,24,40,.60);
  --glass-str:  rgba(18,32,52,.85);
  --glass-bd:   rgba(48,78,120,.45);
  --fog:        rgba(16,28,46,.70);
  --fog-bd:     rgba(40,70,110,.40);

  --ink:        #D5E8F8;
  --ink2:       #8AAAC8;
  --ink3:       #4E6888;
  --ink4:       #2C4060;

  --orb1: rgba(44,80,168,.55);
  --orb2: rgba(76,48,128,.45);
  --orb3: rgba(28,78,138,.50);

  --accent:     #6498E8;
  --accent-d:   #4878D4;
  --accent-s:   rgba(100,152,232,.15);
}

/* ══ Keyframes ══ */
@keyframes o1 { 0%,100%{transform:translate(0,0) scale(1);}  40%{transform:translate(28px,-18px) scale(1.07);} 75%{transform:translate(-14px,22px) scale(.94);} }
@keyframes o2 { 0%,100%{transform:translate(0,0) scale(1);}  35%{transform:translate(-22px,14px) scale(1.09);} 70%{transform:translate(18px,-26px) scale(.92);} }
@keyframes o3 { 0%,100%{transform:translate(0,0) scale(1);}  50%{transform:translate(14px,18px) scale(1.05);} }
@keyframes buoyBob  { 0%,100%{transform:translateY(0);}         50%{transform:translateY(-5px);} }
@keyframes sphereFl { 0%,100%{transform:translateY(0);}         50%{transform:translateY(-7px);} }
@keyframes dissolve {
  0%   {opacity:1;transform:translateY(0) scale(1);filter:blur(0);max-height:140px;margin-bottom:0px;}
  100% {opacity:0;transform:translateY(16px) scale(.97);filter:blur(5px);max-height:0;margin-bottom:0;}
}
@keyframes riseUp   { from{opacity:0;transform:translateY(100%);} }
@keyframes drawerIn { from{opacity:0;transform:translateY(-5px);} }
@keyframes fadeIn   { from{opacity:0;} }
@keyframes tideSpin { to  {transform:rotate(360deg);} }
@keyframes pulse    { 0%,100%{opacity:1;} 50%{opacity:.2;} }

/* ══ Base ══ */
html,body{height:100%;}
body {
  background: var(--bg);
  font-family:'Inter','Noto Sans TC',system-ui,sans-serif;
  color:var(--ink);
  -webkit-font-smoothing:antialiased;
  -webkit-overflow-scrolling:touch;
  overflow-x:hidden;
  transition:background .4s, color .3s;
}

/* ══ App shell ══ */
.app-shell {
  position:relative;
  max-width:430px; margin:0 auto;
  min-height:100vh; overflow:hidden;
  padding-bottom:120px;
}

/* ══ Background orbs ══ */
.bg-orb {
  position:fixed; border-radius:50%;
  pointer-events:none; z-index:0; filter:blur(70px);
}
.o1 { width:380px;height:380px; top:-90px;left:-90px;  background:var(--orb1); animation:o1 24s ease-in-out infinite; }
.o2 { width:300px;height:300px; top:28%;right:-70px;   background:var(--orb2); animation:o2 30s ease-in-out infinite; }
.o3 { width:260px;height:260px; bottom:12%;left:8%;    background:var(--orb3); animation:o3 21s ease-in-out infinite; }

/* ══ Topbar ══ */
.topbar {
  position:relative;z-index:10;
  display:flex;align-items:center;justify-content:space-between;
  padding:20px 26px 0;
}
.tb-brand { font-size:17px;font-weight:600;letter-spacing:-.022em;line-height:1; }
.tb-ea    { color:var(--ink); }
.tb-sea   { color:var(--accent); }
.tb-right { display:flex;align-items:center;gap:10px; }
.sync-bead { width:5px;height:5px;border-radius:50%;background:var(--ink4);transition:background .4s; }
.sync-bead.on { background:#52D68A; }
.tb-avatar {
  width:28px;height:28px;border-radius:50%;
  background:var(--accent-s);border:1px solid var(--glass-bd);
  font-size:11px;font-weight:600;color:var(--accent);
  cursor:pointer;display:flex;align-items:center;justify-content:center;
  transition:all .2s;
}
.tb-avatar:hover { background:var(--glass-str);transform:scale(1.08); }

/* ══ Ocean view ══ */
.ocean-view { position:relative;z-index:5;padding:0 26px; }

.ov-header { padding:56px 0 0; }
.ov-greet  {
  font-size:36px;font-weight:300;font-style:italic;
  color:var(--ink);letter-spacing:-.03em;line-height:1.12;
}
.ov-sub {
  font-size:14px;color:var(--ink3);
  margin-top:10px;font-weight:300;line-height:1.85;
}

.ov-surface { margin-top:48px; }

/* ══ Empty state ══ */
.ov-empty { text-align:center;padding:60px 0 24px; }
.ov-wave  { font-size:46px;display:inline-block;animation:buoyBob 4s ease-in-out infinite; }
.ov-empty-title { font-size:20px;font-weight:300;font-style:italic;color:var(--ink2);margin-top:14px; }
.ov-empty-sub   { font-size:13px;color:var(--ink3);margin-top:6px;font-weight:300;line-height:1.9; }

/* ══ Task line ══ */
.tl {
  transition: opacity .55s cubic-bezier(.22,1,.36,1),
              filter  .55s cubic-bezier(.22,1,.36,1),
              transform .55s cubic-bezier(.22,1,.36,1);
  animation: fadeIn .3s ease both;
}
.tl-leaving {
  animation: dissolve .62s cubic-bezier(.4,0,.8,1) forwards !important;
  pointer-events:none;
}
.tl-done { pointer-events:none; }

.tl-row {
  display:flex;align-items:center;gap:14px;
  padding:15px 0;
  border-bottom:1px solid var(--fog-bd);
  cursor:pointer;
  -webkit-tap-highlight-color:transparent;
  transition:opacity .14s;
}
.tl-row:active { opacity:.7; }

/* Checkbox */
.tl-check {
  width:20px;height:20px;border-radius:50%;
  border:1px solid var(--ink4);flex-shrink:0;
  display:flex;align-items:center;justify-content:center;
  cursor:pointer;transition:all .18s;
  background:transparent;color:#fff;
}
.tl-check:hover { border-color:var(--accent);background:var(--accent-s); }
.tl-check.done  { background:var(--accent);border-color:var(--accent); }

/* Title */
.tl-title { flex:1;font-size:15.5px;font-weight:400;color:var(--ink);line-height:1.5;letter-spacing:-.005em; }
.tl-title.done { text-decoration:line-through;color:var(--ink4); }

/* Intent dot */
.tl-dot { width:6px;height:6px;border-radius:50%;flex-shrink:0;transition:all .3s; }
.tld-now   { background:var(--accent);opacity:.88;box-shadow:0 0 6px rgba(110,142,216,.55); }
.tld-soon  { background:var(--accent);opacity:.45; }
.tld-later { background:var(--ink4);opacity:.45; }
.tld-shelf { background:var(--ink4);opacity:.15; }

/* ══ Drawer ══ */
.tl-drawer {
  padding:10px 0 14px 34px;
  border-bottom:1px solid var(--fog-bd);
  animation:drawerIn .2s ease both;
}
.tl-steps { margin-bottom:8px; }
.tls-row {
  display:flex;align-items:center;gap:10px;
  padding:5px 0;border-bottom:1px solid rgba(200,215,245,.18);
}
.tls-row:last-child { border-bottom:none; }
.tls-check {
  width:14px;height:14px;border-radius:3px;
  border:1px solid var(--ink4);
  display:flex;align-items:center;justify-content:center;
  cursor:pointer;transition:all .13s;background:transparent;color:#fff;
}
.tls-check:hover { border-color:var(--accent); }
.tls-check.done  { background:var(--accent);border-color:var(--accent); }
.tls-label      { font-size:13px;color:var(--ink2);flex:1;font-weight:300; }
.tls-label.done { text-decoration:line-through;color:var(--ink4); }

.tl-ghost {
  background:none;border:none;cursor:pointer;
  font-size:12px;color:var(--ink4);
  font-family:inherit;padding:6px 0 2px;display:block;transition:color .12s;
}
.tl-ghost:hover { color:var(--ink3); }

.tl-addinput { display:flex;gap:6px;margin-top:6px; }
.tl-addinput input {
  flex:1;border:none;border-bottom:1px solid var(--fog-bd);
  background:transparent;padding:5px 0;
  font-family:inherit;font-size:13px;color:var(--ink);outline:none;
}
.tl-addinput input::placeholder { color:var(--ink4); }
.tl-addinput input:focus { border-color:var(--accent); }
.tl-addinput button {
  background:var(--accent);color:#fff;border:none;
  border-radius:99px;padding:4px 12px;font-size:12px;cursor:pointer;
  transition:background .13s;
}
.tl-addinput button:hover { background:var(--accent-d); }

.tl-actions { display:flex;gap:7px;margin-top:12px; }
.tl-act {
  background:none;border:1px solid var(--fog-bd);
  border-radius:99px;padding:4px 13px;
  font-family:inherit;font-size:11.5px;color:var(--ink3);
  cursor:pointer;transition:all .14s;
}
.tl-act:hover:not(:disabled) { background:var(--fog);color:var(--ink2); }
.tl-act:disabled { opacity:.2;cursor:default; }
.tl-act.promote:not(:disabled):hover { border-color:var(--accent);color:var(--accent); }
.tl-act.remove:hover { color:#A85050;border-color:rgba(168,80,80,.3); }
.tl-hint { font-size:10.5px;color:var(--ink4);margin-top:8px;font-weight:300;letter-spacing:.04em; }

/* ══ More button ══ */
.ov-more {
  display:block;width:100%;margin-top:22px;
  background:none;border:none;cursor:pointer;
  font-family:inherit;font-size:12px;font-weight:300;
  color:var(--ink4);text-align:center;letter-spacing:.06em;
  padding:10px 0;transition:color .14s;
}
.ov-more:hover { color:var(--ink3); }

/* ══ Buoy FAB ══ */
.buoy {
  position:fixed;bottom:34px;right:28px;
  width:52px;height:52px;border-radius:50%;
  background:var(--glass);
  backdrop-filter:blur(24px) saturate(1.8);
  -webkit-backdrop-filter:blur(24px) saturate(1.8);
  border:1px solid var(--glass-bd);
  color:var(--accent);cursor:pointer;
  display:flex;align-items:center;justify-content:center;
  z-index:100;
  box-shadow:0 4px 20px rgba(100,130,220,.14),0 0 0 1px rgba(255,255,255,.18) inset;
  animation:buoyBob 3s ease-in-out infinite;
  transition:background .2s,transform .15s;
}
.buoy:hover {
  animation:none;
  background:var(--accent);color:#fff;
  transform:scale(1.1);
  box-shadow:0 8px 28px rgba(100,130,220,.3);
}
.buoy:active { animation:none;transform:scale(.94); }

/* ══ Sheet — frosted glass ══ */
.sveil {
  position:fixed;inset:0;
  background:rgba(8,16,30,.36);
  backdrop-filter:blur(18px) saturate(1.4);
  -webkit-backdrop-filter:blur(18px) saturate(1.4);
  z-index:200;display:flex;align-items:flex-end;justify-content:center;
  animation:fadeIn .15s;
}
.sglass {
  background:var(--glass);
  backdrop-filter:blur(36px) saturate(2);
  -webkit-backdrop-filter:blur(36px) saturate(2);
  border:1px solid var(--glass-bd);border-bottom:none;
  border-radius:30px 30px 0 0;
  padding:22px 28px 54px;
  width:100%;max-width:430px;
  box-shadow:0 -4px 36px rgba(8,18,40,.10);
  animation:riseUp .25s cubic-bezier(.16,1,.3,1);
}
.spull { width:30px;height:3px;background:var(--fog-bd);border-radius:99px;margin:0 auto 22px; }
.swhisper {
  font-size:12px;color:var(--ink3);font-weight:300;
  text-align:center;margin-bottom:22px;
  letter-spacing:.03em;line-height:1.8;font-style:italic;
}
.sfield {
  width:100%;border:none;border-bottom:1px solid var(--fog-bd);
  background:transparent;padding:12px 0;
  font-family:inherit;font-size:21px;font-weight:300;font-style:italic;
  color:var(--ink);outline:none;transition:border-color .14s;line-height:1.4;
}
.sfield:focus { border-color:var(--accent); }
.sfield::placeholder { color:var(--ink4);font-weight:300; }

.sintents { display:flex;gap:8px;margin-top:22px; }
.sint {
  flex:1;padding:9px 4px;border-radius:99px;
  border:1px solid var(--fog-bd);background:none;
  font-family:inherit;font-size:12px;font-weight:400;
  color:var(--ink3);cursor:pointer;text-align:center;transition:all .15s;
}
.sint:hover { background:var(--fog);color:var(--ink2); }
.sint.on { background:var(--accent);border-color:var(--accent);color:#fff; }
.sint-now.on   { box-shadow:0 3px 12px rgba(110,142,216,.3); }
.sint-shelf.on { background:transparent;border-color:var(--ink4);color:var(--ink4);opacity:.55; }

.sdrop {
  width:100%;margin-top:24px;padding:14px;
  background:var(--accent);color:#fff;border:none;
  border-radius:18px;font-family:inherit;
  font-size:15px;font-weight:500;cursor:pointer;
  transition:background .13s;
  box-shadow:0 4px 18px rgba(110,142,216,.28);
}
.sdrop:hover { background:var(--accent-d); }
.sdrop:active { transform:scale(.99); }

/* ══ User menu ══ */
.umenu {
  position:absolute;top:36px;right:0;
  background:var(--glass);
  backdrop-filter:blur(28px) saturate(1.8);
  -webkit-backdrop-filter:blur(28px) saturate(1.8);
  border:1px solid var(--glass-bd);border-radius:18px;
  box-shadow:0 8px 32px rgba(8,18,40,.12);
  padding:14px;min-width:200px;z-index:300;
  animation:fadeIn .13s;
}
.u-email  { font-size:11.5px;color:var(--ink3);padding-bottom:10px;border-bottom:1px solid var(--fog-bd);margin-bottom:10px;font-weight:300; }
.u-themes { display:flex;gap:4px;margin-bottom:10px; }
.uth { flex:1;padding:8px;border:1px solid var(--fog-bd);background:var(--fog);border-radius:10px;cursor:pointer;font-size:15px;transition:all .13s; }
.uth.on { border-color:var(--accent);background:var(--accent-s); }
.uth:hover:not(.on) { background:var(--glass-str); }
.u-out { width:100%;padding:8px;border:none;background:none;font-family:inherit;font-size:13px;color:var(--ink3);cursor:pointer;border-radius:10px;text-align:left;transition:all .12s; }
.u-out:hover { background:var(--fog);color:var(--ink2); }

/* ══ Login ocean ══ */
.login-ocean {
  min-height:100vh;position:relative;
  display:flex;align-items:center;justify-content:center;
  padding:32px 24px;overflow:hidden;
  background:var(--bg);
}
.l-orb { position:absolute;border-radius:50%;pointer-events:none;filter:blur(80px); }
.l-orb1 { width:440px;height:440px;top:-110px;left:-110px; background:var(--orb1);animation:o1 22s ease-in-out infinite; }
.l-orb2 { width:340px;height:340px;bottom:-70px;right:-90px;background:var(--orb2);animation:o2 28s ease-in-out infinite; }
.l-orb3 { width:280px;height:280px;top:30%;left:15%;       background:var(--orb3);animation:o3 19s ease-in-out infinite; }

.login-glass {
  position:relative;z-index:10;
  background:var(--glass);
  backdrop-filter:blur(36px) saturate(2);
  -webkit-backdrop-filter:blur(36px) saturate(2);
  border:1px solid var(--glass-bd);
  border-radius:36px;padding:50px 34px;
  width:100%;max-width:360px;
  box-shadow:0 18px 64px rgba(8,18,40,.10),0 0 0 1px rgba(255,255,255,.28) inset;
}

/* Logo on login */
.login-logo { display:flex;flex-direction:column;align-items:center;gap:14px;margin-bottom:8px; }
.logo-sphere {
  width:60px;height:60px;border-radius:50%;
  background:radial-gradient(circle at 36% 32%, rgba(215,200,245,.95), rgba(160,195,235,.70) 55%, rgba(175,225,242,.50));
  box-shadow:0 4px 28px rgba(140,165,235,.38),0 0 0 1px rgba(255,255,255,.38) inset;
  animation:sphereFl 5s ease-in-out infinite;
}
.logo-text { font-size:17px;font-weight:500;letter-spacing:.28em; }
.lt-a { color:var(--ink2); }
.lt-b { color:var(--accent); }

.login-tag {
  font-size:13px;color:var(--ink3);font-weight:300;
  font-style:italic;line-height:1.9;
  margin-bottom:28px;text-align:center;letter-spacing:.01em;
}
.login-tabs { display:flex;gap:3px;background:rgba(255,255,255,.28);border-radius:12px;padding:3px;margin-bottom:22px; }
.ltab { flex:1;padding:8px;border:none;background:none;font-family:inherit;font-size:13px;font-weight:400;color:var(--ink3);cursor:pointer;border-radius:10px;transition:all .15s; }
.ltab.on { background:var(--glass-str);color:var(--ink); }
.lmsg { font-size:12.5px;padding:9px 13px;border-radius:12px;margin-bottom:13px;border:1px solid transparent;line-height:1.5; }
.lmsg.err { background:rgba(210,90,90,.10);color:#B05050;border-color:rgba(210,90,90,.25); }
.lmsg.ok  { background:rgba(70,175,110,.10);color:#38905A;border-color:rgba(70,175,110,.25); }
.linput {
  display:block;width:100%;
  border:none;border-bottom:1px solid var(--fog-bd);
  background:transparent;padding:11px 0;margin-bottom:15px;
  font-family:inherit;font-size:14px;color:var(--ink);outline:none;
  transition:border-color .14s;
}
.linput:focus { border-color:var(--accent); }
.linput::placeholder { color:var(--ink4); }
.lbtn {
  width:100%;padding:13px;margin-top:6px;
  background:var(--accent);color:#fff;border:none;
  border-radius:18px;font-family:inherit;
  font-size:15px;font-weight:500;cursor:pointer;
  transition:background .13s;
  box-shadow:0 4px 18px rgba(110,142,216,.28);
}
.lbtn:hover { background:var(--accent-d); }
.lbtn:disabled { opacity:.5;cursor:not-allowed; }
.ldemo { font-size:11px;color:var(--ink4);text-align:center;margin-top:14px;font-weight:300;letter-spacing:.04em; }

/* ══ Spinner ══ */
.tide-spin { width:20px;height:20px;border-radius:50%;border:1.5px solid var(--fog-bd);border-top-color:var(--accent);animation:tideSpin .9s linear infinite; }

/* ══ Scroll ══ */
html { scroll-behavior:smooth; }
::-webkit-scrollbar { width:0;height:0; }
* { scrollbar-width:none; }
`;

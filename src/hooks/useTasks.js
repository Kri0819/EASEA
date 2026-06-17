import { useState, useEffect, useCallback } from 'react';

// These are defined in App.jsx scope — passed as deps to keep hook portable.
// In a real multi-file project, move tasksDB / makeSeed / rollover / uid / IS_MOCK
// into their own modules and import them here directly.

/**
 * useTasks
 *
 * Owns: tasks state, local-cache persistence, remote fetch/upsert/delete.
 * Returns: { tasks, synced, push, del, mutate, setTasks, handlers }
 *
 * @param {object} params
 * @param {string}  params.userId
 * @param {string}  params.token
 * @param {object}  params.tasksDB   - { getLocal, setLocal, fetchAll, upsert, remove }
 * @param {function} params.makeSeed
 * @param {function} params.rollover
 * @param {function} params.uid
 * @param {boolean}  params.isMock
 * @param {object}  params.IntentMachine
 */
export function useTasks({ userId, token, tasksDB, makeSeed, rollover, uid, isMock, IntentMachine }) {
  const [tasks,  setTasks]  = useState(() => tasksDB.getLocal(userId) || makeSeed());
  const [synced, setSynced] = useState(isMock);

  // ── Remote fetch on mount ────────────────────────────────────────
  useEffect(() => {
    if (isMock || !userId || !token) return;
    tasksDB.fetchAll(userId, token)
      .then(remote => {
        const m = rollover(remote);
        setTasks(m);
        tasksDB.setLocal(userId, m);
        setSynced(true);
      })
      .catch(() => setSynced(true));
  }, [userId, token]); // eslint-disable-line

  // ── Persist to local cache on every change ───────────────────────
  useEffect(() => {
    if (userId) tasksDB.setLocal(userId, tasks);
  }, [tasks, userId]); // eslint-disable-line

  // ── Remote push helpers ──────────────────────────────────────────
  const push = useCallback(task => {
    if (isMock || !userId || !token) return;
    tasksDB.upsert(task, userId, token).catch(() => {});
  }, [userId, token]); // eslint-disable-line

  const del = useCallback(id => {
    if (isMock || !userId || !token) return;
    tasksDB.remove(id, token).catch(() => {});
  }, [userId, token]); // eslint-disable-line

  // ── Generic optimistic mutate ────────────────────────────────────
  const mutate = useCallback((id, fn) => {
    let changed;
    setTasks(ts => ts.map(t => t.id === id ? (changed = { ...fn(t) }) : t));
    if (changed) push(changed);
  }, [push]);

  // ── Task handlers ────────────────────────────────────────────────
  const onToggleDone = useCallback(
    id => mutate(id, t => ({ ...t, status: t.status === 'done' ? 'active' : 'done' })),
    [mutate]
  );

  const onMarkProgress = useCallback(
    id => mutate(id, t => ({ ...t, progress_today: true, last_progress_at: Date.now() })),
    [mutate]
  );

  const onShiftIntent = useCallback((id, action) => {
    let changed;
    setTasks(ts => ts.map(t => {
      if (t.id !== id) return t;
      const cur  = t.intent_state || 'LATER';
      const next = action === 'promote'
        ? IntentMachine[cur]?.promote
        : IntentMachine[cur]?.demote;
      return (changed = { ...t, intent_state: next || cur, intent_meta: { ...t.intent_meta, last_touch: Date.now() } });
    }));
    if (changed) push(changed);
  }, [push, IntentMachine]);

  const onToggleStep = useCallback((tid, sid) => {
    let changed;
    setTasks(ts => ts.map(t => {
      if (t.id !== tid) return t;
      const steps = t.steps.map(s => s.id === sid ? { ...s, is_completed: !s.is_completed } : s);
      // Never auto-complete the task — only the main checkbox can do that
      return (changed = { ...t, steps });
    }));
    if (changed) push(changed);
  }, [push]);

  const onAddStep = useCallback((tid, title) => {
    let changed;
    setTasks(ts => ts.map(t =>
      t.id === tid ? (changed = { ...t, steps: [...t.steps, { id: uid(), title, is_completed: false }] }) : t
    ));
    if (changed) push(changed);
  }, [push, uid]);

  const onDelete = useCallback(id => {
    setTasks(ts => ts.filter(t => t.id !== id));
    del(id);
  }, [del]);

  const onAdd = useCallback(task => {
    setTasks(ts => [...ts, task]);
    push(task);
  }, [push]);

  return {
    tasks,
    synced,
    setTasks,
    onAdd,
    handlers: {
      onToggleDone,
      onMarkProgress,
      onShiftIntent,
      onToggleStep,
      onAddStep,
      onDelete,
    },
  };
}

import { useState, useCallback } from 'react';

const DISSOLVE_MS = 620;

/**
 * useTaskAnimation
 *
 * Owns the "leaving" Set that drives the dissolve animation.
 * Wraps onToggleDone to start the animation before the state update.
 *
 * @param {Array}    tasks        - current task list
 * @param {function} onToggleDone - raw toggle from useTasks
 * @returns {{ leaving: Set, handleDone: function }}
 */
export function useTaskAnimation(tasks, onToggleDone) {
  const [leaving, setLeaving] = useState(new Set());

  const handleDone = useCallback(id => {
    const task = tasks.find(tk => tk.id === id);

    if (task && task.status !== 'done') {
      // Start dissolve animation first, then commit state
      setLeaving(s => new Set([...s, id]));
      setTimeout(() => {
        onToggleDone(id);
        setLeaving(s => {
          const ns = new Set(s);
          ns.delete(id);
          return ns;
        });
      }, DISSOLVE_MS);
    } else {
      // Undoing done — no animation needed
      onToggleDone(id);
    }
  }, [tasks, onToggleDone]);

  return { leaving, handleDone };
}

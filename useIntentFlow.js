import { useMemo } from 'react';

const SURFACE_LIMIT = 3;

/**
 * useIntentFlow
 *
 * Derives today's task stream from the full task list.
 * Returns: { surface, rest, greet, sub }
 *
 * @param {Array}  tasks    - full task list
 * @param {string} today    - todayStr()
 * @param {function} flowScore - scoring function (task) => number
 */
export function useIntentFlow(tasks, today, flowScore) {
  const stream = useMemo(() =>
    tasks
      .filter(tk => tk.status !== 'done' && (tk.due_date === today || tk.auto_shifted))
      .sort((a, b) => flowScore(b) - flowScore(a)),
    [tasks, today, flowScore]
  );

  const surface = stream.slice(0, SURFACE_LIMIT);
  const rest    = stream.slice(SURFACE_LIMIT);

  const hr    = new Date().getHours();
  const greet = hr < 5  ? '深夜了。'
              : hr < 12 ? '早安。'
              : hr < 18 ? '午安。'
              :            '晚安。';

  const sub = stream.length === 0 ? '今天很輕。'
            : stream.length === 1 ? '一件一件就好。'
            : stream.length <= 3  ? '慢慢來。'
            :                       '做不完沒關係。';

  return { surface, rest, greet, sub, streamLength: stream.length };
}

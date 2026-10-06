import { dayKey, dayLabel, formatDuration, timeOfDay } from '../lib/format';
import type { WorkoutRecord } from '../lib/storage';
import { ActivityStrip } from './ActivityStrip';

interface Props {
  history: WorkoutRecord[];
  best: WorkoutRecord | null;
  onBack: () => void;
  onClear: () => void;
  onOpenActivity: () => void;
}

export function HistoryScreen({ history, best, onBack, onClear, onOpenActivity }: Props) {
  // Group consecutive records (already newest-first) by calendar day.
  const groups: Array<{ key: string; label: string; total: number; items: WorkoutRecord[] }> = [];
  for (const r of history) {
    const key = dayKey(r.date);
    let g = groups[groups.length - 1];
    if (!g || g.key !== key) {
      g = { key, label: dayLabel(r.date), total: 0, items: [] };
      groups.push(g);
    }
    g.items.push(r);
    g.total += r.reps;
  }

  return (
    <main className="screen history">
      <header className="history-head">
        <button className="icon-btn" onClick={onBack} aria-label="Back">
          <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
            <path d="M12.5 4L6.5 10l6 6" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <h1>History</h1>
        <span className="icon-btn-spacer" />
      </header>

      {best && (
        <div className="pb-line">
          <span className="eyebrow">Personal best</span>
          <span className="pb-value">
            {best.reps} <small>reps · {dayLabel(best.date)}</small>
          </span>
        </div>
      )}

      {history.length > 0 && <ActivityStrip history={history} onOpen={onOpenActivity} />}

      {groups.length === 0 ? (
        <p className="empty">No workouts yet. Your sets will show up here.</p>
      ) : (
        <div className="history-list">
          {groups.map((g) => (
            <section key={g.key}>
              <h2>
                <span>{g.label}</span>
                {g.items.length > 1 && <span className="day-total">{g.total} total</span>}
              </h2>
              <ul>
                {g.items.map((r) => (
                  <li key={r.id}>
                    <span className="h-reps">
                      {r.reps}
                      <small>reps</small>
                    </span>
                    <span className="h-meta">
                      <span>{formatDuration(r.durationMs)}</span>
                      {r.avgDepth !== null && <span>{r.avgDepth}% depth</span>}
                    </span>
                    <span className="h-time">{timeOfDay(r.date)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {history.length > 0 && (
        <button
          className="text-btn danger clear-btn"
          onClick={() => {
            if (confirm('Delete all workout history on this device?')) onClear();
          }}
        >
          Clear history
        </button>
      )}
    </main>
  );
}

import { useMemo, useRef, useState } from 'react';
import {
  activityStats,
  buildWeeks,
  dailyTotals,
  localDayKey,
  maxDailyReps,
  parseDayKey,
  type GraphDay,
} from '../lib/activity';
import type { WorkoutRecord } from '../lib/storage';
import { ActivityGraph, ActivityLegend, dayTitle, useElementWidth } from './ActivityGraph';

interface Props {
  history: WorkoutRecord[];
  onBack: () => void;
}

const GAP = 3;
/** A full year (53 weeks of 12px cells) fits side-by-side from about this width. */
const HORIZONTAL_MIN_WIDTH = 860;

/** Full history: one graph per year, newest first. */
export function ActivityScreen({ history, onBack }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const width = useElementWidth(ref);
  const today = useMemo(() => new Date(), []);

  const totals = useMemo(() => dailyTotals(history), [history]);
  const stats = useMemo(() => activityStats(totals, today), [totals, today]);
  const max = maxDailyReps(totals);

  const years = useMemo(() => {
    const thisYear = today.getFullYear();
    let first = thisYear;
    for (const key of totals.keys()) first = Math.min(first, parseDayKey(key).getFullYear());
    const out: number[] = [];
    for (let y = thisYear; y >= first; y--) out.push(y);
    return out;
  }, [totals, today]);

  const horizontal = width >= HORIZONTAL_MIN_WIDTH;
  // Vertical (phones): 7 columns + a month-label column, cells sized to fill the width.
  const cell = horizontal ? 12 : Math.max(14, Math.min(30, Math.floor((width - 40 - 7 * GAP) / 7)));

  const todayKey = localDayKey(today);
  const [selected, setSelected] = useState<{ key: string; date: Date; reps: number; sets: number }>(() => {
    const t = totals.get(todayKey);
    return { key: todayKey, date: today, reps: t?.reps ?? 0, sets: t?.sets ?? 0 };
  });
  const select = (d: GraphDay) => setSelected({ key: d.key, date: d.date, reps: d.reps, sets: d.sets });

  return (
    <main className="screen activity">
      <header className="history-head">
        <button className="icon-btn" onClick={onBack} aria-label="Back">
          <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
            <path d="M12.5 4L6.5 10l6 6" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <h1>Activity</h1>
        <span className="icon-btn-spacer" />
      </header>

      <dl className="ag-stats">
        <div>
          <dt>Total</dt>
          <dd>{stats.totalReps.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Active days</dt>
          <dd>{stats.activeDays}</dd>
        </div>
        <div>
          <dt>Streak</dt>
          <dd>
            {stats.currentStreak}
            <small>{stats.currentStreak === 1 ? 'day' : 'days'}</small>
          </dd>
        </div>
        <div>
          <dt>Best day</dt>
          <dd>{stats.bestDay ? stats.bestDay.reps : '–'}</dd>
        </div>
      </dl>

      <div className="ag-legend-row">
        <span className="ag-caption">
          Longest streak <strong>{stats.longestStreak}</strong> {stats.longestStreak === 1 ? 'day' : 'days'}
        </span>
        <ActivityLegend />
      </div>

      <div ref={ref} className="ag-years">
        {width > 0 &&
          years.map((year) => {
            const weeks = buildWeeks(
              new Date(year, 0, 1),
              year === today.getFullYear() ? today : new Date(year, 11, 31),
              totals,
              max,
            );
            const yearReps = weeks.flat().reduce((s, d) => s + (d.inRange ? d.reps : 0), 0);
            return (
              <section key={year} className="ag-year">
                <h2>
                  <span>{year}</span>
                  <span className="day-total">{yearReps.toLocaleString()} push-ups</span>
                </h2>
                <div className={horizontal ? 'ag-scroll' : undefined}>
                  <ActivityGraph
                    weeks={weeks}
                    orientation={horizontal ? 'horizontal' : 'vertical'}
                    cell={cell}
                    gap={GAP}
                    selectedKey={selected.key}
                    onSelect={select}
                  />
                </div>
              </section>
            );
          })}
        {history.length === 0 && <p className="empty">Finish a set and your first square lights up.</p>}
      </div>

      <div className="ag-detail" aria-live="polite">
        <span>{selected.key === todayKey ? 'Today' : dayTitle(selected.date)}</span>
        <span>
          <strong>{selected.reps}</strong> push-ups
          {selected.sets > 0 && <> · {selected.sets} {selected.sets === 1 ? 'set' : 'sets'}</>}
        </span>
      </div>
    </main>
  );
}

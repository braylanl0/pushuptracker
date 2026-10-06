import { useMemo, useRef, useState } from 'react';
import { addDays, buildWeeks, dailyTotals, maxDailyReps, startOfWeek, type GraphDay } from '../lib/activity';
import type { WorkoutRecord } from '../lib/storage';
import { ActivityGraph, ActivityLegend, dayTitle, useElementWidth } from './ActivityGraph';

const CELL = 12;
const GAP = 3;
const DAY_LABEL_WIDTH = 30;

/** Compact graph for the History screen: as many recent weeks as fit the width. */
export function ActivityStrip({ history, onOpen }: { history: WorkoutRecord[]; onOpen: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const width = useElementWidth(ref);
  const [selected, setSelected] = useState<GraphDay | null>(null);

  const totals = useMemo(() => dailyTotals(history), [history]);
  const weekCount = width > 0 ? Math.max(8, Math.floor((width - DAY_LABEL_WIDTH + GAP) / (CELL + GAP))) : 0;
  // Stretch cells slightly so the newest week lines up with the right edge.
  const cell = weekCount > 0 ? Math.max(CELL, (width - DAY_LABEL_WIDTH - (weekCount - 1) * GAP) / weekCount) : CELL;
  const weeks = useMemo(() => {
    if (weekCount === 0) return [];
    const today = new Date();
    return buildWeeks(addDays(startOfWeek(today), -(weekCount - 1) * 7), today, totals, maxDailyReps(totals));
  }, [weekCount, totals]);
  const periodReps = weeks.flat().reduce((sum, d) => sum + d.reps, 0);

  return (
    <section className="activity-strip">
      <div className="section-head">
        <span className="eyebrow">Activity</span>
        <button className="text-btn" onClick={onOpen}>
          Full graph
        </button>
      </div>
      <div ref={ref} className="ag-fit">
        {weeks.length > 0 && (
          <ActivityGraph
            weeks={weeks}
            orientation="horizontal"
            cell={Math.floor(cell * 10) / 10}
            gap={GAP}
            selectedKey={selected?.key ?? null}
            onSelect={(d) => setSelected((s) => (s?.key === d.key ? null : d))}
          />
        )}
      </div>
      <div className="ag-foot">
        <span className="ag-caption">
          {selected ? (
            <>
              {dayTitle(selected.date)} · <strong>{selected.reps}</strong> push-ups
            </>
          ) : (
            <>
              <strong>{periodReps}</strong> push-ups in {weekCount} weeks
            </>
          )}
        </span>
        <ActivityLegend />
      </div>
    </section>
  );
}

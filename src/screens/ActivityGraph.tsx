import { useEffect, useState, type CSSProperties, type RefObject } from 'react';
import type { GraphDay } from '../lib/activity';

interface Props {
  weeks: GraphDay[][];
  /**
   * horizontal: weeks are columns (GitHub style), oldest → newest left to right.
   * vertical: weeks are rows, newest at the top. Fits phones without sideways scrolling.
   */
  orientation: 'horizontal' | 'vertical';
  cell: number;
  gap?: number;
  selectedKey: string | null;
  onSelect: (day: GraphDay) => void;
}

const DAY_LABELS_SHORT = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const DAY_LABELS_H = ['Mon', '', 'Wed', '', 'Fri', '', ''];

export function ActivityGraph({ weeks, orientation, cell, gap = 3, selectedKey, onSelect }: Props) {
  const style = { '--cell': `${cell}px`, '--gap': `${gap}px` } as CSSProperties;
  const renderCell = (day: GraphDay) =>
    day.inRange ? (
      <button
        key={day.key}
        type="button"
        className={`ag-cell ${day.key === selectedKey ? 'is-selected' : ''}`}
        data-level={day.level}
        aria-label={`${dayTitle(day.date)}: ${day.reps} push-ups`}
        title={`${dayTitle(day.date)} · ${day.reps} push-ups`}
        onClick={() => onSelect(day)}
      />
    ) : (
      <span key={day.key} className="ag-cell is-pad" aria-hidden="true" />
    );

  if (orientation === 'vertical') {
    // Newest week first; label a row when its month changes.
    const rows = [...weeks].reverse();
    let prevMonth = -1;
    return (
      <div className="ag ag-v" style={style}>
        <div className="ag-v-row ag-v-head" aria-hidden="true">
          <span />
          {DAY_LABELS_SHORT.map((d, i) => (
            <span key={i} className="ag-daylabel">
              {d}
            </span>
          ))}
        </div>
        {rows.map((week) => {
          const latest = [...week].reverse().find((d) => d.inRange) ?? week[6];
          const month = latest.date.getMonth();
          const label = month !== prevMonth ? monthName(latest.date) : '';
          prevMonth = month;
          return (
            <div key={week[0].key} className="ag-v-row">
              <span className="ag-monthlabel">{label}</span>
              {week.map(renderCell)}
            </div>
          );
        })}
      </div>
    );
  }

  // Horizontal: month labels above the column where each month starts.
  const monthLabels: Array<{ col: number; text: string }> = [];
  let prevMonth = -1;
  weeks.forEach((week, col) => {
    const first = week.find((d) => d.inRange) ?? week[0];
    const month = first.date.getMonth();
    if (month !== prevMonth) {
      const last = monthLabels[monthLabels.length - 1];
      // Skip a label that would collide with the previous one (e.g. a 1-week partial month).
      if (!last || col - last.col >= 3) monthLabels.push({ col, text: monthName(first.date) });
      else if (last.col === 0 && col <= 2) monthLabels[monthLabels.length - 1] = { col, text: monthName(first.date) };
      prevMonth = month;
    }
  });

  return (
    <div className="ag ag-h" style={style}>
      <div className="ag-h-months" aria-hidden="true" style={{ gridTemplateColumns: `repeat(${weeks.length}, var(--cell))` }}>
        {monthLabels.map((m) => (
          <span key={m.col} className="ag-monthlabel" style={{ gridColumn: `${m.col + 1} / span 3` }}>
            {m.text}
          </span>
        ))}
      </div>
      <div className="ag-h-body">
        <div className="ag-h-days" aria-hidden="true">
          {DAY_LABELS_H.map((d, i) => (
            <span key={i} className="ag-daylabel">
              {d}
            </span>
          ))}
        </div>
        <div className="ag-h-grid">{weeks.flat().map(renderCell)}</div>
      </div>
    </div>
  );
}

export function ActivityLegend() {
  return (
    <div className="ag-legend" aria-hidden="true">
      <span>Less</span>
      {[0, 1, 2, 3, 4].map((l) => (
        <span key={l} className="ag-cell" data-level={l} />
      ))}
      <span>More</span>
    </div>
  );
}

/** Width of an element, kept up to date with a ResizeObserver. */
export function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

export function dayTitle(date: Date): string {
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function monthName(date: Date): string {
  return date.toLocaleDateString(undefined, { month: 'short' });
}

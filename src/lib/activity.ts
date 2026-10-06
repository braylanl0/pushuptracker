/**
 * Daily activity for the contribution-style graph. Pure date logic, no DOM.
 *
 * All dates are local calendar days. Date arithmetic goes through
 * `new Date(y, m, d + n)` so daylight-saving changes never skip or repeat a day.
 */
import type { WorkoutRecord } from './storage';

export interface DayActivity {
  reps: number;
  sets: number;
}

export type Level = 0 | 1 | 2 | 3 | 4;

export interface GraphDay {
  key: string;
  date: Date;
  reps: number;
  sets: number;
  level: Level;
  /** False for padding days outside the requested range (before the start / after today). */
  inRange: boolean;
}

/** Weeks start on Monday. */
const WEEK_START = 1;

export function localDayKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

export function startOfWeek(d: Date): Date {
  const offset = (d.getDay() - WEEK_START + 7) % 7;
  return addDays(d, -offset);
}

export function dailyTotals(history: readonly WorkoutRecord[]): Map<string, DayActivity> {
  const totals = new Map<string, DayActivity>();
  for (const r of history) {
    if (r.reps <= 0) continue;
    const key = localDayKey(new Date(r.date));
    const day = totals.get(key) ?? { reps: 0, sets: 0 };
    day.reps += r.reps;
    day.sets += 1;
    totals.set(key, day);
  }
  return totals;
}

/**
 * Intensity 0–4, relative to your biggest day: 1 = up to a quarter of it,
 * 4 = more than three quarters. Any activity is at least level 1.
 */
export function intensityLevel(reps: number, maxReps: number): Level {
  if (reps <= 0 || maxReps <= 0) return 0;
  return Math.min(4, Math.max(1, Math.ceil((reps / maxReps) * 4))) as Level;
}

/**
 * Weeks (Monday → Sunday) covering `start`..`end` inclusive. Days outside the
 * range are still present (so every week has 7 days) but marked `inRange: false`.
 */
export function buildWeeks(
  start: Date,
  end: Date,
  totals: Map<string, DayActivity>,
  maxReps: number,
): GraphDay[][] {
  const first = startOfDay(start).getTime();
  const last = startOfDay(end).getTime();
  const weeks: GraphDay[][] = [];
  let cursor = startOfWeek(startOfDay(start));
  while (cursor.getTime() <= last) {
    const week: GraphDay[] = [];
    for (let i = 0; i < 7; i++) {
      const date = addDays(cursor, i);
      const key = localDayKey(date);
      const t = date.getTime();
      const day = totals.get(key);
      week.push({
        key,
        date,
        reps: day?.reps ?? 0,
        sets: day?.sets ?? 0,
        level: intensityLevel(day?.reps ?? 0, maxReps),
        inRange: t >= first && t <= last,
      });
    }
    weeks.push(week);
    cursor = addDays(cursor, 7);
  }
  return weeks;
}

export interface ActivityStats {
  totalReps: number;
  activeDays: number;
  /** Consecutive active days ending today (or yesterday, if today has no sets yet). */
  currentStreak: number;
  longestStreak: number;
  bestDay: { key: string; reps: number } | null;
}

export function activityStats(totals: Map<string, DayActivity>, today = new Date()): ActivityStats {
  let totalReps = 0;
  let bestDay: ActivityStats['bestDay'] = null;
  for (const [key, d] of totals) {
    totalReps += d.reps;
    if (!bestDay || d.reps > bestDay.reps) bestDay = { key, reps: d.reps };
  }

  // Longest run of consecutive days.
  const keys = new Set(totals.keys());
  let longestStreak = 0;
  for (const key of keys) {
    const date = parseDayKey(key);
    if (keys.has(localDayKey(addDays(date, -1)))) continue; // not the start of a run
    let len = 1;
    while (keys.has(localDayKey(addDays(date, len)))) len++;
    longestStreak = Math.max(longestStreak, len);
  }

  // Current streak: today counts if active; otherwise the run ending yesterday is still alive.
  let cursor = startOfDay(today);
  if (!keys.has(localDayKey(cursor))) cursor = addDays(cursor, -1);
  let currentStreak = 0;
  while (keys.has(localDayKey(cursor))) {
    currentStreak++;
    cursor = addDays(cursor, -1);
  }

  return { totalReps, activeDays: totals.size, currentStreak, longestStreak, bestDay };
}

export function parseDayKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function maxDailyReps(totals: Map<string, DayActivity>): number {
  let max = 0;
  for (const d of totals.values()) max = Math.max(max, d.reps);
  return max;
}

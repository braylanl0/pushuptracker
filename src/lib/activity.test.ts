import { describe, expect, it } from 'vitest';
import {
  activityStats,
  addDays,
  buildWeeks,
  dailyTotals,
  intensityLevel,
  localDayKey,
  maxDailyReps,
  startOfWeek,
} from './activity';
import type { WorkoutRecord } from './storage';

const rec = (date: Date, reps: number): WorkoutRecord => ({
  id: `${date.getTime()}-${reps}`,
  date: date.toISOString(),
  reps,
  durationMs: 30_000,
  avgDepth: 90,
  bestDepth: 100,
});

describe('activity', () => {
  it('sums sets per local day and skips empty sets', () => {
    const totals = dailyTotals([
      rec(new Date(2026, 9, 6, 8, 0), 10),
      rec(new Date(2026, 9, 6, 21, 30), 15),
      rec(new Date(2026, 9, 5, 12, 0), 12),
      rec(new Date(2026, 9, 4, 12, 0), 0),
    ]);
    expect(totals.get('2026-10-06')).toEqual({ reps: 25, sets: 2 });
    expect(totals.get('2026-10-05')).toEqual({ reps: 12, sets: 1 });
    expect(totals.has('2026-10-04')).toBe(false);
    expect(maxDailyReps(totals)).toBe(25);
  });

  it('maps reps to 5 intensity levels relative to the best day', () => {
    expect(intensityLevel(0, 40)).toBe(0);
    expect(intensityLevel(1, 40)).toBe(1);
    expect(intensityLevel(10, 40)).toBe(1);
    expect(intensityLevel(11, 40)).toBe(2);
    expect(intensityLevel(25, 40)).toBe(3);
    expect(intensityLevel(40, 40)).toBe(4);
    expect(intensityLevel(5, 0)).toBe(0);
  });

  it('starts weeks on Monday', () => {
    expect(localDayKey(startOfWeek(new Date(2026, 9, 6)))).toBe('2026-10-05'); // Tue → Mon
    expect(localDayKey(startOfWeek(new Date(2026, 9, 11)))).toBe('2026-10-05'); // Sun → Mon
    expect(localDayKey(startOfWeek(new Date(2026, 9, 5)))).toBe('2026-10-05');
  });

  it('builds full 7-day weeks and flags padding days', () => {
    const totals = dailyTotals([rec(new Date(2026, 9, 6, 9), 20)]);
    const weeks = buildWeeks(new Date(2026, 8, 30), new Date(2026, 9, 6), totals, 20);
    expect(weeks).toHaveLength(2);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(weeks[0][0].key).toBe('2026-09-28');
    expect(weeks[0][1].inRange).toBe(false); // Sep 29, before start
    expect(weeks[0][2].inRange).toBe(true); // Sep 30
    const today = weeks[1][1];
    expect(today.key).toBe('2026-10-06');
    expect(today).toMatchObject({ reps: 20, sets: 1, level: 4, inRange: true });
    expect(weeks[1][2].inRange).toBe(false); // tomorrow
  });

  it('never skips or repeats days across daylight-saving changes', () => {
    const weeks = buildWeeks(new Date(2026, 0, 1), new Date(2026, 11, 31), new Map(), 0);
    const keys = weeks.flat().map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(weeks.flat().filter((d) => d.inRange)).toHaveLength(365);
    for (let i = 1; i < keys.length; i++) {
      expect(localDayKey(addDays(weeks.flat()[i - 1].date, 1))).toBe(keys[i]);
    }
  });

  it('computes totals, streaks and best day', () => {
    const today = new Date(2026, 9, 6, 18);
    const totals = dailyTotals([
      rec(new Date(2026, 9, 1, 9), 10),
      rec(new Date(2026, 9, 2, 9), 10),
      rec(new Date(2026, 9, 3, 9), 30),
      // gap on the 4th
      rec(new Date(2026, 9, 5, 9), 12),
      rec(new Date(2026, 9, 6, 9), 8),
    ]);
    expect(activityStats(totals, today)).toEqual({
      totalReps: 70,
      activeDays: 5,
      currentStreak: 2,
      longestStreak: 3,
      bestDay: { key: '2026-10-03', reps: 30 },
    });
  });

  it("keeps yesterday's streak alive before today's first set", () => {
    const totals = dailyTotals([rec(new Date(2026, 9, 4, 9), 5), rec(new Date(2026, 9, 5, 9), 5)]);
    expect(activityStats(totals, new Date(2026, 9, 6, 7)).currentStreak).toBe(2);
    expect(activityStats(totals, new Date(2026, 9, 7, 7)).currentStreak).toBe(0);
  });
});

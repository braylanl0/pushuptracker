import { describe, expect, it } from 'vitest';
import { dayLabel, formatClock, formatDuration } from './format';
import {
  loadHistory,
  loadPrefs,
  personalBest,
  saveWorkout,
  savePrefs,
  summarizeDepths,
  type KeyValueStore,
  type WorkoutRecord,
} from './storage';

function memoryStore(initial: Record<string, string> = {}): KeyValueStore {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const rec = (id: string, date: string, reps: number): WorkoutRecord => ({
  id,
  date,
  reps,
  durationMs: 60_000,
  avgDepth: 90,
  bestDepth: 100,
});

describe('storage', () => {
  it('saves and loads history newest-first', () => {
    const s = memoryStore();
    saveWorkout(rec('a', '2026-01-01T10:00:00Z', 10), s);
    saveWorkout(rec('b', '2026-01-02T10:00:00Z', 12), s);
    expect(loadHistory(s).map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('survives corrupt or unexpected data', () => {
    expect(loadHistory(memoryStore({ 'pushup.history.v1': '{not json' }))).toEqual([]);
    expect(loadHistory(memoryStore({ 'pushup.history.v1': '{"a":1}' }))).toEqual([]);
    const mixed = JSON.stringify([rec('a', '2026-01-01T10:00:00Z', 3), { junk: true }]);
    expect(loadHistory(memoryStore({ 'pushup.history.v1': mixed }))).toHaveLength(1);
  });

  it('works with no storage at all', () => {
    expect(loadHistory(null)).toEqual([]);
    expect(() => saveWorkout(rec('a', '2026-01-01T10:00:00Z', 3), null)).not.toThrow();
    expect(loadPrefs(null).facingMode).toBe('user');
  });

  it('finds the personal best', () => {
    expect(personalBest([])).toBeNull();
    const h = [rec('a', '2026-01-01', 10), rec('b', '2026-01-02', 24), rec('c', '2026-01-03', 18)];
    expect(personalBest(h)?.reps).toBe(24);
  });

  it('persists preferences', () => {
    const s = memoryStore();
    savePrefs({ facingMode: 'environment' }, s);
    expect(loadPrefs(s).facingMode).toBe('environment');
  });

  it('summarizes rep depths', () => {
    expect(summarizeDepths([])).toEqual({ avgDepth: null, bestDepth: null });
    expect(summarizeDepths([80, 100, 90])).toEqual({ avgDepth: 90, bestDepth: 100 });
  });
});

describe('format', () => {
  it('formats durations', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(64_000)).toBe('1:04');
    expect(formatClock(42_000)).toBe('00:42');
    expect(formatClock(725_000)).toBe('12:05');
  });

  it('labels days relative to now', () => {
    const now = new Date(2026, 9, 6, 15, 0);
    expect(dayLabel(new Date(2026, 9, 6, 8, 0).toISOString(), now)).toBe('Today');
    expect(dayLabel(new Date(2026, 9, 5, 23, 0).toISOString(), now)).toBe('Yesterday');
  });
});

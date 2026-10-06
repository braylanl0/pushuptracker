/**
 * Workout history and preferences, stored in localStorage.
 * Every read is defensive: storage can be unavailable (private mode) or hold
 * corrupt data, and the app must still work without it.
 */

export interface WorkoutRecord {
  id: string;
  /** ISO timestamp of when the set ended. */
  date: string;
  reps: number;
  durationMs: number;
  /** Mean peak depth across reps (0–100), null if no reps. */
  avgDepth: number | null;
  /** Deepest rep (0–100), null if no reps. */
  bestDepth: number | null;
}

export interface Preferences {
  facingMode: 'user' | 'environment';
}

const HISTORY_KEY = 'pushup.history.v1';
const PREFS_KEY = 'pushup.prefs.v1';
const MAX_RECORDS = 500;

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStore(): KeyValueStore | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

function readJson<T>(store: KeyValueStore | null, key: string): T | null {
  if (!store) return null;
  try {
    const raw = store.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(store: KeyValueStore | null, key: string, value: unknown): void {
  if (!store) return;
  try {
    store.setItem(key, JSON.stringify(value));
  } catch {
    // Quota exceeded / storage disabled: silently skip, the workout still happened.
  }
}

function isRecord(r: unknown): r is WorkoutRecord {
  if (!r || typeof r !== 'object') return false;
  const o = r as Record<string, unknown>;
  return typeof o.id === 'string' && typeof o.date === 'string' && typeof o.reps === 'number' && typeof o.durationMs === 'number';
}

/** Newest first. */
export function loadHistory(store = defaultStore()): WorkoutRecord[] {
  const data = readJson<unknown>(store, HISTORY_KEY);
  if (!Array.isArray(data)) return [];
  return data.filter(isRecord).sort((a, b) => b.date.localeCompare(a.date));
}

export function saveWorkout(record: WorkoutRecord, store = defaultStore()): WorkoutRecord[] {
  const next = [record, ...loadHistory(store).filter((r) => r.id !== record.id)].slice(0, MAX_RECORDS);
  writeJson(store, HISTORY_KEY, next);
  return next;
}

export function clearHistory(store = defaultStore()): void {
  try {
    store?.removeItem(HISTORY_KEY);
  } catch {
    /* ignore */
  }
}

export function personalBest(history: WorkoutRecord[]): WorkoutRecord | null {
  let best: WorkoutRecord | null = null;
  for (const r of history) if (r.reps > 0 && (!best || r.reps > best.reps)) best = r;
  return best;
}

export function loadPrefs(store = defaultStore()): Preferences {
  const p = readJson<Partial<Preferences>>(store, PREFS_KEY);
  return { facingMode: p?.facingMode === 'environment' ? 'environment' : 'user' };
}

export function savePrefs(prefs: Preferences, store = defaultStore()): void {
  writeJson(store, PREFS_KEY, prefs);
}

export function summarizeDepths(repDepths: number[]): { avgDepth: number | null; bestDepth: number | null } {
  if (repDepths.length === 0) return { avgDepth: null, bestDepth: null };
  const sum = repDepths.reduce((a, b) => a + b, 0);
  return { avgDepth: Math.round(sum / repDepths.length), bestDepth: Math.max(...repDepths) };
}

export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

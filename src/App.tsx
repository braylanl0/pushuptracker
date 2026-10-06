import { useMemo, useState } from 'react';
import { HomeScreen } from './screens/HomeScreen';
import { ResultsScreen, type ResultsData } from './screens/ResultsScreen';
import { HistoryScreen } from './screens/HistoryScreen';
import { WorkoutScreen, type SetResult } from './workout/WorkoutScreen';
import {
  clearHistory,
  loadHistory,
  newId,
  personalBest,
  saveWorkout,
  summarizeDepths,
  type WorkoutRecord,
} from './lib/storage';

type Screen = 'home' | 'workout' | 'results' | 'history';

export function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [history, setHistory] = useState<WorkoutRecord[]>(() => loadHistory());
  const [result, setResult] = useState<ResultsData | null>(null);
  const best = useMemo(() => personalBest(history), [history]);

  const finishSet = ({ reps, durationMs, repDepths }: SetResult) => {
    const depths = summarizeDepths(repDepths);
    const isNewBest = reps > 0 && reps > (best?.reps ?? 0);
    if (reps > 0) {
      setHistory(
        saveWorkout({ id: newId(), date: new Date().toISOString(), reps, durationMs, ...depths }),
      );
    }
    setResult({ reps, durationMs, ...depths, isNewBest });
    setScreen('results');
  };

  switch (screen) {
    case 'workout':
      return (
        <WorkoutScreen bestReps={best?.reps ?? null} onFinish={finishSet} onCancel={() => setScreen('home')} />
      );
    case 'results':
      return result ? <ResultsScreen result={result} onDone={() => setScreen('home')} /> : null;
    case 'history':
      return (
        <HistoryScreen
          history={history}
          best={best}
          onBack={() => setScreen('home')}
          onClear={() => {
            clearHistory();
            setHistory([]);
          }}
        />
      );
    default:
      return (
        <HomeScreen
          best={best}
          last={history[0] ?? null}
          onStart={() => setScreen('workout')}
          onHistory={() => setScreen('history')}
        />
      );
  }
}

import { formatDuration } from '../lib/format';

export interface ResultsData {
  reps: number;
  durationMs: number;
  avgDepth: number | null;
  bestDepth: number | null;
  isNewBest: boolean;
}

interface Props {
  result: ResultsData;
  onDone: () => void;
}

export function ResultsScreen({ result, onDone }: Props) {
  const none = result.reps === 0;
  return (
    <main className="screen results">
      <div className="results-head">
        <div className="eyebrow">Set complete</div>
        {result.isNewBest && <div className="tag">New best</div>}
      </div>

      <div className="results-hero">
        <div className="results-num">{result.reps}</div>
        <div className="results-label">{result.reps === 1 ? 'Push-up' : 'Push-ups'}</div>
        {none && <p className="results-note">No reps were counted, so this set wasn't saved.</p>}
      </div>

      <dl className="stat-grid">
        <div>
          <dt>Time</dt>
          <dd>{formatDuration(result.durationMs)}</dd>
        </div>
        <div>
          <dt>Avg depth</dt>
          <dd>{result.avgDepth === null ? '–' : `${result.avgDepth}%`}</dd>
        </div>
        <div>
          <dt>Best rep</dt>
          <dd>{result.bestDepth === null ? '–' : `${result.bestDepth}%`}</dd>
        </div>
      </dl>

      <button className="btn btn-primary btn-xl" onClick={onDone}>
        Done
      </button>
    </main>
  );
}

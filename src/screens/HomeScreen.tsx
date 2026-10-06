import type { WorkoutRecord } from '../lib/storage';
import { dayLabel } from '../lib/format';

interface Props {
  best: WorkoutRecord | null;
  last: WorkoutRecord | null;
  onStart: () => void;
  onHistory: () => void;
}

export function HomeScreen({ best, last, onStart, onHistory }: Props) {
  return (
    <main className="screen home">
      <header className="home-head">
        <div className="wordmark">PUSH</div>
        {last && (
          <button className="text-btn" onClick={onHistory}>
            History
          </button>
        )}
      </header>

      <div className="home-hero">
        <PlankFigure />
        <h1>Camera push-up counter</h1>
        <p>Prop up your phone so your full body is visible from the side.</p>
      </div>

      {(best || last) && (
        <dl className="stat-row">
          <div>
            <dt>Personal best</dt>
            <dd>{best ? best.reps : '–'}</dd>
          </div>
          <div>
            <dt>Last workout</dt>
            <dd>
              {last ? last.reps : '–'}
              {last && <span className="stat-sub">{dayLabel(last.date)}</span>}
            </dd>
          </div>
        </dl>
      )}

      <div className="home-actions">
        <button className="btn btn-primary btn-xl" onClick={onStart}>
          Start workout
        </button>
        <p className="privacy">
          <LockIcon /> Camera processing stays on your device.
        </p>
      </div>
    </main>
  );
}

/** Side-view push-up figure drawn in the same style as the live tracking overlay. */
function PlankFigure() {
  return (
    <svg className="plank-figure" viewBox="0 0 320 120" aria-hidden="true">
      <line x1="10" y1="104" x2="310" y2="104" className="pf-floor" />
      <g className="pf-body">
        <polyline points="78,40 92,72 86,102" />
        <polyline points="78,40 170,58 236,82 290,98" />
      </g>
      <path d="M 92 72 m -2.5 -16.8 A 17 17 0 0 1 108.2 76.6" className="pf-arc" />
      <circle cx="58" cy="34" r="11" className="pf-head" />
      {[
        [78, 40],
        [92, 72],
        [86, 102],
        [170, 58],
        [236, 82],
        [290, 98],
      ].map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="4.5" className="pf-joint" />
      ))}
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="12" height="14" viewBox="0 0 12 14" aria-hidden="true">
      <rect x="1" y="6" width="10" height="7" rx="1.5" fill="currentColor" />
      <path d="M3.5 6V4.5a2.5 2.5 0 0 1 5 0V6" stroke="currentColor" strokeWidth="1.5" fill="none" />
    </svg>
  );
}

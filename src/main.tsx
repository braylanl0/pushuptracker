import { createRoot } from 'react-dom/client';
import '@fontsource/barlow-condensed/latin-500.css';
import '@fontsource/barlow-condensed/latin-600.css';
import '@fontsource/barlow-condensed/latin-800.css';
import './styles.css';
import { App } from './App';

// No <StrictMode>: its double-mounted effects would open the camera and load
// the pose model twice on every start in dev. Effect cleanup is still complete.
createRoot(document.getElementById('root')!).render(<App />);

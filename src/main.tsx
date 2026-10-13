import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('index.html has no #root element');
}

// Deliberately no <StrictMode>: it double-mounts effects in development, which
// would build the YouTube player twice.
createRoot(container).render(<App />);

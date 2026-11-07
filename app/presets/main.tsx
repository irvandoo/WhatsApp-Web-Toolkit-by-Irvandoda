import { createRoot } from 'react-dom/client';
import '../shared/ui/theme.css';
import { App } from './App';
import './presets.css';

createRoot(document.getElementById('root')!).render(<App />);

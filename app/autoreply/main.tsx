import { createRoot } from 'react-dom/client';
import '../shared/ui/theme.css';
import { App } from './App';
import './autoreply.css';

createRoot(document.getElementById('root')!).render(<App />);

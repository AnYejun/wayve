import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './router.tsx';
import '@fontsource/cal-sans/latin-400.css';
import './design/wayve.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

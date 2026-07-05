import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

// Inside the desktop shell the window is frameless (macOS traffic lights
// only) — the stylesheet pads the top strip and adds drag regions.
if (/electron/i.test(navigator.userAgent)) {
  document.documentElement.classList.add('electron');
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { applyPalette } from './lib/palette';
import { embedded } from './lib/embedded';
import './styles.css';

if (embedded) {
  document.documentElement.classList.add('embedded');
}

// Clear any leftover palette-lab override so the saved [data-theme] wins.
applyPalette(null);

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

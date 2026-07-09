import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { applyPalette } from './lib/palette';
import './styles.css';

// Clear any leftover palette-lab override so the saved [data-theme] wins.
applyPalette(null);

// UX Lens capture overlay (⌥⇧U) — dev builds only, stripped from prod.
if (import.meta.env.DEV) {
  void import('./uxlens/overlay').then((m) => m.installUxLens());
}

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

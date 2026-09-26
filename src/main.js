import './ui/styles.css';
import { App } from './core/App.js';

/**
 * Entry point: boots the application shell.
 */
const app = new App({
  canvas: document.getElementById('game'),
  ui: document.getElementById('ui'),
});

app.init().catch((err) => {
  console.error(err);
  const boot = document.getElementById('boot');
  if (boot) boot.textContent = `Failed to start: ${err.message}`;
});

// Exposed for debugging and automated end-to-end tests.
window.__app = app;

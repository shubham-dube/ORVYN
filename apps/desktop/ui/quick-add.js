// Quick add (spec 0002 M5): Enter saves through the tray app (same parser and sync as every device), Esc closes.
(() => {
  const { invoke } = window.__TAURI__.core;
  const { listen } = window.__TAURI__.event;
  const input = document.getElementById('text');
  const status = document.getElementById('status');
  const hint = status.textContent;
  let busy = false;

  // follow the system light/dark until the window learns the person's phase
  const dark = window.matchMedia('(prefers-color-scheme: dark)');
  const phase = () => document.documentElement.setAttribute('data-phase', dark.matches ? 'night' : 'day');
  phase();
  dark.addEventListener('change', phase);

  const say = (text, tone) => {
    status.textContent = text;
    status.className = tone || '';
  };
  const reset = () => {
    input.value = '';
    say(hint);
    input.focus();
  };

  listen('quick-add:open', reset);

  document.getElementById('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy || !input.value.trim()) return;
    busy = true;
    say('Adding…');
    try {
      const title = await invoke('quick_add', { text: input.value });
      say(title, 'ok');
      input.value = '';
      setTimeout(() => invoke('quick_add_hide'), 900);
    } catch (err) {
      say(String(err), 'error');
    } finally {
      busy = false;
    }
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') invoke('quick_add_hide');
  });
})();

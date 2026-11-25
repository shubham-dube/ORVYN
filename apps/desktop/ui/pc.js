// This PC from my phone (spec 0021 step 3): the only place where the terminal is switched on and devices are paired.
(() => {
  const { invoke } = window.__TAURI__.core;
  const { listen } = window.__TAURI__.event;
  const $ = (id) => document.getElementById(id);
  let state = null;
  let code = '';

  const dark = window.matchMedia('(prefers-color-scheme: dark)');
  const phase = () => document.documentElement.setAttribute('data-phase', dark.matches ? 'night' : 'day');
  phase();
  dark.addEventListener('change', phase);

  const say = (text, tone) => {
    $('status').textContent = text;
    $('status').className = tone || '';
  };
  const ago = (ms) => (ms ? new Date(ms).toLocaleString() : 'not used yet');

  const hideCode = () => {
    code = '';
    $('qr').replaceChildren();
    $('code').hidden = true;
  };

  async function draw() {
    state = await invoke('pc_state');
    $('locked').hidden = !state.locked;
    $('pin-label').textContent = state.pin
      ? 'Change the PIN (ends open sessions)'
      : 'Choose a PIN (6 characters or more)';
    $('switch').textContent = state.on ? 'Switch off' : 'Switch on';
    $('switch').disabled = !state.pin && !state.on;
    $('switch-text').textContent = state.on
      ? 'On: paired devices can open a terminal with the PIN.'
      : 'Off: nobody can. Switching off also closes open terminals.';
    $('pair').disabled = !state.on;
    $('end').hidden = !state.sessions;
    $('log').textContent = state.log.join('\n') || 'Nothing yet';
    $('devices').replaceChildren(
      ...state.pairs.map((p) => {
        const li = document.createElement('li');
        const text = document.createElement('span');
        text.textContent = p.name || 'Waiting for a device';
        const small = document.createElement('small');
        small.textContent = `Last used: ${ago(p.last)}`;
        text.append(small);
        const b = document.createElement('button');
        b.textContent = 'Remove';
        b.setAttribute('aria-label', `Remove ${p.name || 'the waiting device'}`);
        b.addEventListener('click', () => run('pc_remove', { id: p.id }, 'Removed'));
        li.append(text, b);
        return li;
      }),
    );
    if (code && !state.pairs.some((p) => !p.last)) {
      hideCode();
      say('Paired', 'ok');
    }
  }

  async function run(cmd, args, done) {
    try {
      const r = await invoke(cmd, args);
      say(done || '', 'ok');
      await draw();
      return r;
    } catch (e) {
      say(String(e), 'error');
      return undefined;
    }
  }

  $('pin-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pin = $('pin').value;
    $('pin').value = '';
    await run('pc_set_pin', { pin }, 'PIN saved');
  });
  $('switch').addEventListener('click', () => run('pc_set_on', { on: !state.on }));
  $('unlock').addEventListener('click', () => run('pc_unlock', {}, 'Unlocked'));
  $('end').addEventListener('click', () => run('pc_end', {}, 'Ended'));
  $('hide').addEventListener('click', hideCode);
  $('copy').addEventListener('click', () =>
    navigator.clipboard.writeText(code).then(
      () => say('Copied. Paste it on the other device, then clear your clipboard.', 'ok'),
      () => say('Couldn’t copy', 'error'),
    ),
  );
  $('pair').addEventListener('click', async () => {
    const c = await run('pc_pair');
    if (!c) return;
    code = c.text;
    const svg = new DOMParser().parseFromString(c.svg, 'image/svg+xml').documentElement;
    $('qr').replaceChildren(svg);
    $('code').hidden = false;
  });

  listen('pc:changed', draw);
  draw().catch((e) => say(String(e), 'error'));
})();

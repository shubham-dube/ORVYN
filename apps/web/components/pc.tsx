'use client';

import '@xterm/xterm/css/xterm.css';
import { type PcPairing, readPairing } from '@orvyn/vault-crypto';
import type { FitAddon } from '@xterm/addon-fit';
import type { Terminal } from '@xterm/xterm';
import { Monitor, Plus, X } from 'lucide-react';
import { type FormEvent, type MutableRefObject, useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Empty, Glass, useToast } from '@/components/ui/bits';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { cn } from '@/lib/cn';
import { forgetPairing, pairings, PcLink, type PcStatus, savePairing } from '@/lib/pc';
import { realtime } from '@/lib/realtime';
import { useSession } from '@/lib/session';

/** My PC (spec 0021 step 3): a real terminal on the PC, from here. */
export function MyPc() {
  const { me } = useSession();
  const toast = useToast();
  const [pcs, setPcs] = useState<PcPairing[] | null>(null);
  const [at, setAt] = useState<PcPairing | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const user = me?.id ?? '';

  const load = useCallback(async () => {
    try {
      setPcs(await pairings(user));
    } catch {
      setPcs([]);
      setError('This browser doesn’t allow ORVYN to keep the key (a private window?).');
    }
  }, [user]);

  const add = useCallback(
    async (code: string) => {
      const p = await readPairing(code);
      if (!p)
        return setError('That isn’t a pairing code. On the PC: ORVYN tray icon → This PC from my phone.');
      try {
        await savePairing(user, p);
      } catch {
        return setError('This browser couldn’t keep the key.');
      }
      setText('');
      setError(null);
      await load();
      setAt(p);
    },
    [load, user],
  );

  useEffect(() => {
    if (!user) return;
    const code = window.location.hash.slice(1);
    // out of the address bar and the history at once
    if (code) window.history.replaceState(null, '', window.location.pathname);
    void load().then(() => (code ? add(code) : undefined));
  }, [user, load, add]);

  if (at)
    return (
      <PcTerminal
        key={at.id}
        pair={at}
        onLeave={() => setAt(null)}
        onForget={async () => {
          await forgetPairing(at.id);
          setAt(null);
          await load();
          toast({ title: `${at.name} is forgotten here`, body: 'Remove this device on the PC too.' });
        }}
      />
    );

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <h1 className="text-title">My PC</h1>
      {pcs?.length === 0 ? (
        <Empty title="Your PC, from here">
          On the PC: ORVYN tray icon → This PC from my phone. Choose a PIN, switch it on, add a device.
        </Empty>
      ) : null}
      {pcs?.map((p) => (
        <button
          key={p.id}
          onClick={() => setAt(p)}
          className="glass-pane flex items-center gap-3 p-4 text-left"
        >
          <Monitor size={20} aria-hidden className="text-orv-accent" />
          <span className="flex-1 font-semibold">{p.name}</span>
          <span className="text-small text-orv-muted">Open</span>
        </button>
      ))}
      <Glass className="p-4">
        <form
          className="flex flex-col gap-3"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            void add(text.trim());
          }}
        >
          <Field
            label="Add a PC"
            error={error}
            hint="Scan the code with this phone’s camera, or paste its text. The key stays in this browser."
          >
            {(id) => (
              <Input
                id={id}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="ORVYN-PC1.…"
                autoComplete="off"
                spellCheck={false}
              />
            )}
          </Field>
          <Button type="submit" variant="primary" disabled={!text.trim()} className="self-start">
            Pair
          </Button>
        </form>
      </Glass>
    </div>
  );
}

const WORDS: Record<PcStatus, string> = {
  finding: 'Looking for the PC…',
  offline: 'The PC isn’t answering. It may be off, asleep or offline, or this device was removed there.',
  off: 'The terminal is switched off on the PC.',
  locked: 'Locked after five wrong PINs. Unlock it at the PC.',
  pin: 'Enter the PIN you chose on the PC.',
  open: 'Connected',
  idle: 'Ended after 15 minutes without you. Your terminals are still running.',
  removed: 'This device was removed at the PC.',
  ended: 'The session has ended. Your terminals may still be running.',
};

interface Screen {
  write(text: string, reset: boolean): void;
  type(text: string): void;
  focus(): void;
}

function PcTerminal({ pair, onLeave, onForget }: { pair: PcPairing; onLeave(): void; onForget(): void }) {
  const toast = useToast();
  const link = useRef<PcLink | null>(null);
  const screens = useRef(new Map<string, Screen>());
  const [, redraw] = useState(0);
  const [active, setActive] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const ctrl = useRef(false);
  const [ctrlOn, setCtrlOn] = useState(false);
  const say = useRef(toast);
  say.current = toast;

  useEffect(() => {
    if (!realtime) return;
    const l = new PcLink(
      pair,
      realtime,
      {
        changed: () => redraw((n) => n + 1),
        output: (id, text, reset) => screens.current.get(id)?.write(text, reset),
        opened: (id) => setActive(id),
        problem: (t) => say.current({ title: t, tone: 'danger' }),
      },
      deviceName(),
    );
    link.current = l;
    void l.connect();
    return () => l.stop();
  }, [pair]);

  const l = link.current;
  const status = l?.status ?? 'finding';
  const terms = l?.terms ?? [];
  const shown = terms.some((t) => t.id === active) ? active : (terms[0]?.id ?? null);
  const waiting = status === 'finding' && shown !== null;
  const open = status === 'open' || waiting;

  const setCtrl = (v: boolean) => {
    ctrl.current = v;
    setCtrlOn(v);
  };
  const key = (seq: string) => {
    const s = shown && screens.current.get(shown);
    if (!s) return;
    s.type(seq);
    s.focus();
  };

  return (
    <div className="flex h-[calc(100dvh-9.5rem)] min-h-80 flex-col gap-3 lg:h-[calc(100dvh-40px)]">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" onClick={onLeave}>
          Back
        </Button>
        <h1 className="text-heading min-w-0 flex-1 truncate">{pair.name}</h1>
        <Badge tone={status === 'open' ? 'success' : 'neutral'}>
          {status === 'open' ? 'Live · encrypted' : waiting ? 'Reconnecting…' : 'Not connected'}
        </Badge>
      </div>

      {open ? (
        <>
          <div role="tablist" aria-label="Terminals" className="flex gap-2 overflow-x-auto pb-1">
            {terms.map((t, i) => (
              <span
                key={t.id}
                className={cn(
                  'flex shrink-0 items-center rounded-orv-md border border-orv-edge',
                  t.id === shown ? 'bg-orv-track' : '',
                )}
              >
                <button
                  role="tab"
                  aria-selected={t.id === shown}
                  className="h-9 pl-3 pr-1 text-[13px]"
                  onClick={() => setActive(t.id)}
                >
                  {i + 1} · {t.name}
                  {t.exit !== null ? ` (ended ${t.exit})` : ''}
                </button>
                <button
                  aria-label={`Close terminal ${i + 1}`}
                  className="grid h-9 w-8 place-items-center text-orv-muted hover:text-orv-text"
                  onClick={() => {
                    if (t.exit !== null || window.confirm('Close this terminal? What runs in it stops.'))
                      l?.close(t.id);
                  }}
                >
                  <X size={14} aria-hidden />
                </button>
              </span>
            ))}
            {(l?.shells ?? []).map((s) => (
              <Button key={s.id} size="sm" variant="ghost" onClick={() => l?.open(s.id, 80, 24)}>
                <Plus size={14} aria-hidden /> {s.name}
              </Button>
            ))}
          </div>
          <div className="relative min-h-0 flex-1 overflow-hidden rounded-orv-md border border-orv-edge bg-orv-base">
            {terms.map((t) => (
              <TermScreen
                key={t.id}
                id={t.id}
                shown={t.id === shown}
                link={l!}
                screens={screens}
                ctrl={ctrl}
                onCtrl={setCtrl}
              />
            ))}
            {terms.length === 0 ? <p className="p-4 text-small text-orv-muted">Open a shell above.</p> : null}
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-1" aria-label="Keys">
            <Key label="Ctrl" pressed={ctrlOn} onPress={() => setCtrl(!ctrl.current)} />
            {KEYS.map(([label, seq]) => (
              <Key key={label} label={label} onPress={() => key(seq)} />
            ))}
            <Key
              label="Paste"
              onPress={() =>
                void navigator.clipboard
                  .readText()
                  .then(key, () => toast({ title: 'The browser didn’t allow pasting', tone: 'danger' }))
              }
            />
          </div>
        </>
      ) : (
        <Glass className="flex flex-col gap-3 p-5">
          <p role="status">{WORDS[status]}</p>
          {status === 'pin' ? (
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                l?.enterPin(pin);
                setPin('');
              }}
            >
              <Field
                label="PIN"
                error={
                  l?.left != null ? `Wrong PIN. ${l.left} ${l.left === 1 ? 'try' : 'tries'} left.` : null
                }
              >
                {(id) => (
                  <Input
                    id={id}
                    type="password"
                    value={pin}
                    onChange={(e) => setPin(e.target.value)}
                    autoComplete="off"
                    autoFocus
                  />
                )}
              </Field>
              <Button type="submit" variant="primary" disabled={!pin} className="self-start">
                Open
              </Button>
            </form>
          ) : status !== 'finding' ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => void l?.connect()}>
                Try again
              </Button>
              <Button variant="danger" onClick={onForget}>
                Forget this PC here
              </Button>
            </div>
          ) : null}
        </Glass>
      )}
    </div>
  );
}

const KEYS: [string, string][] = [
  ['Esc', '\x1b'],
  ['Tab', '\t'],
  ['Ctrl C', '\x03'],
  ['↑', '\x1b[A'],
  ['↓', '\x1b[B'],
  ['←', '\x1b[D'],
  ['→', '\x1b[C'],
  ['Enter', '\r'],
  ['|', '|'],
  ['\\', '\\'],
  ['~', '~'],
  ['Home', '\x1b[H'],
  ['End', '\x1b[F'],
  ['PgUp', '\x1b[5~'],
  ['PgDn', '\x1b[6~'],
];

function Key({ label, onPress, pressed }: { label: string; onPress(): void; pressed?: boolean }) {
  return (
    <button
      aria-pressed={pressed}
      // keeps the phone's keyboard open
      onPointerDown={(e) => e.preventDefault()}
      onClick={onPress}
      className={cn(
        'h-10 min-w-11 shrink-0 rounded-orv-sm border border-orv-edge px-3 font-mono text-[13px]',
        pressed ? 'bg-orv-accent text-white' : 'bg-orv-track',
      )}
    >
      {label}
    </button>
  );
}

function TermScreen({
  id,
  shown,
  link,
  screens,
  ctrl,
  onCtrl,
}: {
  id: string;
  shown: boolean;
  link: PcLink;
  screens: MutableRefObject<Map<string, Screen>>;
  ctrl: MutableRefObject<boolean>;
  onCtrl(v: boolean): void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const live = useRef<{ term: Terminal; fit: FitAddon } | null>(null);
  const visible = useRef(shown);
  visible.current = shown;
  const release = useRef(onCtrl);
  release.current = onCtrl;

  useEffect(() => {
    let gone = false;
    let undo = () => {};
    const map = screens.current;
    void (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
      ]);
      if (gone || !box.current) return;
      const css = getComputedStyle(box.current);
      const v = (n: string) => css.getPropertyValue(n).trim();
      const term = new Terminal({
        fontFamily: v('--orv-font-mono') || 'monospace',
        fontSize: 13,
        cursorBlink: true,
        scrollback: 5000,
        minimumContrastRatio: 4.5,
        theme: {
          background: v('--orv-base'),
          foreground: v('--orv-text'),
          cursor: v('--orv-accent'),
          selectionBackground: v('--orv-track'),
        },
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(box.current);
      live.current = { term, fit };
      const type = (text: string) => {
        link.type(id, text);
      };
      term.onData((d) => {
        if (ctrl.current && d.length === 1 && /[a-z@[\\\]^_]/i.test(d)) {
          release.current(false);
          type(String.fromCharCode(d.toUpperCase().charCodeAt(0) & 31));
        } else type(d);
      });
      term.onResize(({ cols, rows }) => link.resize(id, cols, rows));
      map.set(id, {
        write: (text, reset) => {
          if (reset) term.reset();
          term.write(text);
        },
        type,
        focus: () => term.focus(),
      });
      if (visible.current) {
        fit.fit();
        term.focus();
      }
      link.attach(id, term.cols, term.rows);
      const watch = new ResizeObserver(() => {
        if (visible.current) fit.fit();
      });
      watch.observe(box.current);
      undo = () => {
        watch.disconnect();
        map.delete(id);
        link.detach(id);
        term.dispose();
        live.current = null;
      };
    })();
    return () => {
      gone = true;
      undo();
    };
  }, [id, link, screens, ctrl]);

  useEffect(() => {
    if (!shown || !live.current) return;
    live.current.fit.fit();
    live.current.term.focus();
  }, [shown]);

  return <div ref={box} className={cn('absolute inset-1.5', shown ? '' : 'invisible')} data-term={id} />;
}

function deviceName(): string {
  const ua = navigator.userAgent;
  const os = /Android/.test(ua)
    ? 'Android'
    : /iPhone|iPad/.test(ua)
      ? 'iPhone'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac/.test(ua)
          ? 'Mac'
          : 'Linux';
  const b = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox/.test(ua)
      ? 'Firefox'
      : /Chrome/.test(ua)
        ? 'Chrome'
        : 'Safari';
  return `${b} on ${os}`;
}

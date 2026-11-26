'use client';

import {
  ArrowDownToLine,
  ChevronRight,
  ClipboardCopy,
  ClipboardPaste,
  ExternalLink,
  File,
  FileArchive,
  FileCode,
  FileImage,
  FileMusic,
  FileText,
  FileVideo,
  Folder,
  FolderUp,
  HardDrive,
  Keyboard,
  Lock,
  Maximize,
  Monitor,
  Moon,
  MousePointer2,
  Play,
  Search,
  Square,
  Upload,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Glass, Segmented, useToast } from '@/components/ui/bits';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { cn } from '@/lib/cn';
import type { PcDeck, PcEntry, PcFiles, PcLink } from '@/lib/pc';

const size = (n: number) =>
  n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`;
const when = (ms?: number | null) => {
  if (!ms) return '';
  const d = new Date(ms);
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString([], { day: 'numeric', month: 'short', year: '2-digit' });
};

type Part = 'screen' | 'files' | 'controls';

/** The PC without the terminal (spec 0021 #11): its screen live, its files, and the small things. */
export function PcDeckPanel({ link, deck }: { link: PcLink; deck: PcDeck }) {
  const [part, setPart] = useState<Part>('screen');
  useArrivals(deck, useToast());
  // nothing streams unseen
  useEffect(() => () => link.live(false), [link]);
  useEffect(() => {
    if (part !== 'screen' && deck.live) link.live(false);
  }, [part, deck.live, link]);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="self-start">
        <Segmented
          label="Part of the deck"
          value={part}
          onChange={(v: string) => setPart(v as Part)}
          options={[
            { value: 'screen', label: 'Screen' },
            { value: 'files', label: 'Files' },
            { value: 'controls', label: 'Controls' },
          ]}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {part === 'screen' ? <Screen link={link} deck={deck} /> : null}
        {part === 'files' ? <Files link={link} deck={deck} /> : null}
        {part === 'controls' ? <Controls link={link} deck={deck} /> : null}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ screen

const KEYS: [string, string][] = [
  ['Enter', 'enter'],
  ['Esc', 'esc'],
  ['Tab', 'tab'],
  ['⌫', 'backspace'],
  ['Del', 'delete'],
  ['↑', 'up'],
  ['↓', 'down'],
  ['←', 'left'],
  ['→', 'right'],
  ['Win', 'win'],
  ['Alt+Tab', 'alt+tab'],
  ['Ctrl+C', 'ctrl+c'],
  ['Ctrl+V', 'ctrl+v'],
  ['Ctrl+Z', 'ctrl+z'],
  ['Ctrl+S', 'ctrl+s'],
  ['Win+D', 'win+d'],
];
/** keys of a real keyboard, held over the picture, sent as Windows knows them */
const NAMED: Record<string, string> = {
  Enter: 'enter',
  Escape: 'esc',
  Tab: 'tab',
  Backspace: 'backspace',
  Delete: 'delete',
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Home: 'home',
  End: 'end',
  PageUp: 'pageup',
  PageDown: 'pagedown',
};

function Screen({ link, deck }: { link: PcLink; deck: PcDeck }) {
  const toast = useToast();
  const [sharp, setSharp] = useState(true);
  const [control, setControl] = useState(true);
  const [text, setText] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const href = useObjectUrl(deck.screen);
  const press = useRef<{ x: number; y: number; at: number; dragging: boolean; timer?: number } | null>(null);
  const lastTap = useRef(0);

  const at = (e: { clientX: number; clientY: number }) => {
    const r = img.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  };
  const down = (e: PointerEvent<HTMLImageElement>) => {
    if (!control || e.button > 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = {
      x: e.clientX,
      y: e.clientY,
      at: Date.now(),
      dragging: false,
      timer: undefined as number | undefined,
    };
    // held still: a right click
    p.timer = window.setTimeout(() => {
      if (press.current === p && !p.dragging) {
        link.input({ k: 'click', ...at(e), right: true });
        press.current = null;
      }
    }, 550);
    press.current = p;
  };
  const move = (e: PointerEvent<HTMLImageElement>) => {
    const p = press.current;
    if (!p) return;
    if (!p.dragging && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 8) {
      p.dragging = true;
      clearTimeout(p.timer);
      link.input({ k: 'down', ...at({ clientX: p.x, clientY: p.y }) });
    }
    if (p.dragging) link.input({ k: 'move', ...at(e) });
  };
  const up = (e: PointerEvent<HTMLImageElement>) => {
    const p = press.current;
    press.current = null;
    if (!p) return;
    clearTimeout(p.timer);
    if (p.dragging) return link.input({ k: 'up', ...at(e) });
    const now = Date.now();
    const double = now - lastTap.current < 350;
    lastTap.current = double ? 0 : now;
    link.input({ k: 'click', ...at(e), double });
  };
  const keyed = (e: KeyboardEvent) => {
    if (!control || !deck.live) return;
    const mods = [
      e.ctrlKey && 'ctrl',
      e.altKey && 'alt',
      e.shiftKey && NAMED[e.key] && 'shift',
      e.metaKey && 'win',
    ]
      .filter(Boolean)
      .join('+');
    const named = NAMED[e.key] ?? (e.key.length === 1 && (e.ctrlKey || e.altKey || e.metaKey) ? e.key : null);
    if (named) link.input({ k: 'key', key: mods ? `${mods}+${named}` : named });
    else if (e.key.length === 1) link.input({ k: 'text', text: e.key });
    else return;
    e.preventDefault();
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {deck.live ? (
          <Button size="sm" variant="danger" onClick={() => link.live(false)}>
            <Square size={14} aria-hidden /> Stop
          </Button>
        ) : (
          <Button size="sm" variant="primary" onClick={() => link.live(true, sharp)}>
            <Play size={14} aria-hidden /> Show the screen live
          </Button>
        )}
        <Button
          size="sm"
          aria-pressed={control}
          onClick={() => setControl(!control)}
          title="Taps click on the PC; hold for a right click; drag to drag"
        >
          <MousePointer2 size={14} aria-hidden /> {control ? 'Control on' : 'Only look'}
        </Button>
        <Button
          size="sm"
          onClick={() => {
            setSharp(!sharp);
            if (deck.live) link.live(true, !sharp);
          }}
        >
          {sharp ? 'Sharp' : 'Fast'}
        </Button>
        <Button size="sm" aria-label="Full screen" onClick={() => void box.current?.requestFullscreen?.()}>
          <Maximize size={14} aria-hidden />
        </Button>
      </div>
      <div
        ref={box}
        tabIndex={0}
        onKeyDown={keyed}
        aria-label="The PC’s screen. With control on, taps and keys go to the PC."
        className="relative flex min-h-48 items-center justify-center overflow-auto rounded-orv-md border border-orv-edge bg-orv-base outline-none focus-visible:ring-2 focus-visible:ring-orv-accent"
      >
        {href ? (
          <img
            ref={img}
            src={href}
            alt="The PC’s screen, live"
            draggable={false}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            onPointerCancel={() => (press.current = null)}
            onContextMenu={(e) => {
              e.preventDefault();
              if (control) link.input({ k: 'click', ...at(e), right: true });
            }}
            onWheel={(e) => control && link.input({ k: 'scroll', ...at(e), dy: Math.round(e.deltaY) })}
            className={cn(
              'block max-h-[75dvh] w-full select-none object-contain',
              control && 'cursor-crosshair touch-none',
            )}
          />
        ) : (
          <p className="flex items-center gap-2 p-8 text-small text-orv-muted">
            <Monitor size={16} aria-hidden />
            {deck.live ? 'Waiting for the first picture…' : 'Start it to see the PC as it is now.'}
          </p>
        )}
      </div>
      {deck.live && control ? (
        <Glass className="flex flex-col gap-2 p-3">
          <form
            className="flex gap-2"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              if (!text) return;
              link.input({ k: 'text', text });
              setText('');
            }}
          >
            <Input
              aria-label="Type on the PC"
              placeholder="Type on the PC"
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={2000}
            />
            <Button type="submit" disabled={!text}>
              <Keyboard size={14} aria-hidden /> Type
            </Button>
          </form>
          <div className="flex flex-wrap gap-1.5" aria-label="Keys">
            {KEYS.map(([label, key]) => (
              <button
                key={key}
                onClick={() => link.input({ k: 'key', key })}
                className="h-9 min-w-10 rounded-orv-sm border border-orv-edge bg-orv-track px-2.5 font-mono text-[12px]"
              >
                {label}
              </button>
            ))}
            <button
              onClick={() => link.input({ k: 'scroll', x: 0.5, y: 0.5, dy: -360 })}
              className="h-9 rounded-orv-sm border border-orv-edge bg-orv-track px-2.5 text-[12px]"
            >
              Scroll up
            </button>
            <button
              onClick={() => link.input({ k: 'scroll', x: 0.5, y: 0.5, dy: 360 })}
              className="h-9 rounded-orv-sm border border-orv-edge bg-orv-track px-2.5 text-[12px]"
            >
              Scroll down
            </button>
          </div>
          <p className="text-[12px] text-orv-muted">
            Tap to click, tap twice to double-click, hold for a right click, drag to drag. With a keyboard,
            click the picture and type. Windows’ sign-in screen and administrator windows don’t take input
            from here.
          </p>
        </Glass>
      ) : null}
      {deck.live ? null : (
        <Button
          size="sm"
          className="self-start"
          onClick={() => {
            link.deck({ t: 'shot' });
            toast({ title: 'Taking a picture of the screen' });
          }}
        >
          Just one picture
        </Button>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ files

type Sort = 'name' | 'new' | 'big';
const KIND: [RegExp, typeof File][] = [
  [/\.(png|jpe?g|gif|webp|bmp|heic|svg)$/i, FileImage],
  [/\.(mp4|mkv|mov|avi|webm)$/i, FileVideo],
  [/\.(mp3|wav|flac|m4a|ogg)$/i, FileMusic],
  [/\.(zip|rar|7z|tar|gz)$/i, FileArchive],
  [/\.(ts|tsx|js|py|rs|dart|java|kt|go|json|ya?ml|sh|ps1|html|css)$/i, FileCode],
  [/\.(pdf|docx?|txt|md|xlsx?|pptx?|csv)$/i, FileText],
];
const iconOf = (e: PcEntry) => (e.dir ? Folder : (KIND.find(([re]) => re.test(e.name))?.[1] ?? File));

function crumbs(path: string): { name: string; path: string }[] {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts.map((name, i) => ({
    name,
    path: parts.slice(0, i + 1).join('\\') + (i === 0 && /^[A-Za-z]:$/.test(name) ? '\\' : ''),
  }));
}

function Files({ link, deck }: { link: PcLink; deck: PcDeck }) {
  const toast = useToast();
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<Sort>('name');
  const pick = useRef<HTMLInputElement>(null);
  const files = deck.files;
  useEffect(() => {
    link.deck({ t: 'places' });
    if (!deck.files) link.deck({ t: 'files' });
  }, [link]);
  useEffect(() => setFilter(''), [files?.path]);
  const go = (path?: string | null) => link.deck({ t: 'files', path });
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = (files?.list ?? []).filter((e) => !q || e.name.toLowerCase().includes(q));
    const by = {
      name: (a: PcEntry, b: PcEntry) => a.name.localeCompare(b.name, undefined, { numeric: true }),
      new: (a: PcEntry, b: PcEntry) => (b.modified ?? 0) - (a.modified ?? 0),
      big: (a: PcEntry, b: PcEntry) => b.size - a.size,
    }[sort];
    return [...list].sort((a, b) => Number(b.dir) - Number(a.dir) || by(a, b));
  }, [files, filter, sort]);

  const send = async (f: globalThis.File) => {
    if (f.size > 25 * 1048576) return toast({ title: 'Files up to 25 MB can be sent', tone: 'danger' });
    const path = await link.put(f.name, new Uint8Array(await f.arrayBuffer()));
    if (path) toast({ title: `On the PC: ${path}`, tone: 'success' });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Places">
        {deck.places.map((p) => {
          const Icon = p.name.startsWith('Drive') ? HardDrive : Folder;
          return (
            <Button
              key={p.path}
              size="sm"
              variant={files?.path === p.path ? 'primary' : 'secondary'}
              className="shrink-0"
              onClick={() => go(p.path)}
            >
              <Icon size={14} aria-hidden /> {p.name}
            </Button>
          );
        })}
      </div>
      <Glass className="flex flex-col gap-2 p-3">
        {files ? (
          <nav aria-label="Folder" className="flex flex-wrap items-center gap-0.5 text-[13px]">
            {files.parent ? (
              <button
                aria-label="Up one folder"
                className="mr-1 rounded-orv-xs p-1 hover:bg-orv-track"
                onClick={() => go(files.parent)}
              >
                <FolderUp size={15} aria-hidden />
              </button>
            ) : null}
            {crumbs(files.path).map((c, i, all) => (
              <span key={c.path} className="flex items-center">
                <button
                  className={cn(
                    'rounded-orv-xs px-1 py-0.5 hover:bg-orv-track',
                    i === all.length - 1 && 'font-semibold',
                  )}
                  onClick={() => go(c.path)}
                >
                  {c.name}
                </button>
                {i < all.length - 1 ? (
                  <ChevronRight size={12} aria-hidden className="text-orv-faint" />
                ) : null}
              </span>
            ))}
          </nav>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <label className="relative min-w-40 flex-1">
            <Search
              size={14}
              aria-hidden
              className="absolute left-3 top-1/2 -translate-y-1/2 text-orv-faint"
            />
            <Input
              aria-label="Find in this folder"
              placeholder="Find in this folder"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="h-10 pl-9 text-[14px]"
            />
          </label>
          <Segmented
            label="Sort"
            value={sort}
            onChange={(v: string) => setSort(v as Sort)}
            options={[
              { value: 'name', label: 'Name' },
              { value: 'new', label: 'Newest' },
              { value: 'big', label: 'Largest' },
            ]}
          />
          <Button size="sm" onClick={() => pick.current?.click()} disabled={deck.sending !== null}>
            <Upload size={14} aria-hidden /> Send a file to the PC
          </Button>
          <input
            ref={pick}
            type="file"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void send(f);
            }}
          />
        </div>
        {deck.progress !== null || deck.sending !== null ? (
          <div
            role="progressbar"
            aria-valuenow={Math.round((deck.progress ?? deck.sending ?? 0) * 100)}
            className="h-1.5 overflow-hidden rounded-full bg-orv-track"
          >
            <div
              className="h-full bg-orv-accent transition-[width]"
              style={{ width: `${(deck.progress ?? deck.sending ?? 0) * 100}%` }}
            />
          </div>
        ) : null}
        <List files={files} shown={shown} link={link} go={go} />
      </Glass>
    </div>
  );
}

function List({
  files,
  shown,
  link,
  go,
}: {
  files: PcFiles | null;
  shown: PcEntry[];
  link: PcLink;
  go(path: string): void;
}) {
  if (!files) return <p className="p-4 text-small text-orv-muted">Opening your home folder…</p>;
  if (!shown.length) return <p className="p-4 text-small text-orv-muted">Nothing here.</p>;
  return (
    <>
      <ul aria-label="Files on the PC" className="flex flex-col divide-y divide-orv-hairline">
        {shown.map((f) => {
          const Icon = iconOf(f);
          return (
            <li key={f.path} className="flex items-center gap-2">
              <button
                className="flex min-h-12 min-w-0 flex-1 items-center gap-3 py-1.5 text-left"
                onClick={() => (f.dir ? go(f.path) : link.deck({ t: 'get', path: f.path }))}
                title={f.dir ? 'Open the folder' : 'Download it here'}
              >
                <Icon size={18} aria-hidden className={f.dir ? 'text-orv-accent' : 'text-orv-muted'} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px]">{f.name}</span>
                  <span className="block text-[12px] text-orv-muted">
                    {[when(f.modified), f.dir ? '' : size(f.size)].filter(Boolean).join(' · ')}
                  </span>
                </span>
              </button>
              {f.dir ? null : (
                <>
                  <button
                    aria-label={`Download ${f.name}`}
                    className="grid size-9 place-items-center rounded-orv-sm hover:bg-orv-track"
                    onClick={() => link.deck({ t: 'get', path: f.path })}
                  >
                    <ArrowDownToLine size={16} aria-hidden />
                  </button>
                  <button
                    aria-label={`Open ${f.name} on the PC`}
                    className="grid size-9 place-items-center rounded-orv-sm hover:bg-orv-track"
                    onClick={() => link.deck({ t: 'openfile', path: f.path })}
                  >
                    <ExternalLink size={16} aria-hidden />
                  </button>
                </>
              )}
            </li>
          );
        })}
      </ul>
      {files.cut ? (
        <p className="text-small text-orv-muted">Only the first 1,000 are shown: use the terminal.</p>
      ) : null}
    </>
  );
}

// ------------------------------------------------------------------ controls

function Controls({ link, deck }: { link: PcLink; deck: PcDeck }) {
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [level, setLevel] = useState<number | null>(null);
  useEffect(() => link.deck({ t: 'deck' }), [link]);
  const sound = deck.sound;
  const setVolume = () => {
    if (level !== null) link.deck({ t: 'do', what: 'volume', v: level });
    setLevel(null);
  };
  return (
    <div className="flex flex-col gap-3">
      <Glass className="flex flex-wrap items-center gap-2 p-3">
        <Button size="sm" onClick={() => link.deck({ t: 'do', what: 'lock' })}>
          <Lock size={14} aria-hidden /> Lock
        </Button>
        <Button
          size="sm"
          onClick={() => {
            if (
              window.confirm('Put the PC to sleep? You can’t wake it from here unless it is set up for that.')
            )
              link.deck({ t: 'do', what: 'sleep' });
          }}
        >
          <Moon size={14} aria-hidden /> Sleep
        </Button>
        {sound ? (
          <>
            <Button
              size="sm"
              aria-pressed={sound.muted}
              onClick={() => link.deck({ t: 'do', what: 'mute', v: sound.muted ? 0 : 1 })}
            >
              {sound.muted ? <VolumeX size={14} aria-hidden /> : <Volume2 size={14} aria-hidden />}
              {sound.muted ? 'Unmute' : 'Mute'}
            </Button>
            <input
              type="range"
              aria-label="Volume"
              min={0}
              max={100}
              value={level ?? sound.volume}
              onChange={(e) => setLevel(Number(e.target.value))}
              onPointerUp={setVolume}
              onKeyUp={setVolume}
              className="min-w-32 flex-1"
            />
          </>
        ) : null}
      </Glass>
      <Glass className="flex flex-col gap-2 p-3">
        <form
          className="flex gap-2"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            link.deck({ t: 'open', url: /^https?:\/\//.test(url) ? url : `https://${url}` });
            setUrl('');
          }}
        >
          <Input
            aria-label="Open a link on the PC"
            placeholder="Open a link on the PC"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <Button type="submit" disabled={!url.trim()}>
            Open
          </Button>
        </form>
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            link.deck({ t: 'clip', text });
            setText('');
          }}
        >
          <Input
            aria-label="Text for the PC’s clipboard"
            placeholder="Text for the PC’s clipboard"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={5000}
            className="min-w-48 flex-1"
          />
          <Button type="submit" disabled={!text}>
            <ClipboardPaste size={14} aria-hidden /> Send
          </Button>
          <Button type="button" onClick={() => link.deck({ t: 'clip' })}>
            <ClipboardCopy size={14} aria-hidden /> Get the PC’s
          </Button>
        </form>
      </Glass>
    </div>
  );
}

function useObjectUrl(blob: Blob | null): string | null {
  const [href, setHref] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) return setHref(null);
    const u = URL.createObjectURL(blob);
    setHref(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return href;
}

/** The last picture or file that arrived: a file is saved, a single picture is shown. */
export function useArrivals(deck: PcDeck, toast: ReturnType<typeof useToast>) {
  useEffect(() => {
    const f = deck.file;
    if (!f) return;
    const href = URL.createObjectURL(f.blob);
    if (f.name === 'screen.jpg') {
      window.open(href, '_blank', 'noopener');
    } else {
      const a = document.createElement('a');
      a.href = href;
      a.download = f.name;
      a.click();
    }
    setTimeout(() => URL.revokeObjectURL(href), 60_000);
  }, [deck.file]);
  useEffect(() => {
    if (deck.clip === null) return;
    navigator.clipboard.writeText(deck.clip).then(
      () => toast({ title: 'Copied from the PC', tone: 'success' }),
      () => toast({ title: 'The browser didn’t allow copying', tone: 'danger' }),
    );
  }, [deck.clip, toast]);
}

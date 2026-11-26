'use client';

import {
  ClipboardCopy,
  ClipboardPaste,
  File,
  Folder,
  FolderUp,
  Lock,
  Moon,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { Glass, useToast } from '@/components/ui/bits';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import type { PcDeck, PcFiles, PcLink } from '@/lib/pc';

const size = (n: number) =>
  n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`;

/** The remote deck (spec 0021 #11): the PC without the terminal. */
export function PcDeckPanel({ link, deck }: { link: PcLink; deck: PcDeck }) {
  const toast = useToast();
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [level, setLevel] = useState<number | null>(null);

  useEffect(() => link.deck({ t: 'deck' }), [link]);
  // a picture is only looked at here; a file is saved
  useEffect(() => {
    const f = deck.file;
    if (!f || f.name === 'screen.jpg') return;
    const href = URL.createObjectURL(f.blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = f.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(href), 10_000);
  }, [deck.file]);
  useEffect(() => {
    if (deck.clip === null) return;
    navigator.clipboard.writeText(deck.clip).then(
      () => toast({ title: 'Copied from the PC', tone: 'success' }),
      () => toast({ title: 'The browser didn’t allow copying', tone: 'danger' }),
    );
  }, [deck.clip, toast]);

  const shot = useObjectUrl(deck.file?.name === 'screen.jpg' ? deck.file.blob : null);
  const sound = deck.sound;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
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
              onPointerUp={() => {
                if (level !== null) link.deck({ t: 'do', what: 'volume', v: level });
                setLevel(null);
              }}
              onKeyUp={() => {
                if (level !== null) link.deck({ t: 'do', what: 'volume', v: level });
                setLevel(null);
              }}
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

      <Glass className="flex flex-col gap-2 p-3">
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => link.deck({ t: 'shot' })}>
            See the screen
          </Button>
          <Button size="sm" onClick={() => link.deck({ t: 'files', path: deck.files?.path })}>
            Files
          </Button>
          {deck.progress !== null ? (
            <span role="status" className="text-small text-orv-muted">
              {Math.round(deck.progress * 100)}%
            </span>
          ) : null}
        </div>
        {shot ? (
          <a href={shot} target="_blank" rel="noreferrer">
            <img src={shot} alt="The PC’s screen a moment ago" className="w-full rounded-orv-sm" />
          </a>
        ) : null}
        {deck.files ? <Files files={deck.files} link={link} /> : null}
      </Glass>
    </div>
  );
}

function Files({ files, link }: { files: PcFiles; link: PcLink }) {
  return (
    <div>
      <p className="break-all pb-1 font-mono text-[12px] text-orv-muted">{files.path}</p>
      <ul aria-label="Files on the PC" className="flex max-h-96 flex-col overflow-y-auto">
        {files.parent ? (
          <li>
            <button
              className="flex h-10 w-full items-center gap-2 text-left text-[14px]"
              onClick={() => link.deck({ t: 'files', path: files.parent })}
            >
              <FolderUp size={16} aria-hidden /> Up
            </button>
          </li>
        ) : null}
        {files.list.map((f) => (
          <li key={f.path}>
            <button
              className="flex h-10 w-full items-center gap-2 text-left text-[14px]"
              onClick={() => link.deck(f.dir ? { t: 'files', path: f.path } : { t: 'get', path: f.path })}
            >
              {f.dir ? <Folder size={16} aria-hidden /> : <File size={16} aria-hidden />}
              <span className="min-w-0 flex-1 truncate">{f.name}</span>
              {f.dir ? null : <span className="text-small text-orv-muted">{size(f.size)}</span>}
            </button>
          </li>
        ))}
      </ul>
      {files.cut ? <p className="text-small text-orv-muted">Too many to show: use the terminal.</p> : null}
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

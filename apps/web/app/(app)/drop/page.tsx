'use client';

import { type DropItem, type DropProposal, formatMoney } from '@orvyn/contracts';
import {
  CalendarDays,
  CheckCircle2,
  FileText,
  Link2,
  Mic,
  MicOff,
  Paperclip,
  Receipt,
  Send,
  StickyNote,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { Badge, Glass, Label, Segmented, useToast } from '@/components/ui/bits';
import { Button, Spinner } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { cn } from '@/lib/cn';
import { useDrop } from '@/lib/drop';
import { useVoice } from '@/lib/voice';
import { FileViewer } from '@/components/file-viewer';
import { mimeFromName } from '@/lib/files';
import { useMoneyMaybe } from '@/lib/money';
import { spring } from '@/lib/motion';
import { useSession } from '@/lib/session';

export default function DropPage() {
  return (
    <div data-module="drop" className="flex flex-col gap-5">
      <header className="px-1 pt-2">
        <span className="text-small text-orv-muted">Text, voice, a photo, a file or a link</span>
        <h1 className="text-title font-semibold">Drop</h1>
      </header>
      <Composer />
      <Items />
    </div>
  );
}

// ------------------------------------------------------------------ dropping

function Composer() {
  const { dropText, dropFile, dropVoice } = useDrop();
  const toast = useToast();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [voice, setVoice] = useState(false);
  const [keepAudio, setKeepAudio] = useState(true);
  const [recording, setRecording] = useState<{ blob: Blob; url: string } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  // words are made by the browser on this device; the recording is kept only if asked (spec 0007 A2)
  const mic = useVoice({ onText: (t) => setText(t), record: true });

  const clearRecording = () => {
    if (recording) URL.revokeObjectURL(recording.url);
    setRecording(null);
  };
  const toggleMic = async () => {
    if (mic.listening) {
      const blob = await mic.stop();
      if (blob && blob.size > 1000) {
        clearRecording();
        setRecording({ blob, url: URL.createObjectURL(blob) });
      }
      setVoice(true);
    } else {
      clearRecording();
      await mic.start(text);
    }
  };

  const send = async () => {
    if (mic.listening) await toggleMic();
    if (!text.trim() && !recording) return;
    setBusy(true);
    try {
      if (recording && keepAudio) await dropVoice(recording.blob, text);
      else await dropText(text, { kind: voice ? 'voice' : undefined });
      setText('');
      setVoice(false);
      clearRecording();
    } catch (e) {
      toast({ title: 'That couldn’t be dropped', body: (e as Error).message, tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };
  const sendFile = async (f: File) => {
    setBusy(true);
    try {
      await dropFile(f, text.trim());
      setText('');
    } catch (e) {
      toast({ title: 'That file couldn’t be dropped', body: (e as Error).message, tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Glass level="float" className="flex flex-col gap-2 p-3">
      <div
        className="flex items-start gap-2"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files[0];
          if (f) void sendFile(f);
        }}
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          onPaste={(e) => {
            const f = [...e.clipboardData.files][0];
            if (f) {
              e.preventDefault();
              void sendFile(f);
            }
          }}
          rows={2}
          maxLength={20_000}
          aria-label="Drop something"
          placeholder="Drop anything… “dentist friday 11”, “spent 240 on lunch”, a link, or paste a photo"
          className="min-h-11 flex-1 resize-none bg-transparent px-2 py-2 text-[16px] outline-none placeholder:text-orv-faint"
        />
      </div>
      <div className="flex items-center gap-1">
        <Button
          size="sm"
          variant="ghost"
          aria-label="Attach a photo or file"
          onClick={() => file.current?.click()}
        >
          <Paperclip size={16} />
        </Button>
        <input
          ref={file}
          type="file"
          accept="image/*,application/pdf,text/plain"
          className="hidden"
          aria-label="File to drop"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void sendFile(f);
          }}
        />
        {mic.supported ? (
          <Button
            size="sm"
            variant={mic.listening ? 'secondary' : 'ghost'}
            aria-label={mic.listening ? 'Stop listening' : 'Speak'}
            onClick={() => void toggleMic()}
          >
            {mic.listening ? <MicOff size={16} /> : <Mic size={16} />}
          </Button>
        ) : null}
        {mic.listening ? (
          <span className="flex items-center gap-2 text-small text-orv-accent" aria-live="polite">
            <span className="flex h-4 items-end gap-0.5" aria-hidden>
              {[0.6, 1, 0.75, 0.9, 0.5].map((k, i) => (
                <span
                  key={i}
                  className="w-0.5 rounded-full bg-orv-accent transition-[height]"
                  style={{ height: `${Math.max(15, mic.level * k * 100)}%` }}
                />
              ))}
            </span>
            Listening…{mic.interim ? <span className="text-orv-faint">{mic.interim}</span> : null}
          </span>
        ) : null}
        {mic.error ? <span className="text-small text-orv-danger">{mic.error}</span> : null}
        {recording && !mic.listening ? (
          <span className="flex items-center gap-2 rounded-full bg-orv-track px-2 py-1 text-[12px]">
            <audio src={recording.url} controls className="h-7 w-44" aria-label="Your recording" />
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={keepAudio} onChange={(e) => setKeepAudio(e.target.checked)} />
              Keep the recording
            </label>
            <button aria-label="Discard the recording" onClick={clearRecording}>
              <X size={13} />
            </button>
          </span>
        ) : null}
        <span className="ml-auto text-[11px] text-orv-faint">
          Enter to drop · the AI suggests, you decide
        </span>
        <Button
          size="sm"
          variant="primary"
          disabled={!text.trim() && !recording}
          loading={busy}
          onClick={() => void send()}
        >
          <Send size={14} /> Drop
        </Button>
      </div>
    </Glass>
  );
}

// ------------------------------------------------------------------ what came of it

const KIND_ICON = { task: CheckCircle2, event: CalendarDays, expense: Receipt, note: StickyNote } as const;

function Items() {
  const { items } = useDrop();
  const [showAll, setShowAll] = useState(false);
  const open = items.filter((i) => !['done', 'kept', 'dismissed'].includes(i.status));
  const past = items.filter((i) => ['done', 'kept'].includes(i.status)).slice(0, showAll ? 50 : 6);
  return (
    <>
      <section aria-label="To decide" className="flex flex-col gap-3">
        <AnimatePresence initial={false}>
          {open.map((i) => (
            <motion.div
              key={i.id}
              layout
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, x: 40 }}
              transition={spring.smooth}
            >
              <ItemCard item={i} />
            </motion.div>
          ))}
        </AnimatePresence>
        {!open.length ? (
          <p className="px-1 text-small text-orv-muted">
            Nothing waiting. Whatever you drop shows up here with a suggestion.
          </p>
        ) : null}
      </section>
      {past.length ? (
        <section aria-label="Done" className="flex flex-col gap-1">
          <Label>Done</Label>
          {past.map((i) => (
            <div key={i.id} className="flex items-center gap-2 px-1 text-[13px] text-orv-muted">
              <CheckCircle2 size={14} className="text-orv-success" aria-hidden />
              <span className="truncate">{summary(i)}</span>
              <span className="ml-auto shrink-0">
                {i.status === 'kept'
                  ? 'kept as a note'
                  : i.resultRef?.startsWith('money')
                    ? 'in Money'
                    : 'in Today'}
              </span>
            </div>
          ))}
          {!showAll && items.length > 6 ? (
            <Button size="sm" variant="ghost" onClick={() => setShowAll(true)}>
              Show more
            </Button>
          ) : null}
        </section>
      ) : null}
    </>
  );
}

const summary = (i: DropItem) =>
  i.text || i.url || i.fileName || (i.proposal && 'title' in i.proposal ? i.proposal.title : 'Item');

function ItemCard({ item }: { item: DropItem }) {
  const { confirm, keep, dismiss, retry } = useDrop();
  const toast = useToast();
  const [viewing, setViewing] = useState(false);
  const Icon =
    item.kind === 'link' ? Link2 : item.kind === 'photo' || item.kind === 'file' ? FileText : StickyNote;
  return (
    <Glass className="flex flex-col gap-3 p-4" aria-label={`Dropped: ${summary(item)}`}>
      <FileViewer
        file={
          viewing && item.fileId
            ? { id: item.fileId, name: item.fileName ?? 'file', mime: mimeFromName(item.fileName ?? '') }
            : null
        }
        onClose={() => setViewing(false)}
      />
      <div className="flex items-start gap-2">
        <Icon size={16} className="mt-0.5 shrink-0 text-orv-muted" aria-hidden />
        <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-[14px]">{summary(item)}</p>
        {item.kind === 'voice' ? <Badge>voice</Badge> : null}
        {item.fileId ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setViewing(true)}
            aria-label={`Open ${item.fileName ?? 'the file'}`}
          >
            <Paperclip size={14} /> {item.kind === 'voice' ? 'Play' : 'Open'}
          </Button>
        ) : null}
        <button
          aria-label="Dismiss"
          onClick={() => void dismiss(item)}
          className="text-orv-faint hover:text-orv-text"
        >
          <X size={16} />
        </button>
      </div>
      {item.status === 'new' || item.status === 'thinking' ? (
        <p className="flex items-center gap-2 text-small text-orv-muted">
          <Spinner /> Reading it…
        </p>
      ) : item.status === 'proposed' && item.proposal ? (
        <Proposal
          item={item}
          onConfirm={async (p) => {
            await confirm(item, p);
            toast({
              title:
                p.kind === 'note'
                  ? 'Kept as a note'
                  : p.kind === 'expense'
                    ? `Added to Money · ${formatMoney(Math.round(p.amount * 100))}`
                    : 'Added to Today',
              tone: 'success',
            });
          }}
        />
      ) : (
        <div className="flex flex-col gap-2">
          <p className={cn('text-small', item.status === 'failed' ? 'text-orv-danger' : 'text-orv-warning')}>
            {item.problem}
          </p>
          <div className="flex flex-wrap gap-2">
            {item.status === 'failed' ? (
              <Button size="sm" variant="secondary" onClick={() => void retry(item)}>
                Try again
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                void confirm(item, {
                  kind: 'task',
                  title: summary(item).slice(0, 500),
                  dueDate: null,
                  dueAt: null,
                  durationMin: null,
                  priority: 0,
                  notes: '',
                  why: '',
                })
              }
            >
              Make it a task
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void keep(item)}>
              Keep as a note
            </Button>
          </div>
        </div>
      )}
    </Glass>
  );
}

const local = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const fromLocal = (v: string) => (v ? new Date(v).toISOString() : null);

function Proposal({ item, onConfirm }: { item: DropItem; onConfirm(p: DropProposal): Promise<void> }) {
  const { me } = useSession();
  const money = useMoneyMaybe();
  const [p, setP] = useState<DropProposal>(item.proposal!);
  const [busy, setBusy] = useState(false);
  useEffect(() => setP(item.proposal!), [item.proposal]);
  const can = (k: string) => me?.role === 'owner' || !!me?.entitlements.includes(k as never);
  const kinds = [
    ...(can('today') ? (['task', 'event'] as const) : []),
    ...(can('money') ? (['expense'] as const) : []),
    'note' as const,
  ];
  const Icon = KIND_ICON[p.kind];
  const switchTo = (k: DropProposal['kind']) => {
    const title = 'title' in p ? p.title : 'merchant' in p ? p.merchant : '';
    const now = new Date();
    if (k === 'task')
      setP({
        kind: 'task',
        title: title || 'Task',
        dueDate: null,
        dueAt: null,
        durationMin: null,
        priority: 0,
        notes: '',
        why: p.why,
      });
    if (k === 'event')
      setP({
        kind: 'event',
        title: title || 'Event',
        start: now.toISOString(),
        end: new Date(now.getTime() + 3_600_000).toISOString(),
        location: '',
        notes: '',
        why: p.why,
      });
    if (k === 'expense')
      setP({
        kind: 'expense',
        amount: 1,
        currency: 'INR',
        direction: 'debit',
        merchant: title,
        category: 'Other',
        occurredAt: null,
        note: '',
        why: p.why,
      });
    if (k === 'note') setP({ kind: 'note', title: title || 'Note', text: item.text, why: p.why });
  };
  return (
    <div className="flex flex-col gap-3 rounded-orv-md border border-orv-edge p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Icon size={16} className="text-orv-accent" aria-hidden />
        <Segmented
          label="What it is"
          value={p.kind}
          onChange={(v) => switchTo(v as DropProposal['kind'])}
          options={kinds.map((k) => ({ value: k, label: k[0]!.toUpperCase() + k.slice(1) }))}
        />
      </div>
      {p.why ? <p className="text-[12px] text-orv-muted">Why: {p.why}</p> : null}
      {p.kind === 'task' ? (
        <div className="grid gap-2 sm:grid-cols-[1fr_200px]">
          <Field label="Title">
            {(id) => (
              <Input id={id} value={p.title} onChange={(e) => setP({ ...p, title: e.target.value })} />
            )}
          </Field>
          <Field label="When">
            {(id) => (
              <Input
                id={id}
                type={p.dueAt || !p.dueDate ? 'datetime-local' : 'date'}
                value={p.dueAt ? local(p.dueAt) : (p.dueDate ?? '')}
                onChange={(e) =>
                  setP(
                    e.target.type === 'date'
                      ? { ...p, dueDate: e.target.value || null }
                      : { ...p, dueAt: fromLocal(e.target.value), dueDate: null },
                  )
                }
              />
            )}
          </Field>
        </div>
      ) : p.kind === 'event' ? (
        <div className="grid gap-2 sm:grid-cols-3">
          <Field label="Title">
            {(id) => (
              <Input id={id} value={p.title} onChange={(e) => setP({ ...p, title: e.target.value })} />
            )}
          </Field>
          <Field label="Starts">
            {(id) => (
              <Input
                id={id}
                type="datetime-local"
                value={local(p.start)}
                onChange={(e) => e.target.value && setP({ ...p, start: fromLocal(e.target.value)! })}
              />
            )}
          </Field>
          <Field label="Ends">
            {(id) => (
              <Input
                id={id}
                type="datetime-local"
                value={local(p.end)}
                onChange={(e) => e.target.value && setP({ ...p, end: fromLocal(e.target.value)! })}
              />
            )}
          </Field>
        </div>
      ) : p.kind === 'expense' ? (
        <div className="grid gap-2 sm:grid-cols-3">
          <Field label="Amount (₹)">
            {(id) => (
              <Input
                id={id}
                inputMode="decimal"
                value={String(p.amount)}
                onChange={(e) => {
                  const v = Number(e.target.value.replace(/,/g, ''));
                  if (v > 0) setP({ ...p, amount: v });
                }}
              />
            )}
          </Field>
          <Field label="Merchant">
            {(id) => (
              <Input id={id} value={p.merchant} onChange={(e) => setP({ ...p, merchant: e.target.value })} />
            )}
          </Field>
          <Field label="Category">
            {(id) => (
              <select
                id={id}
                value={p.category}
                onChange={(e) => setP({ ...p, category: e.target.value })}
                className="h-11 w-full rounded-orv-md border border-orv-edge bg-orv-glass px-3 text-[14px]"
              >
                {[
                  ...new Set([
                    p.category,
                    ...(money?.categories.filter((c) => !c.archived).map((c) => c.name) ?? []),
                  ]),
                ].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
      ) : (
        <Field label="Title">
          {(id) => <Input id={id} value={p.title} onChange={(e) => setP({ ...p, title: e.target.value })} />}
        </Field>
      )}
      <div className="flex justify-end gap-2">
        <Button
          variant="primary"
          size="sm"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            await onConfirm(p);
            setBusy(false);
          }}
        >
          {p.kind === 'note' ? 'Keep note' : p.kind === 'expense' ? 'Add to Money' : 'Add to Today'}
        </Button>
      </div>
    </div>
  );
}

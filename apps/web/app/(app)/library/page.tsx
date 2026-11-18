'use client';

import { formatMoney, LIBRARY_CATEGORIES, type LibraryDoc } from '@orvyn/contracts';
import { expiringSoon, expiry, expiryLabel, formatBytes, searchDocs } from '@orvyn/library';
import {
  AlertTriangle,
  BookOpen,
  CalendarClock,
  Download,
  FilePlus2,
  FileText,
  Loader2,
  NotebookPen,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { TagsInput } from '@/components/task-views';
import { Badge, Glass, Label, Sheet, Switch, useToast } from '@/components/ui/bits';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { cn } from '@/lib/cn';
import { FileViewer } from '@/components/file-viewer';
import { mimeFromName } from '@/lib/files';
import { useLibrary } from '@/lib/library';
import { useMoneyMaybe } from '@/lib/money';
import { localDay } from '@/lib/today';

export default function LibraryPage() {
  return (
    <div data-module="library">
      <LibraryView />
    </div>
  );
}

const sel = 'h-11 w-full rounded-orv-md border border-orv-edge bg-orv-field px-3 text-[14px] text-orv-text';

function LibraryView() {
  const { ready, docs, addFile } = useLibrary();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [open, setOpen] = useState<LibraryDoc | null>(null);
  const [writing, setWriting] = useState(false);
  const [busy, setBusy] = useState(0);
  const file = useRef<HTMLInputElement>(null);
  const today = localDay(new Date());
  const shown = useMemo(
    () => searchDocs(docs, q).filter((d) => !category || d.category === category),
    [docs, q, category],
  );
  const soon = useMemo(() => expiringSoon(docs, today, 60), [docs, today]);
  const used = useMemo(() => [...new Set(docs.map((d) => d.category))].sort(), [docs]);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    for (const f of Array.from(files)) {
      setBusy((n) => n + 1);
      try {
        await addFile(f);
        toast({ title: 'Added to Library', body: f.name, tone: 'success' });
      } catch (e) {
        toast({ title: 'Couldn’t add that', body: (e as Error).message, tone: 'danger' });
      } finally {
        setBusy((n) => n - 1);
      }
    }
    if (file.current) file.current.value = '';
  };

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3 px-1 pt-2">
        <div>
          <span className="text-small text-orv-muted">
            {docs.length ? `${docs.length} kept` : 'Documents that organise themselves'}
          </span>
          <h1 className="text-title font-semibold">Library</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setWriting(true)}>
            <NotebookPen size={14} /> Note
          </Button>
          <Button variant="primary" size="sm" onClick={() => file.current?.click()} disabled={busy > 0}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <FilePlus2 size={14} />} Add a document
          </Button>
          <input
            ref={file}
            type="file"
            multiple
            hidden
            aria-label="Add documents"
            accept="image/*,application/pdf,text/*,audio/*,video/*,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.csv,.json,.zip"
            onChange={(e) => void upload(e.target.files)}
          />
        </div>
      </header>

      <Glass level="float" className="flex items-center gap-2 p-3">
        <Search size={16} className="ml-1 text-orv-faint" aria-hidden />
        <input
          aria-label="Search the Library"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search in plain words — “pan card”, “health insurance”, “rent”"
          className="h-10 flex-1 bg-transparent text-[16px] outline-none placeholder:text-orv-faint"
        />
        {q ? (
          <Button size="sm" variant="ghost" onClick={() => setQ('')}>
            Clear
          </Button>
        ) : null}
      </Glass>

      {used.length > 1 ? (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Categories">
          {['', ...used].map((c) => (
            <button
              key={c || 'all'}
              aria-pressed={category === c}
              onClick={() => setCategory(c)}
              className={cn(
                'rounded-full border px-3 py-1 text-[13px]',
                category === c ? 'border-orv-accent bg-orv-track' : 'border-orv-edge text-orv-muted',
              )}
            >
              {c || 'All'}
            </button>
          ))}
        </div>
      ) : null}

      {soon.length && !q && !category ? (
        <Glass className="flex flex-col gap-2 p-4" aria-label="Running out">
          <span className="flex items-center gap-2 text-orv-accent">
            <CalendarClock size={15} aria-hidden />
            <Label>Running out</Label>
          </span>
          {soon.slice(0, 4).map((d) => {
            const e = expiry(d.expiresOn, today);
            return (
              <button
                key={d.id}
                onClick={() => setOpen(d)}
                className="flex items-center justify-between gap-3 rounded-orv-md px-2 py-1.5 text-left hover:bg-orv-track"
              >
                <span className="truncate text-[14px] font-medium">{d.title || 'Document'}</span>
                <Badge tone={e.urgency === 'expired' ? 'danger' : 'warning'}>{expiryLabel(e.days)}</Badge>
              </button>
            );
          })}
        </Glass>
      ) : null}

      {!ready ? (
        <div className="skeleton h-28 rounded-orv-md" />
      ) : shown.length ? (
        <ul className="grid gap-3 md:grid-cols-2" aria-label="Documents">
          {shown.map((d) => (
            <li key={d.id}>
              <DocCard doc={d} today={today} onOpen={() => setOpen(d)} />
            </li>
          ))}
        </ul>
      ) : (
        <Glass className="flex flex-col items-center gap-2 p-8 text-center">
          <BookOpen size={28} className="text-orv-accent" aria-hidden />
          <p className="text-[15px] font-medium">
            {docs.length ? 'Nothing matches.' : 'Your Library is empty.'}
          </p>
          <p className="max-w-md text-small text-orv-muted">
            {docs.length
              ? 'Try fewer words, or clear the filter.'
              : 'Add a photo or PDF — an insurance policy, a PAN card, a rent agreement — or write a note. ORVYN reads it, titles and tags it, and reminds you before it expires.'}
          </p>
        </Glass>
      )}

      <DocSheet
        doc={open ? (docs.find((d) => d.id === open.id) ?? open) : null}
        onClose={() => setOpen(null)}
      />
      <NoteSheet open={writing} onClose={() => setWriting(false)} />
    </div>
  );
}

function DocCard({ doc, today, onOpen }: { doc: LibraryDoc; today: string; onOpen(): void }) {
  const e = expiry(doc.expiresOn, today);
  const working = doc.status === 'new' || doc.status === 'reading';
  return (
    <button
      onClick={onOpen}
      className="glass-pane flex h-full w-full flex-col gap-2 p-4 text-left transition-transform hover:-translate-y-0.5"
    >
      <span className="flex items-start gap-3">
        <span
          aria-hidden
          className="grid size-10 shrink-0 place-items-center rounded-[12px] text-white [background:var(--orv-accent-grad)]"
        >
          <FileText size={18} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold">
            {doc.title || (working ? 'Reading…' : doc.fileName || 'Untitled')}
          </span>
          <span className="block truncate text-[12px] text-orv-muted">
            {doc.category}
            {doc.size ? ` · ${formatBytes(doc.size)}` : ''}
          </span>
        </span>
        {working ? <Loader2 size={15} className="animate-spin text-orv-accent" aria-label="Reading" /> : null}
      </span>
      {doc.summary ? <span className="line-clamp-2 text-small text-orv-muted">{doc.summary}</span> : null}
      <span className="flex flex-wrap items-center gap-1.5">
        {doc.status === 'waiting' ? <Badge tone="warning">Waiting for tomorrow</Badge> : null}
        {doc.status === 'failed' ? <Badge tone="danger">Fill in yourself</Badge> : null}
        {e.urgency !== 'none' ? (
          <Badge tone={e.urgency === 'expired' ? 'danger' : e.urgency === 'soon' ? 'warning' : 'neutral'}>
            {expiryLabel(e.days)}
          </Badge>
        ) : null}
        {doc.tags.slice(0, 4).map((t) => (
          <Badge key={t}>#{t}</Badge>
        ))}
      </span>
    </button>
  );
}

function DocSheet({ doc, onClose }: { doc: LibraryDoc | null; onClose(): void }) {
  const { update, remove, reread } = useLibrary();
  const money = useMoneyMaybe();
  const toast = useToast();
  const [d, setD] = useState<LibraryDoc | null>(doc);
  const [shown, setShown] = useState<string | null>(null);
  const [viewing, setViewing] = useState(false);
  if (doc && shown !== doc.id) {
    setShown(doc.id);
    setD(doc);
  }
  if (!doc && shown) setShown(null);
  if (!d || !doc)
    return (
      <Sheet open={false} onClose={onClose} title="">
        {null}
      </Sheet>
    );
  const today = localDay(new Date());
  const save = async () => {
    await update(d.id, {
      title: d.title.trim(),
      category: d.category,
      tags: d.tags,
      summary: d.summary,
      expiresOn: d.expiresOn || null,
      remind: d.remind,
      ...(d.kind === 'note' ? { text: d.text } : {}),
    });
    onClose();
  };
  const addToMoney = async (i: number) => {
    const a = d.amounts[i];
    if (!a || !money) return;
    await money.addTransaction({
      amountMinor: a.amountMinor,
      currency: a.currency,
      direction: 'debit',
      merchant: d.title,
      note: a.label,
      occurredAt: new Date().toISOString(),
      source: 'manual',
    });
    await update(d.id, { moneyState: 'added' });
    toast({
      title: 'Added to Money',
      body: `${formatMoney(a.amountMinor, a.currency)} · ${d.title}`,
      tone: 'success',
    });
  };
  const e = expiry(d.expiresOn, today);
  return (
    <Sheet open onClose={onClose} title="Document">
      <FileViewer
        file={
          viewing && d.fileId
            ? {
                id: d.fileId,
                name: d.fileName || d.title || 'file',
                mime: d.mime || mimeFromName(d.fileName),
              }
            : null
        }
        onClose={() => setViewing(false)}
      />
      <form
        className="flex flex-col gap-3"
        onSubmit={(ev) => {
          ev.preventDefault();
          void save();
        }}
      >
        {d.status === 'new' || d.status === 'reading' ? (
          <p className="flex items-center gap-2 text-small text-orv-muted">
            <Loader2 size={14} className="animate-spin" /> ORVYN is reading this…
          </p>
        ) : null}
        {d.problem ? (
          <p className="flex items-start gap-2 text-small text-orv-warning">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {d.problem}
          </p>
        ) : null}
        <Field label="Title">
          {(id) => (
            <Input
              id={id}
              value={d.title}
              maxLength={200}
              onChange={(ev) => setD({ ...d, title: ev.target.value })}
            />
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category">
            {(id) => (
              <select
                id={id}
                className={sel}
                value={d.category}
                onChange={(ev) => setD({ ...d, category: ev.target.value })}
              >
                {[...new Set([...LIBRARY_CATEGORIES, d.category])].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Expires on" hint={d.expiresOn ? expiryLabel(e.days) : undefined}>
            {(id) => (
              <Input
                id={id}
                type="date"
                value={d.expiresOn ?? ''}
                onChange={(ev) => setD({ ...d, expiresOn: ev.target.value || null })}
              />
            )}
          </Field>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[14px]">Remind me before it expires</span>
          <Switch
            checked={d.remind}
            label="Remind me before it expires"
            onChange={(v) => setD({ ...d, remind: v })}
          />
        </div>
        <Field label="Tags">
          {() => <TagsInput value={d.tags} onChange={(tags) => setD({ ...d, tags })} suggestions={[]} />}
        </Field>
        <Field label="Summary">
          {(id) => (
            <textarea
              id={id}
              rows={3}
              value={d.summary}
              onChange={(ev) => setD({ ...d, summary: ev.target.value })}
              className="w-full rounded-orv-md border border-orv-edge bg-orv-field p-3 text-[14px] outline-none"
            />
          )}
        </Field>
        {d.kind === 'note' ? (
          <Field label="Note">
            {(id) => (
              <textarea
                id={id}
                rows={6}
                value={d.text}
                onChange={(ev) => setD({ ...d, text: ev.target.value })}
                className="w-full rounded-orv-md border border-orv-edge bg-orv-field p-3 text-[14px] outline-none"
              />
            )}
          </Field>
        ) : null}
        {d.keyDates.length ? (
          <div>
            <Label>Dates in it</Label>
            <ul className="mt-1 flex flex-col gap-1 text-[13px]">
              {d.keyDates.map((k) => (
                <li key={k.label + k.date} className="flex items-center justify-between gap-2">
                  <span>{k.label}</span>
                  <span className="flex items-center gap-2 tabular-nums text-orv-muted">
                    {k.date}
                    {k.date !== d.expiresOn ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setD({ ...d, expiresOn: k.date })}
                      >
                        Use as expiry
                      </Button>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {d.amounts.length && money ? (
          <div className="flex flex-col gap-1.5 rounded-orv-md bg-orv-track p-3" aria-label="Amounts in it">
            <Label>Amounts in it</Label>
            {d.amounts.map((a, i) => (
              <div
                key={a.label + a.amountMinor}
                className="flex items-center justify-between gap-2 text-[14px]"
              >
                <span>
                  {a.label} ·{' '}
                  <strong className="tabular-nums">{formatMoney(a.amountMinor, a.currency)}</strong>
                </span>
                {doc.moneyState === 'added' ? (
                  <Badge tone="success">In Money</Badge>
                ) : doc.moneyState === 'dismissed' ? (
                  <Badge>Skipped</Badge>
                ) : (
                  <span className="flex gap-1">
                    <Button type="button" size="sm" variant="secondary" onClick={() => void addToMoney(i)}>
                      <Plus size={13} /> Add to Money
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => void update(d.id, { moneyState: 'dismissed' })}
                    >
                      Not now
                    </Button>
                  </span>
                )}
              </div>
            ))}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <span className="flex gap-1">
            <Button
              type="button"
              variant="danger"
              size="sm"
              onClick={async () => {
                await remove(d.id);
                toast({ title: 'Deleted', body: d.title || 'Document' });
                onClose();
              }}
            >
              <Trash2 size={14} /> Delete
            </Button>
            {d.fileId ? (
              <Button type="button" variant="secondary" size="sm" onClick={() => setViewing(true)}>
                <Download size={14} /> Open original
              </Button>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void reread(d.id)}
              title="Read it again"
            >
              <RefreshCw size={14} /> Read again
            </Button>
          </span>
          <Button type="submit" variant="primary">
            Save
          </Button>
        </div>
      </form>
    </Sheet>
  );
}

function NoteSheet({ open, onClose }: { open: boolean; onClose(): void }) {
  const { addNote } = useLibrary();
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  return (
    <Sheet open={open} onClose={onClose} title="New note">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim() && !title.trim()) return;
          void addNote({ title, text }).then(() => {
            toast({ title: 'Note saved', tone: 'success' });
            setTitle('');
            setText('');
            onClose();
          });
        }}
      >
        <Field label="Title (optional)">
          {(id) => <Input id={id} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />}
        </Field>
        <Field label="Note">
          {(id) => (
            <textarea
              id={id}
              rows={8}
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="w-full rounded-orv-md border border-orv-edge bg-orv-field p-3 text-[15px] outline-none"
            />
          )}
        </Field>
        <p className="text-[12px] text-orv-faint">
          ORVYN reads notes to title and tag them, so they can be found. Secrets belong in the Vault, not
          here.
        </p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!text.trim() && !title.trim()}>
            Save note
          </Button>
        </div>
      </form>
    </Sheet>
  );
}

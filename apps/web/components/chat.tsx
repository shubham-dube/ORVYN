'use client';

import type { ChatPayload, ConversationView } from '@orvyn/contracts';
import {
  ArrowUp,
  BellOff,
  Check,
  CheckCheck,
  CornerUpLeft,
  Download,
  Info,
  Lock,
  MessageCircle,
  Paperclip,
  Pencil,
  Plus,
  SmilePlus,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Glass, Label, Sheet, SkeletonRows, Switch, useToast } from '@/components/ui/bits';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { api, ApiError } from '@/lib/api';
import {
  deviceKeys,
  fingerprint,
  type Line,
  memberKeys,
  openFile,
  readPage,
  send,
  sendFile,
} from '@/lib/chat';
import { cn } from '@/lib/cn';
import { realtime } from '@/lib/realtime';
import { useSession } from '@/lib/session';

const EMOJI = ['👍', '❤️', '😂', '😮', '🙏', '🎉'];
const time = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
const dayLabel = (iso: string) => {
  const d = new Date(iso);
  const today = new Date();
  const y = new Date(Date.now() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
};

export interface Person {
  id: string;
  name: string;
  email: string;
}
const display = (p: { name: string; email: string }) => p.name || p.email.split('@')[0]!;

// ------------------------------------------------------------------ the list

export function useConversations() {
  const [list, setList] = useState<ConversationView[] | null>(null);
  const load = useCallback(() => api<ConversationView[]>('/chat/conversations').then(setList), []);
  useEffect(() => {
    void load().catch(() => setList([]));
    return realtime?.on((m) => {
      if (m.type === 'chat.message' || m.type === 'chat.changed' || m.type === 'chat.read') void load();
    });
  }, [load]);
  return { list, reload: load };
}

export function ChatList({ active }: { active?: string }) {
  const { list } = useConversations();
  const [creating, setCreating] = useState(false);
  const router = useRouter();
  return (
    <Glass
      level="pane"
      as="nav"
      aria-label="Conversations"
      className="flex h-full min-h-0 flex-col gap-1 p-3"
    >
      <div className="flex items-center gap-2 px-1 pb-2">
        <h2 className="flex-1 text-[15px] font-semibold">Chats</h2>
        <Button size="sm" variant="ghost" onClick={() => setCreating(true)} aria-label="New chat">
          <Plus size={15} /> New
        </Button>
      </div>
      {list === null ? (
        <SkeletonRows rows={4} label="Loading chats" />
      ) : !list.length ? (
        <p className="px-2 text-small text-orv-muted">No chats yet. Start one with someone on ORVYN.</p>
      ) : (
        <ul className="flex min-h-0 flex-col overflow-y-auto">
          {list.map((c) => (
            <li key={c.id}>
              <Link
                href={`/chat/${c.id}`}
                className={cn(
                  'flex items-center gap-3 rounded-orv-md px-2 py-2.5 hover:bg-orv-track',
                  active === c.id && 'bg-[color-mix(in_srgb,var(--orv-accent)_12%,transparent)]',
                )}
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[image:var(--orv-accent-grad)] text-[14px] font-semibold text-white">
                  {c.kind === 'group' ? <Users size={16} /> : c.title.slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1 truncate text-[14px] font-medium">
                    {c.title}
                    {c.muted ? <BellOff size={12} className="text-orv-faint" aria-label="muted" /> : null}
                  </span>
                  <span className="block truncate text-[12px] text-orv-muted">
                    {c.kind === 'group' ? `${c.members.length} people` : 'Direct'}
                    {c.lastAt
                      ? ` · ${dayLabel(c.lastAt) === 'Today' ? time(c.lastAt) : dayLabel(c.lastAt)}`
                      : ''}
                  </span>
                </span>
                {c.unread ? (
                  <span className="grid h-5 min-w-5 place-items-center rounded-full bg-orv-accent px-1.5 text-[11px] font-semibold text-white">
                    {c.unread}
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-auto flex items-center gap-1 px-2 pt-2 text-[11.5px] text-orv-faint">
        <Lock size={11} /> End-to-end encrypted on your devices
      </p>
      {creating ? (
        <NewChatSheet onClose={() => setCreating(false)} onMade={(id) => router.push(`/chat/${id}`)} />
      ) : null}
    </Glass>
  );
}

function NewChatSheet({ onClose, onMade }: { onClose(): void; onMade(id: string): void }) {
  const toast = useToast();
  const [people, setPeople] = useState<Person[] | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [title, setTitle] = useState('');
  useEffect(
    () =>
      void api<Person[]>('/chat/people')
        .then(setPeople)
        .catch(() => setPeople([])),
    [],
  );
  const group = chosen.size > 1;
  return (
    <Sheet
      open
      onClose={onClose}
      title="New chat"
      subtitle="One person for a direct chat, several for a group."
      footer={
        <Button
          variant="primary"
          disabled={!chosen.size || (group && !title.trim())}
          onClick={async () => {
            try {
              const c = await api<ConversationView>('/chat/conversations', {
                method: 'POST',
                body: { kind: group ? 'group' : 'direct', memberIds: [...chosen], title: title.trim() },
              });
              onMade(c.id);
              onClose();
            } catch (e) {
              toast({ title: e instanceof ApiError ? e.message : 'Couldn’t start it', tone: 'danger' });
            }
          }}
        >
          <MessageCircle size={14} /> Start
        </Button>
      }
    >
      {people === null ? (
        <SkeletonRows rows={3} label="Loading people" />
      ) : !people.length ? (
        <p className="text-small text-orv-muted">
          Nobody else has Chat yet. The owner can give it in People.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {group ? (
            <Field label="Group name">
              {(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} />}
            </Field>
          ) : null}
          {people.map((p) => (
            <label key={p.id} className="flex items-center gap-3 text-[14px]">
              <input
                type="checkbox"
                checked={chosen.has(p.id)}
                onChange={(e) => {
                  const next = new Set(chosen);
                  if (e.target.checked) next.add(p.id);
                  else next.delete(p.id);
                  setChosen(next);
                }}
              />
              <span className="flex-1">{display(p)}</span>
              <span className="text-[12px] text-orv-muted">{p.email}</span>
            </label>
          ))}
        </div>
      )}
    </Sheet>
  );
}

// ------------------------------------------------------------------ one conversation

function FileView({ conversationId, p }: { conversationId: string; p: Extract<ChatPayload, { t: 'file' }> }) {
  const [url, setUrl] = useState<string | null>(null);
  const image = p.mime.startsWith('image/');
  useEffect(() => {
    if (!image) return;
    let u: string | null = null;
    void openFile(conversationId, p).then((b) => setUrl((u = URL.createObjectURL(b))));
    return () => {
      if (u) URL.revokeObjectURL(u);
    };
  }, [conversationId, p, image]);
  if (image)
    return url ? (
      <img src={url} alt={p.name} className="max-h-72 rounded-orv-md" />
    ) : (
      <div className="skeleton h-40 w-56 rounded-orv-md" />
    );
  return (
    <button
      type="button"
      className="flex items-center gap-2 rounded-orv-md bg-orv-track px-3 py-2 text-left text-[13px]"
      onClick={async () => {
        const b = await openFile(conversationId, p);
        const a = document.createElement('a');
        a.href = URL.createObjectURL(b);
        a.download = p.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      }}
    >
      <Download size={14} /> {p.name} <span className="text-orv-muted">· {Math.ceil(p.size / 1024)} KB</span>
    </button>
  );
}

function ShareCard({ p }: { p: Extract<ChatPayload, { t: 'share' }> }) {
  const href = { task: '/today', ipo: `/ipo/${p.ref.id}`, doc: '/library', split: `/split/${p.ref.id}` }[
    p.ref.kind
  ];
  return (
    <Link
      href={href}
      className="block rounded-orv-md border border-orv-edge bg-orv-field px-3 py-2 hover:border-orv-accent"
    >
      <span className="text-[11px] uppercase tracking-wide text-orv-muted">
        {p.ref.kind === 'split' ? 'Split' : p.ref.kind}
      </span>
      <span className="block text-[14px] font-semibold">{p.ref.title}</span>
      {p.ref.line ? <span className="block text-[12.5px] text-orv-muted">{p.ref.line}</span> : null}
    </Link>
  );
}

export function Thread({ id }: { id: string }) {
  const { me, deviceId } = useSession();
  const toast = useToast();
  const [conv, setConv] = useState<ConversationView | null>(null);
  const [lines, setLines] = useState<Line[] | null>(null);
  const [text, setText] = useState('');
  const [reply, setReply] = useState<Line | null>(null);
  const [editing, setEditing] = useState<Line | null>(null);
  const [typing, setTyping] = useState<string | null>(null);
  const [info, setInfo] = useState(false);
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const lastTyping = useRef(0);

  const load = useCallback(async () => {
    if (!deviceId) return;
    const [c, page] = await Promise.all([
      api<ConversationView>(`/chat/conversations/${id}`),
      api<Parameters<typeof readPage>[1]>(`/chat/conversations/${id}/messages?limit=100`),
    ]);
    setConv(c);
    setLines(await readPage(deviceId, page));
    if (c.unread) void api(`/chat/conversations/${id}/read`, { method: 'POST' });
  }, [id, deviceId]);

  useEffect(() => {
    if (deviceId)
      void deviceKeys(deviceId)
        .then(load)
        .catch(() => setLines([]));
    return realtime?.on((m) => {
      if ('conversationId' in m && m.conversationId !== id) return;
      if (m.type === 'chat.message' || m.type === 'chat.changed') void load();
      if (m.type === 'chat.read') void api<ConversationView>(`/chat/conversations/${id}`).then(setConv);
      if (m.type === 'chat.typing') {
        setTyping(m.userId);
        setTimeout(() => setTyping((t) => (t === m.userId ? null : t)), 4000);
      }
    });
  }, [id, deviceId, load]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [lines?.length]);

  const name = useCallback(
    (uid: string) => {
      const m = conv?.members.find((x) => x.id === uid);
      return m ? display(m) : 'Someone';
    },
    [conv],
  );
  const byId = useMemo(() => new Map((lines ?? []).map((l) => [l.id, l])), [lines]);

  if (!conv || !lines || !deviceId) return <SkeletonRows rows={6} label="Opening the chat" />;

  const submit = async () => {
    const t = text.trim();
    if (!t) return;
    setBusy(true);
    try {
      if (editing) await send(deviceId, conv, { t: 'edit', target: editing.id, text: t });
      else await send(deviceId, conv, { t: 'text', text: t, replyTo: reply?.id ?? null });
      setText('');
      setReply(null);
      setEditing(null);
      await load();
    } catch (e) {
      toast({ title: e instanceof ApiError ? e.message : 'Not sent — try again', tone: 'danger' });
    } finally {
      setBusy(false);
    }
  };
  const react = async (l: Line, emoji: string) => {
    const mine = l.reactions.find((r) => r.emoji === emoji)?.by.includes(me!.id);
    await send(deviceId, conv, { t: 'react', target: l.id, emoji: mine ? null : emoji });
    await load();
  };
  const others = conv.members.filter((m) => m.id !== me?.id);
  const lastMine = [...lines].reverse().find((l) => l.senderId === me?.id && l.kind === 'msg');
  const readBy = lastMine ? others.filter((m) => m.lastReadAt && m.lastReadAt >= lastMine.at) : [];

  let prevDay = '';
  return (
    <Glass level="pane" as="section" aria-label={conv.title} className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-3 border-b border-orv-edge px-4 py-3">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[16px] font-semibold">{conv.title}</h1>
          <p className="truncate text-[12px] text-orv-muted">
            {typing
              ? `${name(typing)} is typing…`
              : conv.kind === 'group'
                ? others.map(display).join(', ')
                : 'Direct · encrypted'}
          </p>
        </div>
        {conv.splitGroupId ? (
          <Link href={`/split/${conv.splitGroupId}`} className="text-[13px] text-orv-accent hover:underline">
            Split
          </Link>
        ) : null}
        <Button size="sm" variant="ghost" aria-label="Chat details" onClick={() => setInfo(true)}>
          <Info size={15} />
        </Button>
      </header>

      <div
        className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-4 py-3"
        aria-label="Messages"
        role="log"
      >
        {!lines.length ? (
          <p className="m-auto text-small text-orv-muted">Say hello. Only the people here can read it.</p>
        ) : null}
        {lines.map((l) => {
          const day = dayLabel(l.at);
          const sep = day !== prevDay ? ((prevDay = day), day) : null;
          const mine = l.senderId === me?.id;
          const replyTo = l.payload?.t === 'text' && l.payload.replyTo ? byId.get(l.payload.replyTo) : null;
          return (
            <div key={l.id} className="flex flex-col">
              {sep ? <p className="my-2 text-center text-[11.5px] text-orv-faint">{sep}</p> : null}
              {l.kind === 'system' ? (
                <p
                  className="my-1 text-center text-[12px] text-orv-muted"
                  title="Not end-to-end encrypted: a note from ORVYN"
                >
                  {l.text}
                </p>
              ) : (
                <div className={cn('group flex items-end gap-2', mine ? 'flex-row-reverse' : '')}>
                  <div
                    className={cn(
                      'max-w-[78%] rounded-[18px] px-3 py-2 text-[14px]',
                      mine ? 'bg-[image:var(--orv-accent-grad)] text-white' : 'bg-orv-track',
                      l.kind !== 'msg' && 'italic opacity-70',
                    )}
                    data-testid="bubble"
                  >
                    {!mine && conv.kind === 'group' ? (
                      <p className="text-[11.5px] font-semibold opacity-80">{name(l.senderId)}</p>
                    ) : null}
                    {replyTo ? (
                      <p
                        className={cn(
                          'mb-1 border-l-2 pl-2 text-[12px] opacity-80',
                          mine ? 'border-white/60' : 'border-orv-accent',
                        )}
                      >
                        {name(replyTo.senderId)}:{' '}
                        {replyTo.payload?.t === 'text' ? replyTo.payload.text : 'attachment'}
                      </p>
                    ) : null}
                    {l.kind === 'deleted' ? (
                      'This message was deleted'
                    ) : l.kind === 'unreadable' ? (
                      'Can’t be read on this device (sent before it joined)'
                    ) : l.payload?.t === 'text' ? (
                      <span className="whitespace-pre-wrap break-words">{l.payload.text}</span>
                    ) : l.payload?.t === 'file' ? (
                      <div className="flex flex-col gap-1">
                        <FileView conversationId={id} p={l.payload} />
                        {l.payload.caption ? <span>{l.payload.caption}</span> : null}
                      </div>
                    ) : l.payload?.t === 'share' ? (
                      <ShareCard p={l.payload} />
                    ) : null}
                    <span
                      className={cn(
                        'mt-0.5 block text-right text-[10.5px]',
                        mine ? 'text-white/75' : 'text-orv-faint',
                      )}
                    >
                      {l.edited ? 'edited · ' : ''}
                      {time(l.at)}
                    </span>
                  </div>
                  {l.kind === 'msg' ? (
                    <div className="flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                      <details className="relative">
                        <summary
                          className="list-none cursor-pointer rounded-full p-1 text-orv-muted hover:bg-orv-track"
                          aria-label="React"
                        >
                          <SmilePlus size={14} />
                        </summary>
                        <div className="absolute bottom-7 z-10 flex gap-1 rounded-full border border-orv-edge bg-orv-field p-1 shadow">
                          {EMOJI.map((e) => (
                            <button
                              key={e}
                              type="button"
                              aria-label={`React ${e}`}
                              onClick={() => void react(l, e)}
                              className="rounded-full px-1 text-[16px] hover:bg-orv-track"
                            >
                              {e}
                            </button>
                          ))}
                        </div>
                      </details>
                      <button
                        type="button"
                        aria-label="Reply"
                        className="rounded-full p-1 text-orv-muted hover:bg-orv-track"
                        onClick={() => setReply(l)}
                      >
                        <CornerUpLeft size={14} />
                      </button>
                      {mine && l.payload?.t === 'text' ? (
                        <button
                          type="button"
                          aria-label="Edit"
                          className="rounded-full p-1 text-orv-muted hover:bg-orv-track"
                          onClick={() => {
                            setEditing(l);
                            setText(l.payload?.t === 'text' ? l.payload.text : '');
                          }}
                        >
                          <Pencil size={14} />
                        </button>
                      ) : null}
                      {mine ? (
                        <button
                          type="button"
                          aria-label="Delete for everyone"
                          className="rounded-full p-1 text-orv-muted hover:bg-orv-track"
                          onClick={async () => {
                            if (!window.confirm('Delete for everyone?')) return;
                            await api(`/chat/messages/${l.id}`, { method: 'DELETE' });
                            await load();
                          }}
                        >
                          <Trash2 size={14} />
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              )}
              {l.reactions.length ? (
                <div className={cn('mt-0.5 flex gap-1', mine ? 'justify-end pr-1' : 'pl-1')}>
                  {l.reactions.map((r) => (
                    <button
                      key={r.emoji}
                      type="button"
                      title={r.by.map(name).join(', ')}
                      onClick={() => void react(l, r.emoji)}
                      className="rounded-full border border-orv-edge bg-orv-field px-1.5 text-[12px]"
                    >
                      {r.emoji} {r.by.length}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
        {lastMine ? (
          <p className="pr-1 text-right text-[11px] text-orv-faint" aria-label="Receipt">
            {readBy.length === others.length && others.length ? (
              <>
                <CheckCheck size={12} className="inline text-orv-accent" /> Read
              </>
            ) : readBy.length ? (
              <>
                <CheckCheck size={12} className="inline" /> Read by {readBy.map(display).join(', ')}
              </>
            ) : (
              <>
                <Check size={12} className="inline" /> Sent
              </>
            )}
          </p>
        ) : null}
        <div ref={end} />
      </div>

      <footer className="border-t border-orv-edge p-3">
        {reply || editing ? (
          <div className="mb-2 flex items-center gap-2 rounded-orv-md bg-orv-track px-3 py-1.5 text-[12.5px]">
            <span className="min-w-0 flex-1 truncate">
              {editing ? 'Editing' : `Replying to ${name(reply!.senderId)}`}:{' '}
              {(editing ?? reply)?.payload?.t === 'text'
                ? ((editing ?? reply)!.payload as { text: string }).text
                : 'attachment'}
            </span>
            <button
              type="button"
              aria-label="Cancel"
              onClick={() => {
                setReply(null);
                setEditing(null);
                setText('');
              }}
            >
              <X size={14} />
            </button>
          </div>
        ) : null}
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <input
            ref={fileInput}
            type="file"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              setBusy(true);
              try {
                await sendFile(deviceId, conv, f);
                await load();
              } catch {
                toast({ title: 'That file couldn’t be sent', tone: 'danger' });
              } finally {
                setBusy(false);
              }
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="Attach a file"
            onClick={() => fileInput.current?.click()}
          >
            <Paperclip size={16} />
          </Button>
          <textarea
            aria-label="Message"
            rows={1}
            value={text}
            placeholder="Message"
            onChange={(e) => {
              setText(e.target.value);
              if (Date.now() - lastTyping.current > 3000) {
                lastTyping.current = Date.now();
                void api(`/chat/conversations/${id}/typing`, { method: 'POST' }).catch(() => undefined);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }}
            className="max-h-36 min-h-10 flex-1 resize-none rounded-[20px] border border-orv-edge bg-orv-field px-4 py-2 text-[14px] outline-none focus:border-orv-accent"
          />
          <Button
            type="submit"
            variant="primary"
            size="sm"
            aria-label="Send"
            loading={busy}
            disabled={!text.trim()}
          >
            <ArrowUp size={16} />
          </Button>
        </form>
      </footer>
      {info ? <InfoSheet conv={conv} onClose={() => setInfo(false)} onChanged={load} /> : null}
    </Glass>
  );
}

function InfoSheet({
  conv,
  onClose,
  onChanged,
}: {
  conv: ConversationView;
  onClose(): void;
  onChanged(): Promise<void>;
}) {
  const { me } = useSession();
  const toast = useToast();
  const router = useRouter();
  const [prints, setPrints] = useState<Record<string, string[]>>({});
  const [title, setTitle] = useState(conv.title);
  const [people, setPeople] = useState<Person[]>([]);
  const admin = conv.kind === 'group' && conv.adminId === me?.id;
  useEffect(() => {
    void memberKeys(
      conv.members.map((m) => m.id),
      true,
    ).then(async (ks) => {
      const out: Record<string, string[]> = {};
      for (const k of ks.filter((x) => x.active))
        (out[k.userId] ??= []).push(await fingerprint(k.boxPublic, k.signPublic));
      setPrints(out);
    });
    if (admin) void api<Person[]>('/chat/people').then(setPeople);
  }, [conv, admin]);
  const outside = people.filter((p) => !conv.members.some((m) => m.id === p.id));
  return (
    <Sheet
      open
      onClose={onClose}
      title={conv.title}
      subtitle="End-to-end encrypted. Compare device codes in person to be sure."
    >
      <div className="flex flex-col gap-4">
        {admin ? (
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Field label="Group name">
                {(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} />}
              </Field>
            </div>
            <Button
              variant="ghost"
              onClick={async () => {
                await api(`/chat/conversations/${conv.id}/title`, { method: 'PUT', body: { title } });
                await onChanged();
              }}
            >
              Rename
            </Button>
          </div>
        ) : null}
        <div className="flex items-center gap-3">
          <span className="flex-1 text-[14px]">Mute notifications</span>
          <Switch
            label="Mute"
            checked={conv.muted}
            onChange={async (v) => {
              await api(`/chat/conversations/${conv.id}/mute`, { method: 'PUT', body: { muted: v } });
              await onChanged();
            }}
          />
        </div>
        <div>
          <Label className="mb-2 block">People</Label>
          <ul className="flex flex-col gap-2">
            {conv.members.map((m) => (
              <li key={m.id} className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-medium">
                    {display(m)} {m.id === conv.adminId ? <Badge>admin</Badge> : null}
                  </p>
                  <p className="font-mono text-[11.5px] text-orv-muted">
                    {(prints[m.id] ?? ['no device yet']).join(' · ')}
                  </p>
                </div>
                {admin && m.id !== me?.id ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      await api(`/chat/conversations/${conv.id}/members/${m.id}`, { method: 'DELETE' });
                      await onChanged();
                    }}
                  >
                    Remove
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
        {admin && outside.length ? (
          <div>
            <Label className="mb-2 block">Add people</Label>
            <div className="flex flex-wrap gap-2">
              {outside.map((p) => (
                <Button
                  key={p.id}
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    await api(`/chat/conversations/${conv.id}/members`, {
                      method: 'POST',
                      body: { userIds: [p.id] },
                    });
                    toast({ title: `${display(p)} added` });
                    await onChanged();
                  }}
                >
                  <UserPlus size={13} /> {display(p)}
                </Button>
              ))}
            </div>
          </div>
        ) : null}
        {conv.kind === 'group' ? (
          <Button
            variant="ghost"
            onClick={async () => {
              if (!window.confirm('Leave this group?')) return;
              await api(`/chat/conversations/${conv.id}/members/${me!.id}`, { method: 'DELETE' });
              router.push('/chat');
            }}
          >
            Leave the group
          </Button>
        ) : null}
      </div>
    </Sheet>
  );
}

/** Send an ORVYN thing (a Split group, an IPO…) into a chat as a card. */
export function ShareToChat({
  item,
  onClose,
}: {
  item: Extract<ChatPayload, { t: 'share' }>['ref'];
  onClose(): void;
}) {
  const { deviceId } = useSession();
  const toast = useToast();
  const { list } = useConversations();
  return (
    <Sheet open onClose={onClose} title="Share in a chat" subtitle={item.title}>
      {list === null ? (
        <SkeletonRows rows={3} label="Loading chats" />
      ) : (
        <ul className="flex flex-col">
          {list.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className="w-full rounded-orv-md px-2 py-2 text-left text-[14px] hover:bg-orv-track"
                onClick={async () => {
                  await send(deviceId!, c, { t: 'share', ref: item });
                  toast({ title: `Shared in ${c.title}`, tone: 'success' });
                  onClose();
                }}
              >
                {c.title}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}

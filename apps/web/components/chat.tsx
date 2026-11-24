'use client';

import type { ChatAttachment, ChatShareRef, ConversationView, ServerMessage } from '@orvyn/contracts';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  BellOff,
  Check,
  CheckCheck,
  Clock3,
  Copy,
  CornerUpLeft,
  CornerUpRight,
  EyeOff,
  FileText,
  Forward,
  Info,
  MessageCircle,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Pin,
  PinOff,
  Plus,
  RotateCw,
  Search,
  SmilePlus,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Badge, Label, Sheet, SkeletonRows, Switch, useToast } from '@/components/ui/bits';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { api, ApiError } from '@/lib/api';
import {
  attachmentLabel,
  attachmentUrl,
  bytes,
  carryOver,
  display,
  downloadAttachment,
  type Draft,
  lastSeen,
  type Message,
  optimistic,
  sendMessage,
  uploadAttachment,
} from '@/lib/chat';
import { cn } from '@/lib/cn';
import { spring } from '@/lib/motion';
import { realtime } from '@/lib/realtime';
import { useSession } from '@/lib/session';

const QUICK = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
const MORE = [
  '🔥',
  '🎉',
  '👏',
  '💯',
  '😍',
  '🤔',
  '😅',
  '🙌',
  '👀',
  '✅',
  '❌',
  '🥳',
  '😎',
  '🤝',
  '💪',
  '😴',
  '🍕',
  '☕',
];
const GROUP_MS = 5 * 60_000;

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
function dayLabel(iso: string) {
  const d = new Date(iso);
  if (d.toDateString() === new Date().toDateString()) return 'Today';
  if (d.toDateString() === new Date(Date.now() - 86_400_000).toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}),
  });
}
function when(iso: string) {
  const l = dayLabel(iso);
  return l === 'Today' ? time(iso) : l;
}

export interface Person {
  id: string;
  name: string;
  email: string;
  online?: boolean;
}

/** Words with links you can open (nothing else is turned into markup). */
function Linked({ text, mine }: { text: string; mine: boolean }) {
  const parts = text.split(/(https?:\/\/[^\s<]+[^\s<.,;:!?'")\]])/g);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 ? (
          <a
            key={i}
            href={p}
            target="_blank"
            rel="noopener noreferrer"
            className={cn('underline underline-offset-2', mine ? 'text-white' : 'text-orv-accent')}
          >
            {p}
          </a>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  );
}

function Highlight({ text, q }: { text: string; q: string }) {
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (!q || i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded bg-orv-accent/25 text-inherit">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

function Face({ c, size = 40 }: { c: ConversationView; size?: number }) {
  const { me } = useSession();
  const other = c.kind === 'direct' ? c.members.find((m) => m.id !== me?.id) : null;
  return (
    <span className="relative shrink-0" style={{ width: size, height: size }}>
      <span
        className="grid h-full w-full place-items-center rounded-full bg-[image:var(--orv-accent-grad)] font-semibold text-white"
        style={{ fontSize: size * 0.38 }}
      >
        {c.kind === 'group' ? <Users size={size * 0.42} /> : c.title.slice(0, 1).toUpperCase()}
      </span>
      {other?.online ? (
        <span
          aria-label="online"
          className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-[var(--orv-base)] bg-orv-success"
        />
      ) : null}
    </span>
  );
}

// ------------------------------------------------------------------ the list

/** the last list this tab saw, so coming back to Chat shows it at once while a fresh one loads */
let lastList: ConversationView[] | null = null;

/** My conversations, kept live: new lines, typing and who is online. */
export function useConversations() {
  const [list, setList] = useState<ConversationView[] | null>(lastList);
  const [typing, setTyping] = useState<Record<string, string>>({});
  const load = useCallback(
    () =>
      api<ConversationView[]>('/chat/conversations').then((l) => {
        lastList = l;
        setList(l);
      }),
    [],
  );
  useEffect(() => {
    void load().catch(() => setList((l) => l ?? []));
    let t: ReturnType<typeof setTimeout> | null = null;
    const soon = () => {
      if (t) clearTimeout(t);
      t = setTimeout(() => void load().catch(() => undefined), 250);
    };
    const off = realtime?.on((m) => {
      if (
        m.type === 'chat.message' ||
        m.type === 'chat.changed' ||
        m.type === 'chat.read' ||
        m.type === 'chat.hidden'
      )
        soon();
      if (m.type === 'chat.typing') {
        setTyping((x) => ({ ...x, [m.conversationId]: m.userId }));
        setTimeout(
          () =>
            setTyping((x) => {
              const { [m.conversationId]: _, ...rest } = x;
              return rest;
            }),
          4000,
        );
      }
      if (m.type === 'chat.presence')
        setList(
          (l) =>
            l?.map((c) => ({
              ...c,
              members: c.members.map((p) =>
                p.id === m.userId ? { ...p, online: m.online, lastSeenAt: m.lastSeenAt } : p,
              ),
            })) ?? l,
        );
    });
    return () => {
      off?.();
      if (t) clearTimeout(t);
    };
  }, [load]);
  return { list, typing, reload: load };
}

export function ChatList({ active }: { active?: string }) {
  const { me } = useSession();
  const { list, typing } = useConversations();
  const [creating, setCreating] = useState(false);
  const [q, setQ] = useState('');
  const router = useRouter();
  const shown = (list ?? []).filter(
    (c) =>
      !q.trim() ||
      `${c.title} ${c.members.map(display).join(' ')} ${c.last?.text ?? ''}`
        .toLowerCase()
        .includes(q.toLowerCase()),
  );
  const unread = (list ?? []).reduce((n, c) => n + (c.unread && !c.muted ? 1 : 0), 0);
  return (
    <nav aria-label="Conversations" className="glass-pane flex h-full min-h-0 flex-col p-3">
      <div className="flex items-center gap-2 px-1 pb-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-[17px] font-semibold tracking-tight">Chats</h2>
          <p className="text-[11.5px] text-orv-muted">
            {unread ? `${unread} with new messages` : 'On every device you sign in to'}
          </p>
        </div>
        <Button size="sm" variant="primary" onClick={() => setCreating(true)} aria-label="New chat">
          <Plus size={15} /> New
        </Button>
      </div>
      <label className="mx-1 mb-2 flex items-center gap-2 rounded-full field-ring px-3 py-1.5 focus-within:border-orv-accent">
        <Search size={14} className="text-orv-faint" />
        <input
          aria-label="Search chats"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search"
          className="min-w-0 flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-orv-faint"
        />
      </label>
      {list === null ? (
        <SkeletonRows rows={5} label="Loading chats" />
      ) : !list.length ? (
        <div className="m-auto flex max-w-[16rem] flex-col items-center gap-3 py-10 text-center">
          <span className="grid h-14 w-14 place-items-center rounded-full bg-[image:var(--orv-accent-grad)] text-white">
            <MessageCircle size={24} />
          </span>
          <p className="text-small text-orv-muted">No chats yet. Start one with someone on ORVYN.</p>
          <Button size="sm" variant="primary" onClick={() => setCreating(true)}>
            Start a chat
          </Button>
        </div>
      ) : (
        <ul className="-mx-1 flex min-h-0 flex-col overflow-y-auto px-1">
          {shown.map((c) => {
            const who = typing[c.id];
            const last = c.last;
            const prefix =
              last && last.kind === 'msg' && !last.deleted
                ? last.senderId === me?.id
                  ? 'You: '
                  : c.kind === 'group'
                    ? `${display(c.members.find((m) => m.id === last.senderId) ?? { name: '', email: 'someone' })}: `
                    : ''
                : '';
            return (
              <li key={c.id}>
                <Link
                  href={`/chat/${c.id}`}
                  className={cn(
                    'flex items-center gap-3 rounded-orv-md px-2 py-2.5 transition-colors hover:bg-orv-track',
                    active === c.id && 'bg-[color-mix(in_srgb,var(--orv-accent)_12%,transparent)]',
                  )}
                >
                  <Face c={c} size={44} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span
                        className={cn('truncate text-[14.5px]', c.unread ? 'font-semibold' : 'font-medium')}
                      >
                        {c.title}
                      </span>
                      {c.muted ? (
                        <BellOff size={12} className="shrink-0 text-orv-faint" aria-label="muted" />
                      ) : null}
                      <span
                        className={cn(
                          'ml-auto shrink-0 text-[11.5px]',
                          c.unread && !c.muted ? 'font-semibold text-orv-accent' : 'text-orv-faint',
                        )}
                      >
                        {last ? when(last.at) : c.lastAt ? when(c.lastAt) : ''}
                      </span>
                    </span>
                    <span className="mt-0.5 flex items-center gap-1.5">
                      <span
                        className={cn(
                          'min-w-0 flex-1 truncate text-[12.5px]',
                          who ? 'text-orv-accent' : c.unread ? 'text-orv-text' : 'text-orv-muted',
                        )}
                      >
                        {who
                          ? c.kind === 'group'
                            ? `${display(c.members.find((m) => m.id === who) ?? { name: '', email: 'someone' })} is typing…`
                            : 'typing…'
                          : !last
                            ? 'Say hello'
                            : last.deleted
                              ? 'Message deleted'
                              : `${prefix}${[last.attachment, last.text].filter(Boolean).join(' ')}`}
                      </span>
                      {c.pinned ? (
                        <Pin size={12} className="shrink-0 text-orv-faint" aria-label="pinned" />
                      ) : null}
                      {c.unread ? (
                        <span
                          className={cn(
                            'grid h-5 min-w-5 shrink-0 place-items-center rounded-full px-1.5 text-[11px] font-semibold text-white',
                            c.muted ? 'bg-orv-faint' : 'bg-orv-accent',
                          )}
                        >
                          {c.unread > 99 ? '99+' : c.unread}
                        </span>
                      ) : null}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
          {!shown.length ? (
            <p className="px-2 py-4 text-small text-orv-muted">No chat matches “{q}”.</p>
          ) : null}
        </ul>
      )}
      {creating ? (
        <NewChatSheet onClose={() => setCreating(false)} onMade={(id) => router.push(`/chat/${id}`)} />
      ) : null}
    </nav>
  );
}

function NewChatSheet({ onClose, onMade }: { onClose(): void; onMade(id: string): void }) {
  const toast = useToast();
  const [people, setPeople] = useState<Person[] | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [title, setTitle] = useState('');
  const [q, setQ] = useState('');
  useEffect(
    () =>
      void api<Person[]>('/chat/people')
        .then(setPeople)
        .catch(() => setPeople([])),
    [],
  );
  const group = chosen.size > 1;
  const shown = (people ?? []).filter((p) => `${p.name} ${p.email}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <Sheet
      open
      onClose={onClose}
      title="New chat"
      subtitle="Pick one person for a chat, or several for a group."
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
          <MessageCircle size={14} /> {group ? `Make the group (${chosen.size + 1})` : 'Start chatting'}
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
          <AnimatePresence initial={false}>
            {group ? (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
              >
                <Field label="Group name">
                  {(id) => (
                    <Input
                      id={id}
                      value={title}
                      placeholder="Goa trip"
                      onChange={(e) => setTitle(e.target.value)}
                    />
                  )}
                </Field>
              </motion.div>
            ) : null}
          </AnimatePresence>
          {chosen.size ? (
            <div className="flex flex-wrap gap-1.5">
              {people
                .filter((p) => chosen.has(p.id))
                .map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setChosen((s) => new Set([...s].filter((x) => x !== p.id)))}
                    className="flex items-center gap-1 rounded-full bg-[color-mix(in_srgb,var(--orv-accent)_14%,transparent)] px-2.5 py-1 text-[12.5px] text-orv-accent"
                  >
                    {display(p)} <X size={12} />
                  </button>
                ))}
            </div>
          ) : null}
          <Input
            aria-label="Find someone"
            placeholder="Find someone"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <ul className="flex flex-col">
            {shown.map((p) => {
              const on = chosen.has(p.id);
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      setChosen((s) => {
                        const n = new Set(s);
                        if (on) n.delete(p.id);
                        else n.add(p.id);
                        return n;
                      })
                    }
                    className={cn(
                      'flex w-full items-center gap-3 rounded-orv-md px-2 py-2 text-left hover:bg-orv-track',
                      on && 'bg-[color-mix(in_srgb,var(--orv-accent)_10%,transparent)]',
                    )}
                  >
                    <span className="relative grid h-9 w-9 shrink-0 place-items-center rounded-full bg-orv-track text-[14px] font-semibold">
                      {display(p).slice(0, 1).toUpperCase()}
                      {p.online ? (
                        <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-[var(--orv-base)] bg-orv-success" />
                      ) : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-medium">{display(p)}</span>
                      <span className="block truncate text-[12px] text-orv-muted">{p.email}</span>
                    </span>
                    <span
                      className={cn(
                        'grid h-5 w-5 place-items-center rounded-full border',
                        on ? 'border-orv-accent bg-orv-accent text-white' : 'border-orv-edge',
                      )}
                    >
                      {on ? <Check size={12} /> : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Sheet>
  );
}

// ------------------------------------------------------------------ pieces of a message

function Photo({ conversationId, a, local }: { conversationId: string; a: ChatAttachment; local?: string }) {
  const [url, setUrl] = useState<string | null>(local ?? null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (local) return;
    let live = true;
    void attachmentUrl(conversationId, a)
      .then((u) => live && setUrl(u))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [conversationId, a, local]);
  const ratio = a.w && a.h ? `${a.w} / ${a.h}` : '4 / 3';
  return (
    <>
      <button
        type="button"
        aria-label={`Open ${a.name}`}
        onClick={() => url && setOpen(true)}
        className="block w-full overflow-hidden rounded-[14px] bg-orv-track"
        style={{ aspectRatio: ratio, maxHeight: 320 }}
      >
        {url ? (
          <img src={url} alt={a.name} className="h-full w-full object-cover" />
        ) : (
          <div className="skeleton h-full w-full" />
        )}
      </button>
      <AnimatePresence>
        {open && url ? (
          <motion.div
            className="fixed inset-0 z-[70] grid place-items-center bg-black/85 p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(false)}
          >
            <motion.img
              src={url}
              alt={a.name}
              initial={{ scale: 0.94 }}
              animate={{ scale: 1 }}
              transition={spring.snappy}
              className="max-h-full max-w-full rounded-orv-md object-contain"
            />
            <div className="absolute right-4 top-4 flex gap-2">
              <Button
                size="sm"
                variant="ghost"
                className="text-white"
                onClick={(e) => {
                  e.stopPropagation();
                  void downloadAttachment(conversationId, a);
                }}
              >
                Save
              </Button>
              <Button size="sm" variant="ghost" className="text-white" aria-label="Close">
                <X size={16} />
              </Button>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}

function FileCard({ conversationId, a, mine }: { conversationId: string; a: ChatAttachment; mine: boolean }) {
  const ext = a.name.split('.').pop()?.slice(0, 4).toUpperCase() ?? 'FILE';
  return (
    <button
      type="button"
      onClick={() => void downloadAttachment(conversationId, a)}
      className={cn(
        'flex w-full items-center gap-3 rounded-[14px] px-3 py-2 text-left',
        mine ? 'bg-white/15 hover:bg-white/20' : 'bg-orv-base/60 hover:bg-orv-base',
      )}
    >
      <span
        className={cn(
          'grid h-10 w-10 shrink-0 place-items-center rounded-[10px] text-[10px] font-bold',
          mine ? 'bg-white/25' : 'bg-[color-mix(in_srgb,var(--orv-accent)_15%,transparent)] text-orv-accent',
        )}
      >
        {a.mime.startsWith('audio/')
          ? '♪'
          : a.mime === 'application/pdf'
            ? 'PDF'
            : ext || <FileText size={16} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-medium">{a.name}</span>
        <span className={cn('block text-[11.5px]', mine ? 'text-white/75' : 'text-orv-muted')}>
          {bytes(a.size)} · tap to save
        </span>
      </span>
    </button>
  );
}

function Share({ s, mine }: { s: ChatShareRef; mine: boolean }) {
  const href = { task: '/today', ipo: `/ipo/${s.id}`, doc: '/library', split: `/split/${s.id}` }[s.kind];
  return (
    <Link
      href={href}
      className={cn(
        'block rounded-[14px] px-3 py-2',
        mine ? 'bg-white/15 hover:bg-white/20' : 'bg-orv-base/60 hover:bg-orv-base',
      )}
    >
      <span
        className={cn(
          'text-[10.5px] font-semibold uppercase tracking-wide',
          mine ? 'text-white/80' : 'text-orv-accent',
        )}
      >
        {{ task: 'Task', ipo: 'IPO', doc: 'Document', split: 'Split' }[s.kind]}
      </span>
      <span className="block text-[14px] font-semibold">{s.title}</span>
      {s.line ? (
        <span className={cn('block text-[12.5px]', mine ? 'text-white/80' : 'text-orv-muted')}>{s.line}</span>
      ) : null}
    </Link>
  );
}

function Ticks({ state }: { state: 'sending' | 'failed' | 'sent' | 'delivered' | 'read' }) {
  if (state === 'sending') return <Clock3 size={12} aria-label="Sending" />;
  if (state === 'failed') return <AlertCircle size={12} aria-label="Not sent" className="text-orv-danger" />;
  if (state === 'sent') return <Check size={13} aria-label="Sent" />;
  // read: full strength and bolder; delivered: the bubble's quieter tone
  return (
    <CheckCheck
      size={13}
      strokeWidth={state === 'read' ? 3 : 2}
      aria-label={state === 'read' ? 'Read' : 'Delivered'}
      className={state === 'read' ? 'text-white' : undefined}
    />
  );
}

/** A small floating menu that closes on any outside press. */
function Popover({
  onClose,
  children,
  className,
}: {
  onClose(): void;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
    };
  }, [onClose]);
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, scale: 0.92, y: 4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={spring.snappy}
      className={cn('glass-float edge-light absolute z-30 rounded-[16px] p-1.5 shadow-lg', className)}
    >
      {children}
    </motion.div>
  );
}

function MenuItem({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: ReactNode;
  label: string;
  onClick(): void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-1.5 text-left text-[13.5px] hover:bg-orv-track',
        danger && 'text-orv-danger',
      )}
    >
      {icon} {label}
    </button>
  );
}

// ------------------------------------------------------------------ one conversation

interface Pending {
  draft: Draft;
  files?: File[];
}

export function Thread({ id }: { id: string }) {
  const { me, deviceId } = useSession();
  const toast = useToast();
  const router = useRouter();
  const [conv, setConv] = useState<ConversationView | null>(null);
  const [msgs, setMsgs] = useState<Message[] | null>(null);
  const [more, setMore] = useState(true);
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [reply, setReply] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [typing, setTyping] = useState<string[]>([]);
  const [info, setInfo] = useState(false);
  const [forward, setForward] = useState<Message | null>(null);
  const [menu, setMenu] = useState<{ id: string; kind: 'react' | 'more' } | null>(null);
  const [searching, setSearching] = useState(false);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Message[] | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [below, setBelow] = useState(0);
  const [atBottom, setAtBottom] = useState(true);
  const [firstUnread, setFirstUnread] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const lastTyping = useRef(0);
  const pending = useRef(new Map<string, Pending>());
  const localUrls = useRef(new Map<string, string>());
  const loadingOlder = useRef(false);

  const upsert = useCallback((m: Message) => {
    setMsgs((list) => {
      if (!list) return list;
      const i = list.findIndex((x) => x.id === m.id);
      if (i >= 0) {
        const next = [...list];
        next[i] = m;
        return next;
      }
      return [...list, m].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    });
  }, []);

  const markRead = useCallback(() => {
    void api(`/chat/conversations/${id}/read`, { method: 'POST' }).catch(() => undefined);
  }, [id]);

  const load = useCallback(async () => {
    const [c, page] = await Promise.all([
      api<ConversationView>(`/chat/conversations/${id}`),
      api<Message[]>(`/chat/conversations/${id}/messages?limit=60`),
    ]);
    let rows = page;
    if (deviceId && page.some((m) => m.v === 1 && m.sealedForMe)) {
      const n = await carryOver(deviceId, id, page).catch(() => 0);
      if (n) rows = await api<Message[]>(`/chat/conversations/${id}/messages?limit=60`);
    }
    const myRead = c.members.find((m) => m.id === me?.id)?.lastReadAt ?? '';
    const sorted = [...rows].reverse();
    setFirstUnread(
      c.unread
        ? (sorted.find((m) => m.kind === 'msg' && m.senderId !== me?.id && m.createdAt > myRead)?.id ?? null)
        : null,
    );
    setConv(c);
    setMsgs((old) => [...sorted, ...(old ?? []).filter((m) => m.local)]);
    setMore(page.length === 60);
    if (c.unread) markRead();
  }, [id, deviceId, me?.id, markRead]);

  const older = useCallback(async () => {
    if (loadingOlder.current || !more || !msgs?.length) return false;
    loadingOlder.current = true;
    const el = scroller.current;
    const before = el ? el.scrollHeight - el.scrollTop : 0;
    try {
      const oldest = msgs.find((m) => !m.local);
      if (!oldest) return false;
      const page = await api<Message[]>(`/chat/conversations/${id}/messages?limit=60&before=${oldest.id}`);
      setMore(page.length === 60);
      setMsgs((list) => [...[...page].reverse(), ...(list ?? [])]);
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight - before;
      });
      return page.length > 0;
    } finally {
      loadingOlder.current = false;
    }
  }, [id, more, msgs]);

  useEffect(() => {
    setMsgs(null);
    setConv(null);
    void load().catch(() => setMsgs([]));
    const off = realtime?.on((m: ServerMessage) => {
      if (m.type === 'chat.presence')
        return setConv((c) =>
          c
            ? {
                ...c,
                members: c.members.map((p) =>
                  p.id === m.userId ? { ...p, online: m.online, lastSeenAt: m.lastSeenAt } : p,
                ),
              }
            : c,
        );
      if (!('conversationId' in m) || m.conversationId !== id) return;
      if (m.type === 'chat.message') {
        if (m.message) {
          upsert(m.message as Message);
          if ((m.message as Message).senderId !== me?.id) {
            setTyping((t) => t.filter((u) => u !== (m.message as Message).senderId));
            if (document.visibilityState === 'visible') markRead();
          }
        } else void load();
      }
      if (m.type === 'chat.hidden') setMsgs((l) => l?.filter((x) => x.id !== m.messageId) ?? l);
      if (m.type === 'chat.changed') void load();
      if (m.type === 'chat.read' || m.type === 'chat.delivered')
        setConv((c) =>
          c
            ? {
                ...c,
                members: c.members.map((p) =>
                  p.id === m.userId
                    ? m.type === 'chat.read'
                      ? { ...p, lastReadAt: m.at, lastDeliveredAt: m.at }
                      : { ...p, lastDeliveredAt: m.at }
                    : p,
                ),
              }
            : c,
        );
      if (m.type === 'chat.typing') {
        setTyping((t) => (t.includes(m.userId) ? t : [...t, m.userId]));
        setTimeout(() => setTyping((t) => t.filter((u) => u !== m.userId)), 4000);
      }
    });
    const seen = () => document.visibilityState === 'visible' && markRead();
    document.addEventListener('visibilitychange', seen);
    return () => {
      off?.();
      document.removeEventListener('visibilitychange', seen);
    };
  }, [id, load, upsert, markRead, me?.id]);

  // stay at the bottom as lines arrive, unless reading further up; count what arrives below
  const count = msgs?.length ?? 0;
  const lastId = msgs?.[count - 1]?.id;
  const firstLoad = useRef(true);
  useEffect(() => {
    const el = scroller.current;
    if (!el || !count) return;
    if (firstLoad.current) {
      firstLoad.current = false;
      const u = firstUnread && document.getElementById(`m-${firstUnread}`);
      if (u) u.scrollIntoView({ block: 'center' });
      else el.scrollTop = el.scrollHeight;
      return;
    }
    const last = msgs![count - 1]!;
    if (atBottom || last.senderId === me?.id) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    else setBelow((n) => n + 1);
  }, [lastId]);
  useEffect(() => {
    firstLoad.current = true;
  }, [id]);

  const name = useCallback(
    (uid: string) => {
      if (uid === me?.id) return 'You';
      const m = conv?.members.find((x) => x.id === uid);
      return m ? display(m) : 'Someone';
    },
    [conv, me?.id],
  );

  // search inside the chat
  useEffect(() => {
    if (!searching || q.trim().length < 2) return setHits(null);
    const t = setTimeout(
      () =>
        void api<Message[]>(`/chat/conversations/${id}/search?q=${encodeURIComponent(q.trim())}`)
          .then(setHits)
          .catch(() => setHits([])),
      250,
    );
    return () => clearTimeout(t);
  }, [q, searching, id]);

  const jump = useCallback(
    async (mid: string) => {
      for (let i = 0; i < 25 && !document.getElementById(`m-${mid}`); i++) {
        if (!(await older())) break;
        await new Promise((r) => setTimeout(r, 60));
      }
      document.getElementById(`m-${mid}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      setFlash(mid);
      setTimeout(() => setFlash((f) => (f === mid ? null : f)), 1600);
    },
    [older],
  );

  const deliver = useCallback(
    async (mid: string) => {
      const p = pending.current.get(mid);
      if (!p || !me) return;
      upsert({
        ...(msgs?.find((m) => m.id === mid) ?? optimistic(id, me.id, p.draft, mid)),
        local: 'sending',
      });
      try {
        let draft = p.draft;
        if (p.files?.length) {
          const uploaded = await Promise.all(p.files.map(uploadAttachment));
          draft = { ...draft, attachments: uploaded };
          pending.current.set(mid, { draft });
        }
        const saved = await sendMessage(id, mid, draft);
        pending.current.delete(mid);
        upsert(saved);
      } catch (e) {
        upsert({
          ...(msgs?.find((m) => m.id === mid) ?? optimistic(id, me.id, p.draft, mid)),
          local: 'failed',
        });
        if (e instanceof ApiError && e.status < 500) toast({ title: e.message, tone: 'danger' });
      }
    },
    [id, me, msgs, toast, upsert],
  );

  if (!conv || !msgs) return <SkeletonRows rows={7} label="Opening the chat" />;

  const others = conv.members.filter((m) => m.id !== me?.id);
  const other = conv.kind === 'direct' ? others[0] : null;
  const tick = (m: Message): 'sending' | 'failed' | 'sent' | 'delivered' | 'read' => {
    if (m.local) return m.local;
    if (!others.length) return 'sent';
    if (others.every((p) => p.lastReadAt && p.lastReadAt >= m.createdAt)) return 'read';
    if (others.every((p) => (p.lastDeliveredAt && p.lastDeliveredAt >= m.createdAt) || p.online))
      return 'delivered';
    return 'sent';
  };

  const submit = async () => {
    const t = text.trim();
    if (editing) {
      if (!t) return;
      const target = editing;
      setEditing(null);
      setText('');
      upsert({ ...target, text: t, editedAt: new Date().toISOString() });
      try {
        upsert(await api<Message>(`/chat/messages/${target.id}`, { method: 'PATCH', body: { text: t } }));
      } catch {
        upsert(target);
        toast({ title: 'Couldn’t edit that', tone: 'danger' });
      }
      return;
    }
    if (!t && !files.length) return;
    const draft: Draft = { text: t, replyTo: reply?.id ?? null };
    const sending = files;
    const local = optimistic(id, me!.id, draft);
    local.replyTo = reply
      ? {
          id: reply.id,
          senderId: reply.senderId,
          text: reply.text ?? '',
          attachment: attachmentLabel(reply.attachments),
          deleted: false,
        }
      : null;
    local.attachments = sending.map((f, i) => {
      const fileId = `local-${local.id}-${i}`;
      localUrls.current.set(fileId, URL.createObjectURL(f));
      return { fileId, name: f.name, mime: f.type || 'application/octet-stream', size: f.size };
    });
    pending.current.set(local.id, { draft, files: sending });
    setText('');
    setFiles([]);
    setReply(null);
    upsert(local);
    setAtBottom(true);
    box.current?.focus();
    await deliver(local.id);
  };

  const react = async (m: Message, emoji: string) => {
    setMenu(null);
    const mine = m.reactions.find((r) => r.by.includes(me!.id))?.emoji === emoji;
    const without = m.reactions
      .map((r) => ({ ...r, by: r.by.filter((u) => u !== me!.id) }))
      .filter((r) => r.by.length);
    upsert({
      ...m,
      reactions: mine
        ? without
        : without.some((r) => r.emoji === emoji)
          ? without.map((r) => (r.emoji === emoji ? { ...r, by: [...r.by, me!.id] } : r))
          : [...without, { emoji, by: [me!.id] }],
    });
    await api(`/chat/messages/${m.id}/reaction`, {
      method: 'PUT',
      body: { emoji: mine ? null : emoji },
    }).catch(() => upsert(m));
  };

  const addFiles = (list: FileList | File[] | null) => {
    const add = [...(list ?? [])].slice(0, 10 - files.length);
    if (add.some((f) => f.size > 25 * 1024 * 1024))
      toast({ title: 'Files can be up to 25 MB', tone: 'danger' });
    setFiles((f) => [...f, ...add.filter((x) => x.size <= 25 * 1024 * 1024)]);
  };

  const status =
    typing.length && conv.kind === 'direct'
      ? 'typing…'
      : typing.length
        ? `${typing.map(name).join(', ')} ${typing.length > 1 ? 'are' : 'is'} typing…`
        : other
          ? other.online
            ? 'online'
            : lastSeen(other.lastSeenAt)
          : `${conv.members.length} people · ${others.filter((p) => p.online).length} online`;

  let prevDay = '';
  return (
    <section
      aria-label={conv.title}
      className="glass-pane relative flex h-full min-h-0 flex-col overflow-hidden"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        addFiles(e.dataTransfer.files);
      }}
    >
      <header className="flex items-center gap-3 border-b border-orv-edge px-4 py-2.5">
        <button
          type="button"
          onClick={() => setInfo(true)}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <Face c={conv} size={40} />
          <span className="min-w-0">
            <h1 className="truncate text-[15.5px] font-semibold">{conv.title}</h1>
            <p
              className={cn(
                'truncate text-[12px]',
                typing.length || other?.online ? 'text-orv-accent' : 'text-orv-muted',
              )}
            >
              {status}
            </p>
          </span>
        </button>
        {conv.splitGroupId ? (
          <Link href={`/split/${conv.splitGroupId}`} className="text-[13px] text-orv-accent hover:underline">
            Split
          </Link>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          aria-label="Search in this chat"
          onClick={() => setSearching((s) => !s)}
        >
          <Search size={16} />
        </Button>
        <Button size="sm" variant="ghost" aria-label="Chat details" onClick={() => setInfo(true)}>
          <Info size={16} />
        </Button>
      </header>

      <AnimatePresence initial={false}>
        {searching ? (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="relative z-20 border-b border-orv-edge px-4 py-2"
          >
            <label className="flex items-center gap-2 rounded-full field-ring px-3 py-1.5 focus-within:border-orv-accent">
              <Search size={14} className="text-orv-faint" />
              <input
                autoFocus
                aria-label="Search messages"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search messages"
                className="min-w-0 flex-1 bg-transparent text-[13.5px] outline-none"
              />
              <button type="button" aria-label="Close search" onClick={() => (setSearching(false), setQ(''))}>
                <X size={14} />
              </button>
            </label>
            {hits ? (
              <ul className="glass-float edge-light absolute inset-x-4 top-full mt-1 max-h-72 overflow-y-auto rounded-[14px] p-1 shadow-lg">
                {!hits.length ? (
                  <li className="px-3 py-2 text-[13px] text-orv-muted">Nothing found.</li>
                ) : null}
                {hits.map((h) => (
                  <li key={h.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSearching(false);
                        setQ('');
                        void jump(h.id);
                      }}
                      className="w-full rounded-[10px] px-3 py-2 text-left hover:bg-orv-track"
                    >
                      <span className="flex text-[11.5px] text-orv-muted">
                        <span className="flex-1">{name(h.senderId)}</span>
                        {when(h.createdAt)}
                      </span>
                      <span className="line-clamp-2 text-[13.5px]">
                        <Highlight text={h.text || attachmentLabel(h.attachments) || ''} q={q.trim()} />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </motion.div>
        ) : null}
      </AnimatePresence>

      {conv.pinnedMessage ? (
        <button
          type="button"
          onClick={() => void jump(conv.pinnedMessage!.id)}
          className="flex items-center gap-2.5 border-b border-orv-edge bg-[color-mix(in_srgb,var(--orv-accent)_6%,transparent)] px-4 py-2 text-left"
        >
          <Pin size={14} className="shrink-0 text-orv-accent" />
          <span className="min-w-0 flex-1">
            <span className="block text-[11px] font-semibold text-orv-accent">Pinned</span>
            <span className="block truncate text-[13px]">
              {[conv.pinnedMessage.attachment, conv.pinnedMessage.text].filter(Boolean).join(' ')}
            </span>
          </span>
        </button>
      ) : null}

      <div
        ref={scroller}
        role="log"
        aria-label="Messages"
        onScroll={(e) => {
          const el = e.currentTarget;
          const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          setAtBottom(bottom);
          if (bottom) setBelow(0);
          if (el.scrollTop < 120) void older();
        }}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-3 sm:px-5"
      >
        {more ? (
          <p className="py-2 text-center text-[11.5px] text-orv-faint">Scroll up for earlier messages</p>
        ) : null}
        {!msgs.length ? (
          <div className="m-auto flex flex-col items-center gap-2 text-center">
            <span className="text-[34px]">👋</span>
            <p className="text-small text-orv-muted">Say hello to {conv.title}.</p>
          </div>
        ) : null}
        {msgs.map((m, i) => {
          const day = dayLabel(m.createdAt);
          const sep = day !== prevDay ? ((prevDay = day), day) : null;
          const prev = msgs[i - 1];
          const next = msgs[i + 1];
          const mine = m.senderId === me?.id;
          const joinPrev =
            !sep &&
            prev &&
            prev.kind === 'msg' &&
            prev.senderId === m.senderId &&
            new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < GROUP_MS;
          const joinNext =
            next &&
            next.kind === 'msg' &&
            next.senderId === m.senderId &&
            dayLabel(next.createdAt) === day &&
            new Date(next.createdAt).getTime() - new Date(m.createdAt).getTime() < GROUP_MS;
          const photos = m.attachments.filter((a) => a.mime.startsWith('image/'));
          const docs = m.attachments.filter((a) => !a.mime.startsWith('image/'));
          const gone = !!m.deletedAt;
          const sealed = m.v === 1 && !gone;
          const onlyEmoji =
            !!m.text && !m.attachments.length && /^(\p{Extended_Pictographic}|\s|‍|️){1,8}$/u.test(m.text);
          return (
            <Fragment key={m.id}>
              {sep ? (
                <div className="sticky top-0 z-10 my-2 flex justify-center">
                  <span className="glass-float rounded-full px-3 py-0.5 text-[11.5px] text-orv-muted">
                    {sep}
                  </span>
                </div>
              ) : null}
              {m.id === firstUnread ? (
                <div className="my-2 flex items-center gap-3 text-[11.5px] font-semibold text-orv-accent">
                  <span className="h-px flex-1 bg-orv-accent/40" /> New messages{' '}
                  <span className="h-px flex-1 bg-orv-accent/40" />
                </div>
              ) : null}
              {m.kind === 'system' ? (
                <p
                  id={`m-${m.id}`}
                  className="my-1.5 self-center rounded-full bg-orv-track px-3 py-1 text-center text-[12px] text-orv-muted"
                >
                  {m.text}
                </p>
              ) : (
                <motion.div
                  id={`m-${m.id}`}
                  layout="position"
                  initial={m.local ? { opacity: 0, y: 8, scale: 0.98 } : false}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={spring.snappy}
                  className={cn(
                    'group relative flex items-end gap-2',
                    mine ? 'flex-row-reverse' : '',
                    joinPrev ? 'mt-0.5' : 'mt-2.5',
                  )}
                >
                  {conv.kind === 'group' && !mine ? (
                    <span className="w-7 shrink-0">
                      {!joinNext ? (
                        <span className="grid h-7 w-7 place-items-center rounded-full bg-orv-track text-[11px] font-semibold">
                          {name(m.senderId).slice(0, 1).toUpperCase()}
                        </span>
                      ) : null}
                    </span>
                  ) : null}
                  <div
                    data-testid="bubble"
                    onDoubleClick={() => !gone && !sealed && void react(m, '❤️')}
                    className={cn(
                      'relative max-w-[min(78%,34rem)] text-[14.5px] leading-snug transition-shadow',
                      onlyEmoji ? 'px-1 text-[34px] leading-tight' : 'rounded-[20px] px-3 py-2',
                      !onlyEmoji &&
                        (mine ? 'bg-[image:var(--orv-accent-grad)] text-white shadow-sm' : 'bg-orv-track'),
                      !onlyEmoji && mine && joinPrev && 'rounded-tr-[6px]',
                      !onlyEmoji && mine && joinNext && 'rounded-br-[6px]',
                      !onlyEmoji && !mine && joinPrev && 'rounded-tl-[6px]',
                      !onlyEmoji && !mine && joinNext && 'rounded-bl-[6px]',
                      photos.length > 0 && !m.text && !onlyEmoji && 'p-1',
                      flash === m.id && 'ring-2 ring-orv-accent ring-offset-2 ring-offset-transparent',
                      m.reactions.length > 0 && 'mb-3',
                    )}
                  >
                    {conv.kind === 'group' && !mine && !joinPrev && !onlyEmoji ? (
                      <p
                        className={cn(
                          'mb-0.5 text-[12px] font-semibold text-orv-accent',
                          photos.length > 0 && !m.text && 'px-2 pt-1',
                        )}
                      >
                        {name(m.senderId)}
                      </p>
                    ) : null}
                    {m.forwarded ? (
                      <p
                        className={cn(
                          'mb-0.5 flex items-center gap-1 text-[11.5px] italic',
                          mine ? 'text-white/75' : 'text-orv-muted',
                        )}
                      >
                        <Forward size={11} /> Forwarded
                      </p>
                    ) : null}
                    {m.replyTo ? (
                      <button
                        type="button"
                        onClick={() => void jump(m.replyTo!.id)}
                        className={cn(
                          'mb-1 block w-full rounded-[10px] border-l-[3px] px-2 py-1 text-left text-[12.5px]',
                          mine ? 'border-white/70 bg-white/15' : 'border-orv-accent bg-orv-base/60',
                        )}
                      >
                        <span className={cn('block font-semibold', mine ? 'text-white' : 'text-orv-accent')}>
                          {name(m.replyTo.senderId)}
                        </span>
                        <span className={cn('line-clamp-2', mine ? 'text-white/85' : 'text-orv-muted')}>
                          {m.replyTo.deleted
                            ? 'Deleted message'
                            : [m.replyTo.attachment, m.replyTo.text].filter(Boolean).join(' ')}
                        </span>
                      </button>
                    ) : null}
                    {gone ? (
                      <span
                        className={cn(
                          'flex items-center gap-1.5 italic',
                          mine ? 'text-white/80' : 'text-orv-muted',
                        )}
                      >
                        <Trash2 size={13} /> {mine ? 'You deleted this message' : 'This message was deleted'}
                      </span>
                    ) : sealed ? (
                      <span className={cn('italic', mine ? 'text-white/80' : 'text-orv-muted')}>
                        An older private message. Open this chat once on the device it was sent to and it
                        comes over.
                      </span>
                    ) : (
                      <div className="flex flex-col gap-1">
                        {photos.length ? (
                          <div className={cn('grid gap-1', photos.length > 1 && 'grid-cols-2')}>
                            {photos.slice(0, 4).map((a, k) => (
                              <div key={a.fileId} className="relative">
                                <Photo conversationId={id} a={a} local={localUrls.current.get(a.fileId)} />
                                {k === 3 && photos.length > 4 ? (
                                  <span className="absolute inset-0 grid place-items-center rounded-[14px] bg-black/50 text-[20px] font-semibold text-white">
                                    +{photos.length - 4}
                                  </span>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        ) : null}
                        {docs.map((a) => (
                          <FileCard key={a.fileId} conversationId={id} a={a} mine={mine} />
                        ))}
                        {m.share ? <Share s={m.share} mine={mine} /> : null}
                        {m.text ? (
                          <span
                            className={cn(
                              'whitespace-pre-wrap break-words',
                              photos.length > 0 && 'px-2 pb-0.5',
                            )}
                          >
                            <Linked text={m.text} mine={mine && !onlyEmoji} />
                          </span>
                        ) : null}
                      </div>
                    )}
                    <span
                      className={cn(
                        'mt-0.5 flex items-center justify-end gap-1 text-[10.5px]',
                        onlyEmoji ? 'text-orv-faint' : mine ? 'text-white/75' : 'text-orv-faint',
                        photos.length > 0 && !m.text && 'px-2 pb-1',
                      )}
                    >
                      {m.editedAt ? 'edited · ' : ''}
                      {time(m.createdAt)}
                      {mine && !gone ? <Ticks state={tick(m)} /> : null}
                    </span>
                    {m.reactions.length ? (
                      <span className={cn('absolute -bottom-3.5 flex gap-0.5', mine ? 'right-2' : 'left-2')}>
                        {m.reactions.map((r) => (
                          <button
                            key={r.emoji}
                            type="button"
                            title={r.by.map(name).join(', ')}
                            onClick={() => void react(m, r.emoji)}
                            className={cn(
                              'glass-float flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[12px] text-orv-text shadow-sm',
                              r.by.includes(me!.id) && 'ring-1 ring-orv-accent',
                            )}
                          >
                            {r.emoji}
                            {r.by.length > 1 ? (
                              <span className="text-[10.5px] text-orv-muted">{r.by.length}</span>
                            ) : null}
                          </button>
                        ))}
                      </span>
                    ) : null}
                  </div>
                  {m.local === 'failed' ? (
                    <button
                      type="button"
                      onClick={() => void deliver(m.id)}
                      className="flex items-center gap-1 self-center rounded-full bg-[color-mix(in_srgb,var(--orv-danger)_12%,transparent)] px-2 py-1 text-[12px] text-orv-danger"
                    >
                      <RotateCw size={12} /> Retry
                    </button>
                  ) : !gone && !sealed && !m.local ? (
                    <div
                      className={cn(
                        'relative flex gap-0.5 self-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100',
                        menu?.id === m.id && 'opacity-100',
                      )}
                    >
                      <button
                        type="button"
                        aria-label="React"
                        className="rounded-full p-1.5 text-orv-muted hover:bg-orv-track"
                        onClick={() => setMenu({ id: m.id, kind: 'react' })}
                      >
                        <SmilePlus size={15} />
                      </button>
                      <button
                        type="button"
                        aria-label="Reply"
                        className="rounded-full p-1.5 text-orv-muted hover:bg-orv-track"
                        onClick={() => {
                          setReply(m);
                          setEditing(null);
                          box.current?.focus();
                        }}
                      >
                        <CornerUpLeft size={15} />
                      </button>
                      <button
                        type="button"
                        aria-label="More"
                        className="rounded-full p-1.5 text-orv-muted hover:bg-orv-track"
                        onClick={() => setMenu({ id: m.id, kind: 'more' })}
                      >
                        <MoreHorizontal size={15} />
                      </button>
                      <AnimatePresence>
                        {menu?.id === m.id && menu.kind === 'react' ? (
                          <Popover
                            onClose={() => setMenu(null)}
                            className={cn('bottom-9 w-[15.5rem]', mine ? 'right-0' : 'left-0')}
                          >
                            <div className="flex justify-between">
                              {QUICK.map((e) => (
                                <button
                                  key={e}
                                  type="button"
                                  aria-label={`React ${e}`}
                                  onClick={() => void react(m, e)}
                                  className="rounded-full p-1 text-[22px] transition-transform hover:scale-125"
                                >
                                  {e}
                                </button>
                              ))}
                            </div>
                            <div className="mt-1 grid grid-cols-9 border-t border-orv-edge pt-1">
                              {MORE.map((e) => (
                                <button
                                  key={e}
                                  type="button"
                                  aria-label={`React ${e}`}
                                  onClick={() => void react(m, e)}
                                  className="rounded-md p-0.5 text-[17px] hover:bg-orv-track"
                                >
                                  {e}
                                </button>
                              ))}
                            </div>
                          </Popover>
                        ) : null}
                        {menu?.id === m.id && menu.kind === 'more' ? (
                          <Popover
                            onClose={() => setMenu(null)}
                            className={cn('bottom-9 w-52', mine ? 'right-0' : 'left-0')}
                          >
                            {m.text ? (
                              <MenuItem
                                icon={<Copy size={14} />}
                                label="Copy"
                                onClick={() => {
                                  setMenu(null);
                                  void navigator.clipboard.writeText(m.text!);
                                  toast({ title: 'Copied' });
                                }}
                              />
                            ) : null}
                            <MenuItem
                              icon={<CornerUpRight size={14} />}
                              label="Forward"
                              onClick={() => {
                                setMenu(null);
                                setForward(m);
                              }}
                            />
                            <MenuItem
                              icon={
                                conv.pinnedMessage?.id === m.id ? <PinOff size={14} /> : <Pin size={14} />
                              }
                              label={conv.pinnedMessage?.id === m.id ? 'Unpin' : 'Pin'}
                              onClick={async () => {
                                setMenu(null);
                                setConv(
                                  await api<ConversationView>(`/chat/conversations/${id}/pin`, {
                                    method: 'PUT',
                                    body: { messageId: conv.pinnedMessage?.id === m.id ? null : m.id },
                                  }),
                                );
                              }}
                            />
                            {mine && m.text && !m.forwarded ? (
                              <MenuItem
                                icon={<Pencil size={14} />}
                                label="Edit"
                                onClick={() => {
                                  setMenu(null);
                                  setEditing(m);
                                  setReply(null);
                                  setText(m.text ?? '');
                                  box.current?.focus();
                                }}
                              />
                            ) : null}
                            <MenuItem
                              icon={<EyeOff size={14} />}
                              label="Delete for me"
                              onClick={async () => {
                                setMenu(null);
                                setMsgs((l) => l?.filter((x) => x.id !== m.id) ?? l);
                                await api(`/chat/messages/${m.id}/hide`, { method: 'POST' });
                              }}
                            />
                            {mine ? (
                              <MenuItem
                                danger
                                icon={<Trash2 size={14} />}
                                label="Delete for everyone"
                                onClick={async () => {
                                  setMenu(null);
                                  if (!window.confirm('Delete this message for everyone?')) return;
                                  upsert({
                                    ...m,
                                    deletedAt: new Date().toISOString(),
                                    text: null,
                                    attachments: [],
                                    reactions: [],
                                  });
                                  await api(`/chat/messages/${m.id}`, { method: 'DELETE' });
                                }}
                              />
                            ) : null}
                          </Popover>
                        ) : null}
                      </AnimatePresence>
                    </div>
                  ) : null}
                </motion.div>
              )}
            </Fragment>
          );
        })}
        {typing.length ? (
          <div
            className="mt-2 flex items-center gap-1 self-start rounded-[20px] bg-orv-track px-3.5 py-2.5"
            aria-label="typing"
          >
            {[0, 1, 2].map((k) => (
              <motion.span
                key={k}
                className="h-1.5 w-1.5 rounded-full bg-orv-muted"
                animate={{ y: [0, -3, 0], opacity: [0.5, 1, 0.5] }}
                transition={{ repeat: Infinity, duration: 0.9, delay: k * 0.15 }}
              />
            ))}
          </div>
        ) : null}
      </div>

      <AnimatePresence>
        {!atBottom ? (
          <motion.button
            type="button"
            aria-label="Jump to the latest"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            onClick={() =>
              scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' })
            }
            className="glass-float edge-light absolute bottom-24 right-5 z-20 grid h-10 w-10 place-items-center rounded-full shadow-lg"
          >
            <ArrowDown size={17} />
            {below ? (
              <span className="absolute -top-1.5 -right-1 grid h-5 min-w-5 place-items-center rounded-full bg-orv-accent px-1 text-[10.5px] font-semibold text-white">
                {below}
              </span>
            ) : null}
          </motion.button>
        ) : null}
      </AnimatePresence>

      <footer className="border-t border-orv-edge p-2.5 sm:p-3">
        <AnimatePresence initial={false}>
          {reply || editing ? (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="mb-2 flex items-center gap-2 rounded-[14px] border-l-[3px] border-orv-accent bg-orv-track px-3 py-1.5"
            >
              {editing ? (
                <Pencil size={14} className="text-orv-accent" />
              ) : (
                <CornerUpLeft size={14} className="text-orv-accent" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block text-[12px] font-semibold text-orv-accent">
                  {editing ? 'Editing your message' : `Replying to ${name(reply!.senderId)}`}
                </span>
                <span className="block truncate text-[12.5px] text-orv-muted">
                  {[attachmentLabel((editing ?? reply)!.attachments), (editing ?? reply)!.text]
                    .filter(Boolean)
                    .join(' ')}
                </span>
              </span>
              <button
                type="button"
                aria-label="Cancel"
                onClick={() => {
                  if (editing) setText('');
                  setReply(null);
                  setEditing(null);
                }}
              >
                <X size={15} />
              </button>
            </motion.div>
          ) : null}
        </AnimatePresence>
        {files.length ? (
          <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
            {files.map((f, i) => (
              <div key={`${f.name}-${i}`} className="relative shrink-0">
                {f.type.startsWith('image/') ? (
                  <img
                    src={URL.createObjectURL(f)}
                    alt={f.name}
                    className="h-16 w-16 rounded-[12px] object-cover"
                  />
                ) : (
                  <span className="flex h-16 w-28 flex-col justify-center rounded-[12px] bg-orv-track px-2 text-[11.5px]">
                    <span className="truncate font-medium">{f.name}</span>
                    <span className="text-orv-muted">{bytes(f.size)}</span>
                  </span>
                )}
                <button
                  type="button"
                  aria-label={`Remove ${f.name}`}
                  onClick={() => setFiles((x) => x.filter((_, k) => k !== i))}
                  className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-orv-text text-orv-base"
                >
                  <X size={11} />
                </button>
              </div>
            ))}
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
            multiple
            hidden
            onChange={(e) => (addFiles(e.target.files), (e.target.value = ''))}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="Attach photos or files"
            onClick={() => fileInput.current?.click()}
          >
            <Paperclip size={17} />
          </Button>
          <textarea
            ref={box}
            aria-label="Message"
            rows={1}
            value={text}
            placeholder={files.length ? 'Add a caption' : 'Message'}
            onPaste={(e) => {
              const pasted = [...e.clipboardData.files];
              if (pasted.length) {
                e.preventDefault();
                addFiles(pasted);
              }
            }}
            onChange={(e) => {
              setText(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
              if (Date.now() - lastTyping.current > 3000 && e.target.value) {
                lastTyping.current = Date.now();
                void api(`/chat/conversations/${id}/typing`, { method: 'POST' }).catch(() => undefined);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void submit();
              }
              if (e.key === 'Escape') {
                setReply(null);
                if (editing) {
                  setEditing(null);
                  setText('');
                }
              }
              if (e.key === 'ArrowUp' && !text) {
                const lastMine = [...msgs]
                  .reverse()
                  .find((x) => x.senderId === me?.id && x.text && !x.deletedAt && !x.local);
                if (lastMine) {
                  e.preventDefault();
                  setEditing(lastMine);
                  setText(lastMine.text ?? '');
                }
              }
            }}
            className="max-h-40 min-h-10 flex-1 resize-none rounded-[22px] field-ring px-4 py-2.5 text-[14.5px] outline-none focus:border-orv-accent"
          />
          <motion.button
            type="submit"
            aria-label={editing ? 'Save edit' : 'Send'}
            whileTap={{ scale: 0.9 }}
            disabled={!text.trim() && !files.length}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[image:var(--orv-accent-grad)] text-white shadow-sm transition-opacity disabled:opacity-40"
          >
            {editing ? <Check size={18} /> : <ArrowUp size={18} />}
          </motion.button>
        </form>
      </footer>

      {dragging ? (
        <div className="pointer-events-none absolute inset-2 z-40 grid place-items-center rounded-[20px] border-2 border-dashed border-orv-accent bg-[color-mix(in_srgb,var(--orv-accent)_10%,transparent)] text-[15px] font-semibold text-orv-accent">
          Drop to send in {conv.title}
        </div>
      ) : null}
      {info ? (
        <InfoSheet
          conv={conv}
          msgs={msgs}
          onClose={() => setInfo(false)}
          onChanged={load}
          onLeft={() => router.push('/chat')}
        />
      ) : null}
      {forward ? <ForwardSheet message={forward} onClose={() => setForward(null)} /> : null}
    </section>
  );
}

function ForwardSheet({ message, onClose }: { message: Message; onClose(): void }) {
  const toast = useToast();
  const { list } = useConversations();
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  return (
    <Sheet
      open
      onClose={onClose}
      title="Forward to…"
      subtitle={[attachmentLabel(message.attachments), message.text].filter(Boolean).join(' ').slice(0, 120)}
      footer={
        <Button
          variant="primary"
          loading={busy}
          disabled={!chosen.size}
          onClick={async () => {
            setBusy(true);
            try {
              for (const c of chosen)
                await sendMessage(c, crypto.randomUUID(), { text: '', forwardOf: message.id });
              toast({
                title: chosen.size === 1 ? 'Forwarded' : `Forwarded to ${chosen.size} chats`,
                tone: 'success',
              });
              onClose();
            } catch (e) {
              toast({ title: e instanceof ApiError ? e.message : 'Couldn’t forward it', tone: 'danger' });
            } finally {
              setBusy(false);
            }
          }}
        >
          <Forward size={14} /> Send
        </Button>
      }
    >
      {list === null ? (
        <SkeletonRows rows={3} label="Loading chats" />
      ) : (
        <ul className="flex flex-col">
          {list.map((c) => {
            const on = chosen.has(c.id);
            return (
              <li key={c.id}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    setChosen((s) => {
                      const n = new Set(s);
                      if (on) n.delete(c.id);
                      else n.add(c.id);
                      return n;
                    })
                  }
                  className="flex w-full items-center gap-3 rounded-orv-md px-2 py-2 text-left hover:bg-orv-track"
                >
                  <Face c={c} size={36} />
                  <span className="flex-1 truncate text-[14px] font-medium">{c.title}</span>
                  <span
                    className={cn(
                      'grid h-5 w-5 place-items-center rounded-full border',
                      on ? 'border-orv-accent bg-orv-accent text-white' : 'border-orv-edge',
                    )}
                  >
                    {on ? <Check size={12} /> : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Sheet>
  );
}

function InfoSheet({
  conv,
  msgs,
  onClose,
  onChanged,
  onLeft,
}: {
  conv: ConversationView;
  msgs: Message[];
  onClose(): void;
  onChanged(): Promise<void>;
  onLeft(): void;
}) {
  const { me } = useSession();
  const toast = useToast();
  const [title, setTitle] = useState(conv.title);
  const [people, setPeople] = useState<Person[]>([]);
  const admin = conv.kind === 'group' && conv.adminId === me?.id;
  useEffect(() => {
    if (admin) void api<Person[]>('/chat/people').then(setPeople);
  }, [admin]);
  const outside = people.filter((p) => !conv.members.some((m) => m.id === p.id));
  const media = useMemo(
    () =>
      msgs
        .flatMap((m) => (m.deletedAt ? [] : m.attachments.filter((a) => a.mime.startsWith('image/'))))
        .slice(-9)
        .reverse(),
    [msgs],
  );
  const lastMine = [...msgs].reverse().find((m) => m.senderId === me?.id && m.kind === 'msg' && !m.local);
  return (
    <Sheet
      open
      onClose={onClose}
      title={conv.title}
      subtitle={conv.kind === 'group' ? `${conv.members.length} people` : 'Direct chat'}
    >
      <div className="flex flex-col gap-5">
        {admin ? (
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Field label="Group name">
                {(fid) => <Input id={fid} value={title} onChange={(e) => setTitle(e.target.value)} />}
              </Field>
            </div>
            <Button
              variant="ghost"
              disabled={!title.trim() || title === conv.title}
              onClick={async () => {
                await api(`/chat/conversations/${conv.id}/title`, { method: 'PUT', body: { title } });
                await onChanged();
              }}
            >
              Rename
            </Button>
          </div>
        ) : null}
        <div className="glass-pane divide-y divide-orv-edge rounded-orv-md">
          <div className="flex items-center gap-3 px-3 py-2.5">
            <BellOff size={16} className="text-orv-muted" />
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
          <div className="flex items-center gap-3 px-3 py-2.5">
            <Pin size={16} className="text-orv-muted" />
            <span className="flex-1 text-[14px]">Pin to the top of Chats</span>
            <Switch
              label="Pin chat"
              checked={conv.pinned}
              onChange={async (v) => {
                await api(`/chat/conversations/${conv.id}/pinned`, { method: 'PUT', body: { pinned: v } });
                await onChanged();
              }}
            />
          </div>
        </div>
        {media.length ? (
          <div>
            <Label className="mb-2 block">Photos</Label>
            <div className="grid grid-cols-3 gap-1.5">
              {media.map((a) => (
                <Photo key={a.fileId} conversationId={conv.id} a={{ ...a, w: 1, h: 1 }} />
              ))}
            </div>
          </div>
        ) : null}
        <div>
          <Label className="mb-2 block">People</Label>
          <ul className="flex flex-col gap-1">
            {conv.members.map((m) => {
              const read = lastMine && m.id !== me?.id && m.lastReadAt && m.lastReadAt >= lastMine.createdAt;
              return (
                <li key={m.id} className="flex items-center gap-3 rounded-orv-md px-1 py-1.5">
                  <span className="relative grid h-9 w-9 shrink-0 place-items-center rounded-full bg-orv-track text-[13px] font-semibold">
                    {display(m).slice(0, 1).toUpperCase()}
                    {m.online && m.id !== me?.id ? (
                      <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-[var(--orv-base)] bg-orv-success" />
                    ) : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-[14px] font-medium">
                      {m.id === me?.id ? 'You' : display(m)}
                      {m.id === conv.adminId ? <Badge>admin</Badge> : null}
                    </span>
                    <span className="block text-[12px] text-orv-muted">
                      {m.id === me?.id ? m.email : m.online ? 'online' : lastSeen(m.lastSeenAt)}
                      {read ? ' · read your last message' : ''}
                    </span>
                  </span>
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
              );
            })}
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
        <p className="text-[12px] text-orv-faint">
          Kept on ORVYN’s server, encrypted at rest, so it’s on every device you sign in to.
        </p>
        {conv.kind === 'group' ? (
          <Button
            variant="ghost"
            className="text-orv-danger"
            onClick={async () => {
              if (!window.confirm('Leave this group?')) return;
              await api(`/chat/conversations/${conv.id}/members/${me!.id}`, { method: 'DELETE' });
              onLeft();
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
export function ShareToChat({ item, onClose }: { item: ChatShareRef; onClose(): void }) {
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
                className="flex w-full items-center gap-3 rounded-orv-md px-2 py-2 text-left text-[14px] hover:bg-orv-track"
                onClick={async () => {
                  await sendMessage(c.id, crypto.randomUUID(), { text: '', share: item });
                  toast({ title: `Shared in ${c.title}`, tone: 'success' });
                  onClose();
                }}
              >
                <Face c={c} size={34} />
                {c.title}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}

'use client';

import type { AssistantMessageView, AssistantProposalView, AssistantThreadView } from '@orvyn/contracts';
import {
  ArrowUp,
  CalendarPlus,
  Check,
  CheckCircle2,
  FileText,
  ListPlus,
  Mic,
  MoveRight,
  PanelLeft,
  Plus,
  Square,
  Trash2,
  Wallet,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Logo } from '@/components/logo';
import { Badge, SkeletonRows, useToast } from '@/components/ui/bits';
import { Orb } from '@/components/ui/orb';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { spring } from '@/lib/motion';
import { useSession } from '@/lib/session';
import { useVoice } from '@/lib/voice';

const SUGGESTIONS = [
  'What’s on tomorrow?',
  'How much did I spend on food this month?',
  'When does my insurance expire?',
  'Remind me to call mom at 6pm by alarm',
  'I spent 240 on lunch at Swiggy',
];

const ICON: Record<string, typeof Check> = {
  create_task: ListPlus,
  move_task: MoveRight,
  complete_task: CheckCircle2,
  create_event: CalendarPlus,
  add_expense: Wallet,
  save_note: FileText,
};

export default function AssistantPage() {
  return (
    <Suspense fallback={<SkeletonRows rows={3} />}>
      <Assistant />
    </Suspense>
  );
}

/**
 * The Assistant (spec 0005): ask about your day, money and papers; it answers from your own data with sources, and
 * anything it would change is a card you confirm. Conversations are kept; the Vault is never read.
 */
function Assistant() {
  const { me } = useSession();
  const toast = useToast();
  const router = useRouter();
  const params = useSearchParams();
  const [threads, setThreads] = useState<AssistantThreadView[] | null>(null);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AssistantMessageView[]>([]);
  const [loadingThread, setLoadingThread] = useState(false);
  const [text, setText] = useState('');
  const [thinking, setThinking] = useState<string | null>(null);
  const [showList, setShowList] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const asked = useRef(false);

  const loadThreads = useCallback(
    () =>
      api<AssistantThreadView[]>('/assistant/threads')
        .then(setThreads)
        .catch(() => setThreads([])),
    [],
  );
  useEffect(() => void loadThreads(), [loadThreads]);
  useEffect(() => {
    // (Chromium returns a promise from smooth scrolling: never hand it to React as a cleanup)
    void end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, thinking]);

  const open = async (id: string | null) => {
    setShowList(false);
    setThreadId(id);
    setMessages([]);
    if (!id) return;
    setLoadingThread(true);
    try {
      setMessages(await api<AssistantMessageView[]>(`/assistant/threads/${id}`));
    } finally {
      setLoadingThread(false);
    }
  };

  const send = useCallback(
    async (q: string) => {
      const t = q.trim();
      if (!t || thinking) return;
      setText('');
      setThinking(t);
      try {
        const r = await api<{ threadId: string; messages: AssistantMessageView[] }>('/assistant/ask', {
          method: 'POST',
          body: { text: t, ...(threadId ? { threadId } : {}) },
        });
        setThreadId(r.threadId);
        setMessages(r.messages);
        void loadThreads();
      } catch (e) {
        toast({ title: e instanceof ApiError ? e.message : 'The Assistant didn’t answer', tone: 'danger' });
        setText(t);
      } finally {
        setThinking(null);
      }
    },
    [thinking, threadId, loadThreads, toast],
  );

  // "Ask ORVYN …" from the command bar arrives as ?q=
  useEffect(() => {
    const q = params.get('q');
    if (q && !asked.current) {
      asked.current = true;
      router.replace('/assistant');
      void send(q);
    }
  }, [params, router, send]);

  const voice = useVoice({ onText: setText });

  const decide = async (m: AssistantMessageView, p: AssistantProposalView, confirm: boolean) => {
    const r = await api<AssistantMessageView>(
      `/assistant/messages/${m.id}/proposals/${p.index}/${confirm ? 'confirm' : 'dismiss'}`,
      { method: 'POST' },
    );
    setMessages((xs) => xs.map((x) => (x.id === r.id ? r : x)));
    const now = r.proposals[p.index];
    if (confirm && now?.status === 'done') toast({ title: 'Done', body: now.summary, tone: 'success' });
    if (now?.status === 'failed')
      toast({ title: 'That didn’t work', body: now.problem ?? undefined, tone: 'danger' });
  };

  const firstName = (me?.name || '').split(' ')[0];
  const empty = !messages.length && !thinking && !loadingThread;

  return (
    <div className="flex h-[calc(100dvh-7rem)] gap-4 lg:h-[calc(100dvh-3rem)]">
      {/* conversations */}
      <aside
        className={cn(
          'glass-pane flex w-64 shrink-0 flex-col gap-1 p-2',
          showList ? 'fixed inset-y-3 left-3 z-40 shadow-[var(--orv-shadow-big)]' : 'hidden xl:flex',
        )}
        aria-label="Conversations"
      >
        <button
          onClick={() => void open(null)}
          className="flex items-center gap-2 rounded-orv-md px-3 py-2 text-[14px] font-semibold hover:bg-orv-track"
        >
          <Plus size={16} aria-hidden /> New conversation
        </button>
        <div className="my-1 h-px bg-orv-hairline" />
        <ul className="flex flex-1 flex-col gap-0.5 overflow-y-auto">
          {threads === null ? <SkeletonRows rows={3} icon={false} /> : null}
          {threads?.map((t) => (
            <li key={t.id} className="group flex items-center">
              <button
                onClick={() => void open(t.id)}
                className={cn(
                  'min-w-0 flex-1 truncate rounded-orv-md px-3 py-2 text-left text-[13px]',
                  t.id === threadId ? 'bg-orv-track font-semibold' : 'text-orv-muted hover:bg-orv-track',
                )}
              >
                {t.title}
              </button>
              <button
                aria-label={`Delete ${t.title}`}
                onClick={async () => {
                  await api(`/assistant/threads/${t.id}`, { method: 'DELETE' });
                  if (t.id === threadId) void open(null);
                  void loadThreads();
                }}
                className="hidden h-7 w-7 place-items-center rounded-full text-orv-muted hover:text-orv-danger group-hover:grid"
              >
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
      </aside>

      {/* the conversation */}
      <section className="flex min-w-0 flex-1 flex-col" aria-label="Assistant">
        <header className="flex items-center gap-2 px-1 pb-3">
          <button
            className="grid h-9 w-9 place-items-center rounded-full hover:bg-orv-track xl:hidden"
            aria-label="Conversations"
            onClick={() => setShowList((v) => !v)}
          >
            <PanelLeft size={18} />
          </button>
          <h1 className="flex-1 text-title font-semibold">Assistant</h1>
          {threadId ? (
            <button
              onClick={() => void open(null)}
              className="flex items-center gap-1 rounded-full px-3 py-1.5 text-[13px] text-orv-muted hover:bg-orv-track"
            >
              <Plus size={14} /> New
            </button>
          ) : null}
        </header>

        <div className="flex-1 overflow-y-auto px-1" aria-live="polite">
          {empty ? (
            <div className="mx-auto flex max-w-xl flex-col items-center gap-5 pt-[8vh] text-center">
              <Logo size={64} />
              <div>
                <h2 className="text-[26px] font-semibold tracking-tight">
                  {firstName ? `How can I help, ${firstName}?` : 'How can I help?'}
                </h2>
                <p className="mt-1 text-small text-orv-muted">
                  I answer from your own Today, Money, Library and Drop. Anything I’d change waits for your
                  tap.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => void send(s)}
                    className="glass-pane !rounded-full px-3.5 py-2 text-[13px] transition-transform hover:-translate-y-0.5"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {loadingThread ? <SkeletonRows rows={3} /> : null}

          <ol className="mx-auto flex max-w-3xl flex-col gap-4 pb-4">
            <AnimatePresence initial={false}>
              {messages.map((m) => (
                <motion.li
                  key={m.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={spring.smooth}
                  className={cn('flex gap-3', m.role === 'user' ? 'justify-end' : 'justify-start')}
                >
                  {m.role === 'assistant' ? <Logo size={28} glyph className="mt-1" /> : null}
                  <div className={cn('flex max-w-[85%] flex-col gap-2', m.role === 'user' && 'items-end')}>
                    <div
                      className={cn(
                        'whitespace-pre-wrap px-4 py-2.5 text-[15px] leading-relaxed',
                        m.role === 'user'
                          ? 'rounded-[20px] rounded-br-md text-white [background:var(--orv-accent-grad)]'
                          : 'glass-pane rounded-[20px] !rounded-tl-md',
                        m.paused && 'border-orv-warning/50',
                      )}
                    >
                      {m.text}
                    </div>
                    {m.proposals.map((p) => (
                      <ProposalCard key={p.index} p={p} onDecide={(c) => void decide(m, p, c)} />
                    ))}
                    {m.sources.length ? (
                      <div className="flex flex-wrap gap-1">
                        {m.sources.map((s) => (
                          <span
                            key={s}
                            className="rounded-full bg-orv-track px-2 py-0.5 text-[11px] text-orv-muted"
                          >
                            {s}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </motion.li>
              ))}
              {thinking ? (
                <motion.li
                  key="thinking"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex flex-col gap-4"
                >
                  <div className="flex justify-end">
                    <div className="max-w-[85%] rounded-[20px] rounded-br-md px-4 py-2.5 text-[15px] text-white opacity-80 [background:var(--orv-accent-grad)]">
                      {thinking}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-small text-orv-muted">
                    <Orb size={28} state="thinking" label="Thinking" /> Looking through your things…
                  </div>
                </motion.li>
              ) : null}
            </AnimatePresence>
          </ol>
          <div ref={end} />
        </div>

        {/* composer */}
        <form
          className="glass-float mx-auto flex w-full max-w-3xl items-end gap-2 p-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send(text);
          }}
        >
          <textarea
            value={voice.listening && voice.interim ? `${text} ${voice.interim}` : text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send(text);
              }
            }}
            rows={1}
            maxLength={2000}
            aria-label="Ask the Assistant"
            placeholder="Ask anything about your day, money or papers…"
            className="max-h-40 min-h-11 flex-1 resize-none bg-transparent px-3 py-2.5 text-[16px] outline-none placeholder:text-orv-faint"
          />
          {voice.supported ? (
            <button
              type="button"
              aria-label={voice.listening ? 'Stop listening' : 'Speak'}
              onClick={() => void (voice.listening ? voice.stop() : voice.start(text))}
              className={cn(
                'grid h-11 w-11 shrink-0 place-items-center rounded-full transition-colors',
                voice.listening ? 'bg-orv-danger/15 text-orv-danger' : 'text-orv-muted hover:bg-orv-track',
              )}
            >
              {voice.listening ? <Square size={16} /> : <Mic size={18} />}
            </button>
          ) : null}
          <button
            type="submit"
            aria-label="Send"
            disabled={!text.trim() || !!thinking}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-white transition-opacity disabled:opacity-40 [background:var(--orv-accent-grad)]"
          >
            <ArrowUp size={18} />
          </button>
        </form>
      </section>
    </div>
  );
}

function ProposalCard({ p, onDecide }: { p: AssistantProposalView; onDecide(confirm: boolean): void }) {
  const [busy, setBusy] = useState(false);
  const Icon = ICON[p.proposal.type] ?? Check;
  const run = async (c: boolean) => {
    setBusy(true);
    try {
      await onDecide(c);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className={cn(
        'glass-float flex w-full min-w-72 items-center gap-3 p-3',
        p.status === 'dismissed' && 'opacity-50',
      )}
      data-testid="proposal"
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[11px] text-white [background:var(--orv-accent-grad)]">
        <Icon size={17} aria-hidden />
      </span>
      <p className="min-w-0 flex-1 text-[14px] font-medium">{p.summary}</p>
      {p.status === 'open' ? (
        <div className="flex shrink-0 gap-1">
          <button
            aria-label={`Not now: ${p.summary}`}
            disabled={busy}
            onClick={() => void run(false)}
            className="grid h-9 w-9 place-items-center rounded-full text-orv-muted hover:bg-orv-track"
          >
            <X size={16} />
          </button>
          <button
            disabled={busy}
            onClick={() => void run(true)}
            className="flex h-9 items-center gap-1 rounded-full px-3.5 text-[13px] font-semibold text-white [background:var(--orv-accent-grad)] disabled:opacity-60"
          >
            <Check size={14} /> Confirm
          </button>
        </div>
      ) : p.status === 'done' ? (
        <Badge tone="success">done</Badge>
      ) : p.status === 'failed' ? (
        <Badge tone="danger">{p.problem ?? 'failed'}</Badge>
      ) : (
        <Badge>dismissed</Badge>
      )}
    </div>
  );
}

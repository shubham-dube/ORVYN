import { duration } from '@orvyn/activity';
import type { ActivityDay, FillFact, FillProfile, PageMode, PageReadReply } from '@orvyn/contracts';
import {
  BookmarkPlus,
  Briefcase,
  Camera,
  Clock,
  Copy,
  Download,
  KeyRound,
  Lock,
  Search,
  Shield,
  Sparkles,
  Trash2,
  Undo2,
  Wand2,
  X,
} from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { WEB_URL } from './config';
import type { Answer, DataRequest, FillReport, PageView, Prefs, Stash } from './core';
import type { Found } from './recall';
import type { VaultView } from './vault';

/** Asks the background; its error, in words, is thrown. */
export async function get<T>(req: DataRequest): Promise<T> {
  const r = await chrome.runtime.sendMessage<DataRequest, Answer<T>>(req);
  if ('error' in r) throw new Error(r.error);
  return r.ok;
}

/** One thing at a time: what is running, what it said, what went wrong. */
function useRun() {
  const [busy, setBusy] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async (name: string, f: () => Promise<string | void>) => {
    setBusy(name);
    setSaid(null);
    setError(null);
    try {
      setSaid((await f()) || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    }
    setBusy(null);
  }, []);
  const line = error ? (
    <p role="alert" className="mt-2 text-[12px] text-orv-danger">
      {error}
    </p>
  ) : said ? (
    <p role="status" className="mt-2 text-[12px] text-orv-success">
      {said}
    </p>
  ) : null;
  return { busy, run, line };
}

function Card({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="halo mx-4 mb-2 p-3" aria-label={label}>
      {children}
    </section>
  );
}
function Btn({
  children,
  onClick,
  busy,
  main,
  label,
  type = 'button',
}: {
  children: ReactNode;
  onClick?(): void;
  busy?: boolean;
  main?: boolean;
  label?: string;
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={busy}
      aria-busy={busy || undefined}
      aria-label={label}
      className={`flex min-h-9 items-center justify-center gap-1.5 rounded-orv-md px-2.5 text-[12px] font-semibold disabled:opacity-50 ${
        main ? 'text-white [background:var(--orv-accent-grad)]' : 'border border-orv-edge hover:bg-orv-track'
      }`}
    >
      {busy ? '…' : children}
    </button>
  );
}
const input =
  'min-h-9 w-full rounded-orv-md border border-orv-edge bg-orv-field px-2.5 text-[13px] outline-none focus:border-orv-accent';
const muted = 'text-[12px] text-orv-muted';

// ------------------------------------------------------------------ page

export function PageTab({ canDrop, canThink }: { canDrop: boolean; canThink: boolean }) {
  const [p, setP] = useState<PageView | null>(null);
  const [none, setNone] = useState<string | null>(null);
  const [reply, setReply] = useState<PageReadReply | null>(null);
  const [added, setAdded] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const [note, setNote] = useState('');
  const { busy, run, line } = useRun();
  const load = useCallback(() => {
    get<PageView>({ type: 'page' }).then(
      (v) => {
        setP(v);
        setNone(null);
      },
      (e: Error) => {
        setP(null);
        setNone(e.message);
      },
    );
  }, []);
  useEffect(() => {
    load();
    // the side panel stays open while tabs change
    const onChange = () => {
      setReply(null);
      load();
    };
    chrome.tabs.onActivated.addListener(onChange);
    return () => chrome.tabs.onActivated.removeListener(onChange);
  }, [load]);
  const think = (mode: PageMode) =>
    run(mode, async () => {
      setReply(await get<PageReadReply>({ type: 'think', mode, question: q }));
    });
  if (none) return <Card label="Page">{<p className={muted}>{none}</p>}</Card>;
  if (!p) return <Card label="Page">{<p className={muted}>Reading…</p>}</Card>;
  const m = p.memory;
  return (
    <Card label="Page">
      <p className="truncate text-[13px] font-semibold">{p.title || p.host}</p>
      <p className={muted}>
        {m?.visits
          ? `Here ${m.visits} ${m.visits === 1 ? 'time' : 'times'} · ${duration(m.dwellMs)} in all · last ${new Date(m.lastAt).toLocaleDateString([], { day: 'numeric', month: 'short' })}`
          : 'First time here'}
      </p>
      {m?.price ? <p className="text-[12px] font-semibold text-orv-accent">{m.price}</p> : null}

      {canDrop ? (
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          <Btn busy={busy === 'drop'} onClick={() => run('drop', () => get<string>({ type: 'dropPage' }))}>
            <Download size={13} aria-hidden /> Drop
          </Btn>
          <Btn busy={busy === 'later'} onClick={() => run('later', () => get<string>({ type: 'readLater' }))}>
            <BookmarkPlus size={13} aria-hidden /> Read later
          </Btn>
          <Btn busy={busy === 'shot'} onClick={() => run('shot', () => get<string>({ type: 'screenshot' }))}>
            <Camera size={13} aria-hidden /> Screenshot
          </Btn>
        </div>
      ) : null}
      {canThink ? (
        <>
          <div className="mt-2 grid grid-cols-4 gap-1.5">
            {(
              [
                ['brief', 'Brief'],
                ['catch', 'The catch'],
                ['actions', 'To do'],
                ['compare', 'Compare'],
              ] as const
            ).map(([mode, text]) => (
              <Btn key={mode} busy={busy === mode} onClick={() => think(mode)}>
                {text}
              </Btn>
            ))}
          </div>
          <form
            className="mt-2 flex gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              if (q.trim()) void think('ask');
            }}
          >
            <input
              className={input}
              value={q}
              maxLength={600}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Ask about this page"
              placeholder="Ask about this page"
            />
            <Btn type="submit" main busy={busy === 'ask'} label="Ask">
              <Sparkles size={14} aria-hidden />
            </Btn>
          </form>
        </>
      ) : null}
      {reply ? (
        <div className="pane mt-2 p-2.5 text-[13px]">
          {reply.text ? <p className="whitespace-pre-wrap">{reply.text}</p> : null}
          {reply.points.length ? (
            <ul className="mt-1.5 list-disc pl-4">
              {reply.points.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          ) : null}
          {reply.actions.map((a) => (
            <div key={a.text} className="mt-1.5 flex items-center gap-2">
              <span className="min-w-0 flex-1">{a.text}</span>
              <Btn
                busy={busy === a.text || added.includes(a.text)}
                onClick={() =>
                  run(a.text, async () => {
                    const r = await chrome.runtime.sendMessage({
                      type: a.kind === 'task' ? 'quickAdd' : 'expense',
                      text: a.text,
                    });
                    if (r.error) throw new Error(r.error);
                    setAdded((x) => [...x, a.text]);
                    return r.saved;
                  })
                }
              >
                {a.kind === 'task' ? 'Add to Today' : 'Add to Money'}
              </Btn>
            </div>
          ))}
        </div>
      ) : null}
      {line}

      {m?.notes.map((n) => (
        <p key={n.at} className="mt-1.5 flex gap-2 rounded-orv-md bg-orv-track px-2.5 py-1.5 text-[12px]">
          <span className="min-w-0 flex-1 whitespace-pre-wrap">{n.text}</span>
          <button
            aria-label="Remove note"
            onClick={() => run('unnote', async () => setP(await get<PageView>({ type: 'unnote', at: n.at })))}
          >
            <X size={12} />
          </button>
        </p>
      ))}
      <form
        className="mt-2 flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!note.trim()) return;
          void run('note', async () => {
            setP(await get<PageView>({ type: 'note', text: note }));
            setNote('');
          });
        }}
      >
        <input
          className={input}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          aria-label="Note on this page"
          placeholder="A note you’ll see when you’re back here"
        />
        <Btn type="submit" busy={busy === 'note'}>
          Note
        </Btn>
      </form>
      <FocusBox p={p} reload={load} />
      <StashBox />
      <div className="mt-2">
        <Btn
          busy={busy === 'jobos'}
          onClick={() =>
            run('jobos', async () => {
              await navigator.clipboard.writeText(p.url);
              await get({ type: 'jobos' });
            })
          }
        >
          <Briefcase size={13} aria-hidden /> Send to JobOS (copies the link, opens it)
        </Btn>
      </div>
    </Card>
  );
}

function FocusBox({ p, reload }: { p: PageView; reload(): void }) {
  const [what, setWhat] = useState('');
  const { busy, run, line } = useRun();
  if (p.focus)
    return (
      <div className="pane mt-2 flex items-center gap-2 p-2.5 text-[12px]">
        <Shield size={14} className="text-orv-accent" aria-hidden />
        <span className="min-w-0 flex-1">
          Focus{p.focus.what ? `: ${p.focus.what}` : ''} until{' '}
          {new Date(p.focus.until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          {p.focus.bypassed ? ` · ${p.focus.bypassed} detours` : ''}
        </span>
        <Btn onClick={() => run('off', async () => (await get({ type: 'unfocus' }), reload()))}>Stop</Btn>
      </div>
    );
  return (
    <div className="mt-2 flex gap-1.5">
      <input
        className={input}
        value={what}
        onChange={(e) => setWhat(e.target.value)}
        aria-label="Focus on"
        placeholder="Focus on…"
      />
      {[25, 50].map((m) => (
        <Btn
          key={m}
          busy={busy === `f${m}`}
          label={`Focus ${m} minutes`}
          onClick={() => run(`f${m}`, async () => (await get({ type: 'focus', what, minutes: m }), reload()))}
        >
          <Shield size={12} aria-hidden /> {m}
        </Btn>
      ))}
      {line}
    </div>
  );
}

function StashBox() {
  const [list, setList] = useState<Stash[]>([]);
  const [name, setName] = useState('');
  const [on, setOn] = useState('');
  const { busy, run, line } = useRun();
  const load = useCallback(() => void get<Stash[]>({ type: 'stashes' }).then(setList, () => undefined), []);
  useEffect(load, [load]);
  return (
    <details className="mt-2 text-[12px]">
      <summary className="cursor-pointer font-semibold">
        Tab stash{list.length ? ` (${list.length})` : ''}
      </summary>
      <div className="mt-1.5 flex gap-1.5">
        <input
          className={input}
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="Stash name"
          placeholder="Name"
        />
        <input
          className={`${input} max-w-[128px]`}
          type="date"
          value={on}
          onChange={(e) => setOn(e.target.value)}
          aria-label="Bring back on"
        />
        <Btn
          busy={busy === 'stash'}
          onClick={() =>
            run('stash', async () => {
              const n = await get<number>({ type: 'stash', name, on: on || null });
              setName('');
              load();
              return `${n} tabs put away`;
            })
          }
        >
          Put away
        </Btn>
      </div>
      {line}
      {list.map((s) => (
        <div key={s.id} className="mt-1 flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate">
            {s.name} · {s.tabs.length} tabs{s.on ? ` · ${s.on}` : ''}
          </span>
          <Btn
            onClick={() =>
              run('open', async () => setList(await get<Stash[]>({ type: 'unstash', id: s.id, open: true })))
            }
          >
            Open
          </Btn>
          <Btn
            label={`Delete ${s.name}`}
            onClick={() =>
              run('del', async () => setList(await get<Stash[]>({ type: 'unstash', id: s.id, open: false })))
            }
          >
            <Trash2 size={12} aria-hidden />
          </Btn>
        </div>
      ))}
    </details>
  );
}

// ------------------------------------------------------------------ fill

const FROM = { rule: '', taught: 'you taught me', ai: 'matched by AI' } as const;

export function FillTab() {
  const [r, setR] = useState<FillReport | null>(null);
  const [draft, setDraft] = useState<{ q: string; a: string } | null>(null);
  const [editing, setEditing] = useState(false);
  const { busy, run, line } = useRun();
  if (editing) return <ProfileEditor onClose={() => setEditing(false)} />;
  return (
    <Card label="Fill">
      <div className="flex gap-1.5">
        <div className="flex-1 [&>button]:w-full">
          <Btn
            main
            busy={busy === 'fill'}
            onClick={() =>
              run('fill', async () => {
                const x = await get<FillReport>({ type: 'fill' });
                setR(x);
                return `${x.filled.length} filled. Check them; nothing was sent.`;
              })
            }
          >
            <Wand2 size={14} aria-hidden /> Fill this form
          </Btn>
        </div>
        <Btn onClick={() => setEditing(true)}>My details</Btn>
      </div>
      {line}
      {r?.aiProblem ? <p className={muted}>Some fields were not matched: {r.aiProblem}</p> : null}
      {r ? (
        <>
          <ul className="mt-2 max-h-40 overflow-y-auto">
            {r.filled.map((f, i) => (
              <li key={i} className="flex justify-between gap-2 py-0.5 text-[12px]">
                <span className="truncate text-orv-muted">{f.label}</span>
                <span className="max-w-[55%] truncate text-right" title={FROM[f.from]}>
                  {f.value}
                  {f.from === 'ai' ? ' ✦' : ''}
                </span>
              </li>
            ))}
          </ul>
          {r.files ? <p className={muted}>Attach your files yourself ({r.files}).</p> : null}
          {r.left.length ? (
            <>
              <p className="mt-2 text-[12px] font-semibold">Left for you</p>
              <ul className="max-h-40 overflow-y-auto">
                {r.left.map((l, i) => (
                  <li key={i} className="flex items-center gap-2 py-0.5 text-[12px]">
                    <span className="min-w-0 flex-1 truncate">{l.label}</span>
                    {l.long ? (
                      <Btn
                        busy={busy === `d${i}`}
                        onClick={() =>
                          run(`d${i}`, async () => {
                            const d = await get<{ answer: string; missing: string }>({
                              type: 'draft',
                              question: l.label,
                            });
                            if (!d.answer) throw new Error(d.missing || 'Your details do not answer this');
                            setDraft({ q: l.label, a: d.answer });
                          })
                        }
                      >
                        Draft
                      </Btn>
                    ) : null}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {draft ? (
            <div className="pane mt-2 p-2.5 text-[12px]">
              <p className="font-semibold">{draft.q}</p>
              <textarea
                className={`${input} mt-1 h-32 py-1.5`}
                aria-label="Draft"
                value={draft.a}
                onChange={(e) => setDraft({ ...draft, a: e.target.value })}
              />
              <Btn
                onClick={() =>
                  run('copy', async () => {
                    await navigator.clipboard.writeText(draft.a);
                    return 'Copied';
                  })
                }
              >
                <Copy size={12} aria-hidden /> Copy
              </Btn>
            </div>
          ) : null}
        </>
      ) : (
        <p className={`${muted} mt-2`}>
          Fills what it knows, skips what it doesn’t, and never sends the form. AI only ever sees the labels.
        </p>
      )}
      <div className="mt-2 flex gap-1.5">
        <Btn
          busy={busy === 'undo'}
          onClick={() => run('undo', async () => `${await get<number>({ type: 'undoFill' })} put back`)}
        >
          <Undo2 size={12} aria-hidden /> Undo
        </Btn>
        <Btn
          busy={busy === 'learn'}
          onClick={() =>
            run('learn', async () => {
              const n = await get<number>({ type: 'learn' });
              return n ? `Learned ${n} answers from this page` : 'Nothing new here';
            })
          }
        >
          Learn from this page
        </Btn>
      </div>
    </Card>
  );
}

function ProfileEditor({ onClose }: { onClose(): void }) {
  const [p, setP] = useState<FillProfile | null>(null);
  const [text, setText] = useState('');
  const { busy, run, line } = useRun();
  useEffect(() => {
    get<FillProfile>({ type: 'profile' }).then(setP, (e: Error) => void run('load', () => Promise.reject(e)));
  }, [run]);
  if (!p) return <Card label="My details">{line ?? <p className={muted}>Opening…</p>}</Card>;
  const set = (i: number, f: Partial<FillFact>) =>
    setP({ ...p, facts: p.facts.map((x, j) => (j === i ? { ...x, ...f } : x)) });
  return (
    <Card label="My details">
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-semibold">My details</p>
        <Btn onClick={onClose}>Back</Btn>
      </div>
      <details className="mt-2 text-[12px]" open={!p.facts.length}>
        <summary className="cursor-pointer font-semibold">Read them from my profile text</summary>
        <textarea
          className={`${input} mt-1 h-24 py-1.5`}
          aria-label="Profile text"
          maxLength={60000}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste your master profile or resume text"
        />
        <Btn
          main
          busy={busy === 'read'}
          onClick={() =>
            run('read', async () => {
              const r = await get<{ facts: FillFact[] }>({ type: 'structure', text });
              // what I already corrected by hand stays
              const have = new Set(p.facts.map((f) => f.key));
              const fresh = r.facts.filter((f) => !have.has(f.key));
              setP({ ...p, facts: [...p.facts, ...fresh], story: p.story || text.slice(0, 60000) });
              return `${fresh.length} found. Check them, then Save.`;
            })
          }
        >
          Read it
        </Btn>
      </details>
      <ul className="mt-2 max-h-64 overflow-y-auto">
        {p.facts.map((f, i) => (
          <li key={i} className="mb-1 flex gap-1">
            <input
              className={`${input} max-w-[38%]`}
              aria-label={`Name of ${f.label}`}
              value={f.label}
              onChange={(e) => set(i, { label: e.target.value })}
            />
            <input
              className={input}
              aria-label={f.label}
              value={f.value}
              onChange={(e) => set(i, { value: e.target.value })}
            />
            <Btn
              label={`Remove ${f.label}`}
              onClick={() => setP({ ...p, facts: p.facts.filter((_, j) => j !== i) })}
            >
              <X size={12} />
            </Btn>
          </li>
        ))}
      </ul>
      <Btn
        onClick={() =>
          setP({
            ...p,
            facts: [
              ...p.facts,
              { key: `custom_${Date.now().toString(36)}`, label: 'New', value: '', group: 'other' },
            ],
          })
        }
      >
        Add one
      </Btn>
      <details className="mt-2 text-[12px]">
        <summary className="cursor-pointer font-semibold">Answers I taught ({p.answers.length})</summary>
        <ul className="max-h-40 overflow-y-auto">
          {p.answers.map((a, i) => (
            <li key={i} className="flex gap-2 py-0.5">
              <span className="min-w-0 flex-1 truncate" title={a.a}>
                {a.q} → {a.a}
              </span>
              <button
                aria-label={`Forget ${a.q}`}
                onClick={() => setP({ ...p, answers: p.answers.filter((_, j) => j !== i) })}
              >
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      </details>
      {line}
      <div className="mt-2 [&>button]:w-full">
        <Btn
          main
          busy={busy === 'save'}
          onClick={() =>
            run('save', async () => {
              setP(await get<FillProfile>({ type: 'saveProfile', profile: p }));
              return 'Saved';
            })
          }
        >
          Save
        </Btn>
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------ vault

export function VaultTab({ onSaved }: { onSaved(): void }) {
  const [v, setV] = useState<VaultView | null>(null);
  const [pass, setPass] = useState('');
  const [q, setQ] = useState('');
  const [codes, setCodes] = useState<Record<string, { code: string; left: number }>>({});
  const [name, setName] = useState<string | null>(null);
  const { busy, run, line } = useRun();
  const load = useCallback(
    () => run('load', async () => setV(await get<VaultView>({ type: 'vault' }))),
    [run],
  );
  useEffect(() => void load(), [load]);
  if (!v) return <Card label="Vault">{line ?? <p className={muted}>Opening…</p>}</Card>;
  const pending = v.pending ? (
    <div className="pane mb-2 p-2.5 text-[12px]" role="group" aria-label="Save login">
      <p className="font-semibold">
        {v.pending.updates ? 'Update the password for' : 'Save the login for'} {v.pending.host}?
      </p>
      {v.state === 'open' ? (
        <>
          {v.pending.updates ? null : (
            <input
              className={`${input} my-1.5`}
              aria-label="User name"
              value={name ?? v.pending.username}
              onChange={(e) => setName(e.target.value)}
            />
          )}
          <div className="mt-1.5 flex gap-1.5">
            <Btn
              main
              busy={busy === 'save'}
              onClick={() =>
                run('save', async () => {
                  const s = await get<string>({
                    type: 'savePending',
                    ...(name === null ? {} : { username: name }),
                  });
                  setName(null);
                  setV(await get<VaultView>({ type: 'vault' }));
                  onSaved();
                  return s;
                })
              }
            >
              {v.pending.updates ? 'Update' : 'Save'}
            </Btn>
            <Btn
              onClick={() =>
                run('no', async () => {
                  await get({ type: 'dropPending' });
                  setV(await get<VaultView>({ type: 'vault' }));
                  onSaved();
                })
              }
            >
              Not now
            </Btn>
          </div>
        </>
      ) : (
        <p className={muted}>Unlock below to save it.</p>
      )}
    </div>
  ) : null;
  if (v.state === 'off')
    return <Card label="Vault">{<p className={muted}>The Vault isn’t switched on for you.</p>}</Card>;
  if (v.state === 'none')
    return (
      <Card label="Vault">
        {pending}
        <p className={muted}>
          Set up your Vault in ORVYN first.{' '}
          <a className="text-orv-accent" href={`${WEB_URL}/vault`} target="_blank" rel="noreferrer">
            Open the Vault
          </a>
        </p>
      </Card>
    );
  if (v.state === 'locked')
    return (
      <Card label="Vault">
        {pending}
        <form
          className="flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            void run('unlock', async () => {
              await get({ type: 'unlock', passphrase: pass });
              setPass('');
              setV(await get<VaultView>({ type: 'vault' }));
            });
          }}
        >
          <input
            className={input}
            type="password"
            autoFocus
            autoComplete="off"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            aria-label="Vault passphrase"
            placeholder="Vault passphrase"
          />
          <Btn type="submit" main busy={busy === 'unlock'}>
            <KeyRound size={13} aria-hidden /> Unlock
          </Btn>
        </form>
        {line}
      </Card>
    );
  const shown = v.logins.filter((l) =>
    q ? `${l.title} ${l.username} ${l.url}`.toLowerCase().includes(q.toLowerCase()) : l.fits,
  );
  return (
    <Card label="Vault">
      {pending}
      <div className="flex gap-1.5">
        <input
          className={input}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search logins"
          placeholder={`Search ${v.logins.length} logins`}
        />
        <Btn
          label="Lock the Vault"
          onClick={() => run('lock', async () => (await get({ type: 'lock' }), load()))}
        >
          <Lock size={13} aria-hidden />
        </Btn>
      </div>
      <ul className="mt-2 max-h-56 overflow-y-auto">
        {shown.map((l) => (
          <li key={l.id} className="flex items-center gap-2 py-1 text-[12px]">
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">{l.title}</span>
              <span className="block truncate text-orv-muted">
                {codes[l.id] ? codes[l.id]!.code : l.username}
              </span>
            </span>
            {l.hasTotp ? (
              <Btn
                busy={busy === `t${l.id}`}
                onClick={() =>
                  run(`t${l.id}`, async () => {
                    const c = await get<{ code: string; left: number }>({ type: 'totp', id: l.id });
                    setCodes((x) => ({ ...x, [l.id]: c }));
                    await navigator.clipboard.writeText(c.code);
                    return `Code copied, ${c.left} s left`;
                  })
                }
              >
                Code
              </Btn>
            ) : null}
            {l.fits ? (
              <Btn
                main
                busy={busy === l.id}
                label={`Fill ${l.title}`}
                onClick={() => run(l.id, () => get<string>({ type: 'fillLogin', id: l.id }))}
              >
                Fill
              </Btn>
            ) : null}
          </li>
        ))}
        {!shown.length ? (
          <p className={muted}>{q ? 'Nothing found.' : 'No login saved for this site.'}</p>
        ) : null}
      </ul>
      <Btn busy={busy === 'gen'} onClick={() => run('gen', () => get<string>({ type: 'newPassword' }))}>
        <Sparkles size={12} aria-hidden /> Put in a strong new password
      </Btn>
      {line}
    </Card>
  );
}

// ------------------------------------------------------------------ recall

export function RecallTab() {
  const [q, setQ] = useState('');
  const [r, setR] = useState<Found[] | null>(null);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const { run, line } = useRun();
  const seq = useRef(0);
  useEffect(() => void get<Prefs>({ type: 'prefs' }).then(setPrefs, () => undefined), []);
  useEffect(() => {
    if (q.trim().length < 2) return setR(null);
    const mine = ++seq.current;
    const t = setTimeout(
      () =>
        run('recall', async () => {
          const x = await get<Found[]>({ type: 'recall', q });
          if (mine === seq.current) setR(x);
        }),
      200,
    );
    return () => clearTimeout(t);
  }, [q, run]);
  return (
    <Card label="Recall">
      <label className="flex items-center gap-2 rounded-orv-md border border-orv-edge bg-orv-field px-2.5">
        <Search size={14} className="text-orv-muted" aria-hidden />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Find a page I read"
          placeholder="that page about… on tuesday"
          className="h-9 flex-1 bg-transparent text-[13px] outline-none"
        />
      </label>
      <ul className="mt-2 max-h-72 overflow-y-auto">
        {(r ?? []).map((p) => (
          <li key={p.url} className="flex gap-1">
            <a
              href={p.url}
              target="_blank"
              rel="noreferrer"
              className="min-w-0 flex-1 rounded-orv-md px-1.5 py-1.5 hover:bg-orv-track"
            >
              <span className="block truncate text-[13px] font-medium">{p.title}</span>
              <span className="line-clamp-2 text-[11px] text-orv-muted">{p.snippet}</span>
              <span className="text-[11px] text-orv-faint">
                {p.host} · {new Date(p.lastAt).toLocaleDateString([], { day: 'numeric', month: 'short' })} ·{' '}
                {duration(p.dwellMs)}
              </span>
            </a>
            <button
              aria-label={`Forget ${p.title}`}
              onClick={() =>
                run('forget', async () => {
                  await get({ type: 'forget', url: p.url });
                  setR((x) => (x ?? []).filter((y) => y.url !== p.url));
                })
              }
            >
              <X size={12} />
            </button>
          </li>
        ))}
        {r && !r.length ? <p className={muted}>Nothing found.</p> : null}
      </ul>
      {line}
      {prefs ? <Toggles prefs={prefs} onChange={setPrefs} /> : null}
    </Card>
  );
}

function Toggles({ prefs, onChange }: { prefs: Prefs; onChange(p: Prefs): void }) {
  const set = (p: Partial<Prefs>) =>
    void get<Prefs>({ type: 'setPrefs', prefs: p }).then(onChange, () => undefined);
  const [skip, setSkip] = useState(prefs.skipHosts.join(', '));
  return (
    <details className="mt-2 text-[12px]">
      <summary className="cursor-pointer font-semibold">Settings</summary>
      {(
        [
          ['track', 'My Day: record where I am'],
          ['recall', 'Recall: remember pages I read (on this PC only)'],
          ['offerSave', 'Offer to save logins'],
        ] as const
      ).map(([k, text]) => (
        <label key={k} className="flex items-center gap-2 py-1">
          <input type="checkbox" checked={prefs[k]} onChange={(e) => set({ [k]: e.target.checked })} /> {text}
        </label>
      ))}
      <label className="flex items-center gap-2 py-1">
        Lock the Vault after
        <select
          value={prefs.autoLockMin}
          onChange={(e) => set({ autoLockMin: Number(e.target.value) })}
          className="rounded-orv-md border border-orv-edge bg-orv-field px-1"
        >
          {[1, 5, 15, 30, 60].map((m) => (
            <option key={m} value={m}>
              {m} min
            </option>
          ))}
        </select>
      </label>
      <label className="block py-1">
        Never remember these sites
        <input
          className={input}
          value={skip}
          onChange={(e) => setSkip(e.target.value)}
          onBlur={() =>
            set({
              skipHosts: skip
                .split(/[\s,]+/)
                .map((s) => s.trim().toLowerCase())
                .filter(Boolean),
            })
          }
          placeholder="example.com, other.com"
        />
      </label>
    </details>
  );
}

// ------------------------------------------------------------------ day

const localDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function DayTab() {
  const [d, setD] = useState<ActivityDay | null>(null);
  const { run, line } = useRun();
  useEffect(() => {
    const load = () =>
      run('day', async () => setD(await get<ActivityDay>({ type: 'day', date: localDay(new Date()) })));
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => clearInterval(t);
  }, [run]);
  if (!d) return <Card label="Day">{line ?? <p className={muted}>Adding up…</p>}</Card>;
  const top = Math.max(1, ...d.byCategory.map((c) => c.ms));
  return (
    <Card label="Day">
      <div className="grid grid-cols-3 gap-2">
        {(
          [
            ['Active', duration(d.activeMs)],
            ['Deep work', duration(d.deepMs)],
            ['Switches', String(d.switches)],
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="pane p-2">
            <p className="text-[11px] text-orv-muted">{k}</p>
            <p className="text-[15px] font-semibold tabular-nums">{v}</p>
          </div>
        ))}
      </div>
      <ul className="mt-2">
        {d.byCategory.slice(0, 5).map((c) => (
          <li key={c.category} className="flex items-center gap-2 py-0.5 text-[12px]">
            <span className="w-16 capitalize text-orv-muted">{c.category}</span>
            <span className="h-2 flex-1 overflow-hidden rounded-full bg-orv-track">
              <span
                className="block h-full rounded-full [background:var(--orv-accent-grad)]"
                style={{ width: `${(c.ms / top) * 100}%` }}
              />
            </span>
            <span className="w-20 text-right tabular-nums">{duration(c.ms)}</span>
          </li>
        ))}
      </ul>
      <ul className="mt-2 max-h-40 overflow-y-auto">
        {d.places.slice(0, 12).map((p) => (
          <li key={p.place} className="flex justify-between gap-2 py-0.5 text-[12px]">
            <span className="min-w-0 truncate">
              {p.place} <span className="text-orv-muted">{p.whats[0]?.what}</span>
            </span>
            <span className="shrink-0 tabular-nums">{duration(p.ms)}</span>
          </li>
        ))}
        {!d.places.length ? <p className={muted}>Nothing yet. It fills in as you browse.</p> : null}
      </ul>
      <a
        href={`${WEB_URL}/day`}
        target="_blank"
        rel="noreferrer"
        className="mt-2 flex items-center gap-1.5 text-[12px] font-semibold text-orv-accent"
      >
        <Clock size={13} aria-hidden /> The whole day, hour by hour
      </a>
      {line}
    </Card>
  );
}

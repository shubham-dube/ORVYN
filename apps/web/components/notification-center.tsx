'use client';

import { BellOff, Send, X } from 'lucide-react';
import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useRouter } from 'next/navigation';
import { Empty, useToast } from '@/components/ui/bits';
import { Button } from '@/components/ui/button';
import { spring } from '@/lib/motion';
import { useNotifications } from '@/lib/notifications';

export function NotificationCenter({ open, onClose }: { open: boolean; onClose(): void }) {
  const n = useNotifications();
  const router = useRouter();
  const toast = useToast();
  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-50"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <button
            aria-label="Close notifications"
            className="absolute inset-0 bg-orv-scrim"
            onClick={onClose}
          />
          <motion.aside
            aria-label="Notifications"
            initial={{ x: 60, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 60, opacity: 0 }}
            transition={spring.smooth}
            className="glass-halo edge-light absolute bottom-3 right-3 top-3 flex w-[min(400px,calc(100vw-24px))] flex-col overflow-hidden"
          >
            <div className="flex items-center justify-between px-5 pb-2 pt-5">
              <h2 className="text-heading font-semibold">Notifications</h2>
              {n.items.length ? (
                <Button size="sm" variant="ghost" onClick={() => void n.dismissAll()}>
                  Clear all
                </Button>
              ) : null}
            </div>
            <ul className="flex-1 space-y-2 overflow-y-auto px-3 pb-3">
              <AnimatePresence initial={false}>
                {n.items.map((item) => (
                  <motion.li
                    key={item.id}
                    layout
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: 60 }}
                    transition={spring.smooth}
                    className="glass-pane flex flex-wrap gap-3 p-3"
                  >
                    <span
                      aria-hidden
                      className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                      style={{ background: item.readAt ? 'transparent' : 'var(--orv-accent)' }}
                    />
                    <button
                      className="flex-1 text-left"
                      onClick={() => {
                        void n.markRead(item.id);
                        if (item.url) {
                          onClose();
                          // a pull request, an IPO’s registrar…
                          if (/^https?:/.test(item.url)) window.open(item.url, '_blank', 'noopener');
                          else router.push(item.url);
                        }
                      }}
                    >
                      <p className="text-[14px] font-semibold">{item.title}</p>
                      {item.body ? <p className="text-small text-orv-muted">{item.body}</p> : null}
                      <p className="mt-1 text-[11px] text-orv-faint">
                        {new Date(item.createdAt).toLocaleString()}
                      </p>
                    </button>
                    <button
                      aria-label={`Dismiss ${item.title}`}
                      onClick={() => void n.dismiss(item.id)}
                      className="h-8 w-8 shrink-0 rounded-full text-orv-muted hover:bg-orv-track"
                    >
                      <X size={16} className="mx-auto" />
                    </button>
                    {item.actions.some((a) => !a.open && !a.reply) ? (
                      <div
                        className="flex basis-full flex-wrap gap-1.5 pl-5"
                        role="group"
                        aria-label={`Actions for ${item.title}`}
                      >
                        {item.actions
                          .filter((a) => !a.open && !a.reply)
                          .map((a) => (
                            <Button
                              key={a.id}
                              size="sm"
                              variant={a.id === 'done' ? 'primary' : 'secondary'}
                              onClick={() =>
                                void n
                                  .act(item.id, a.id)
                                  .catch(() => toast({ title: 'That didn’t work', tone: 'danger' }))
                              }
                            >
                              {a.label}
                            </Button>
                          ))}
                      </div>
                    ) : null}
                    {item.actions
                      .filter((a) => a.reply)
                      .map((a) => (
                        <ReplyBox
                          key={a.id}
                          label={`${a.label} to ${item.title}`}
                          placeholder={a.reply!.placeholder}
                          onSend={(text) => n.act(item.id, a.id, text)}
                        />
                      ))}
                  </motion.li>
                ))}
              </AnimatePresence>
              {!n.items.length ? (
                <Empty title="All quiet">
                  <span className="inline-flex items-center gap-1">
                    <BellOff size={14} /> Nothing needs you right now.
                  </span>
                </Empty>
              ) : null}
            </ul>
          </motion.aside>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

/** A short typed answer to a notification ("food", "split 3", "not mine"); Enter sends. */
function ReplyBox({
  label,
  placeholder,
  onSend,
}: {
  label: string;
  placeholder: string;
  onSend(text: string): Promise<void>;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      await onSend(text.trim());
      setText('');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="flex basis-full items-center gap-1.5 pl-5"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        maxLength={200}
        className="h-9 min-w-0 flex-1 rounded-full field-ring px-3 text-[14px] outline-none placeholder:text-orv-faint focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--orv-accent)_25%,transparent)]"
      />
      <Button
        size="sm"
        variant="primary"
        type="submit"
        loading={busy}
        disabled={!text.trim()}
        aria-label="Send reply"
      >
        <Send size={14} />
      </Button>
    </form>
  );
}

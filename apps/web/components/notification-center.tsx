'use client';

import { BellOff, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useRouter } from 'next/navigation';
import { Empty } from '@/components/ui/bits';
import { Button } from '@/components/ui/button';
import { spring } from '@/lib/motion';
import { useNotifications } from '@/lib/notifications';

export function NotificationCenter({ open, onClose }: { open: boolean; onClose(): void }) {
  const n = useNotifications();
  const router = useRouter();
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
                    className="glass-pane flex gap-3 p-3"
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
                          router.push(item.url);
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

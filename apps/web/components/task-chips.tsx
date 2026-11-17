'use client';

import type { Parsed, SpanKind } from '@orvyn/today-parse';
import { CalendarDays, Clock, Flag, Folder, Hash, Repeat, Timer, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { ReactNode } from 'react';
import { spring } from '@/lib/motion';
import { chipLabel } from '@/lib/smart-task';

const ICON: Record<SpanKind, ReactNode> = {
  date: <CalendarDays size={12} aria-hidden />,
  time: <Clock size={12} aria-hidden />,
  repeat: <Repeat size={12} aria-hidden />,
  duration: <Timer size={12} aria-hidden />,
  priority: <Flag size={12} aria-hidden />,
  tag: <Hash size={12} aria-hidden />,
  project: <Folder size={12} aria-hidden />,
};

/** What ORVYN understood, as chips. Removing one makes that part plain text again (it stays in the title). */
export function TaskChips({
  parsed,
  projects,
  onRemove,
}: {
  parsed: Parsed | null;
  projects: { id: string; name: string }[];
  onRemove(range: [number, number], text: string): void;
}) {
  const spans = parsed?.spans ?? [];
  return (
    <ul aria-label="Understood" className="flex min-h-0 flex-wrap gap-1.5">
      <AnimatePresence initial={false}>
        {spans.map((s) => (
          <motion.li
            key={`${s.kind}-${s.start}`}
            layout
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.85 }}
            transition={spring.snappy}
            className="flex items-center gap-1 rounded-full border border-[color-mix(in_srgb,var(--orv-accent)_40%,transparent)] bg-[color-mix(in_srgb,var(--orv-accent)_12%,transparent)] py-0.5 pl-2 pr-1 text-[12px] font-semibold text-orv-accent"
          >
            {ICON[s.kind]}
            <span>{parsed ? chipLabel(s, parsed, projects) : s.text}</span>
            <button
              type="button"
              aria-label={`Not a ${s.kind}: “${s.text}”`}
              onClick={() => onRemove([s.start, s.end], s.text)}
              className="rounded-full p-0.5 hover:bg-orv-track"
            >
              <X size={11} />
            </button>
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}

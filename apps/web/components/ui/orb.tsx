'use client';

import { motion } from 'motion/react';
import { spring } from '@/lib/motion';

/** ORVYN's signature capture button. States show as light: idle glow, thinking shimmer, needs-you quick pulse. */
export function Orb({
  onClick,
  size = 64,
  state = 'idle',
  label = 'Capture anything',
}: {
  onClick?(): void;
  size?: number;
  state?: 'idle' | 'thinking' | 'needs-you';
  label?: string;
}) {
  return (
    <motion.button
      type="button"
      aria-label={label}
      onClick={onClick}
      whileHover={{ scale: 1.04 }}
      whileTap={{ scale: 0.92 }}
      transition={spring.snappy}
      className="relative isolate flex items-center justify-center overflow-hidden rounded-full border border-white/55"
      style={{
        width: size,
        height: size,
        background:
          'radial-gradient(circle at 35% 30%, color-mix(in srgb, white 70%, var(--orv-accent-from)), var(--orv-accent-from) 45%, var(--orv-accent-to))',
        animation: `orv-orb-pulse ${state === 'needs-you' ? 1.2 : 3.2}s ease-in-out infinite`,
      }}
    >
      <span
        aria-hidden
        className="absolute -inset-[20%] mix-blend-overlay"
        style={{
          background: 'conic-gradient(from 0deg, transparent, rgb(255 255 255 / .45), transparent 40%)',
          animation: `orv-spin ${state === 'thinking' ? 1.4 : 6}s linear infinite`,
        }}
      />
      <span
        aria-hidden
        className="absolute rounded-full bg-white/55 blur-[3px]"
        style={{ top: size * 0.14, left: size * 0.24, width: size * 0.38, height: size * 0.18 }}
      />
      <svg
        aria-hidden
        className="relative"
        width={size * 0.36}
        height={size * 0.36}
        viewBox="0 0 24 24"
        fill="none"
        stroke="white"
        strokeWidth="2"
        strokeLinecap="round"
      >
        <path d="M12 5v14M5 12h14" />
      </svg>
    </motion.button>
  );
}

'use client';

import { X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { spring } from '@/lib/motion';
import { Logo } from '@/components/logo';

export function Glass({
  level = 'pane',
  className,
  children,
  as: As = 'div',
  role,
  'aria-label': ariaLabel,
}: {
  level?: 'pane' | 'float' | 'halo';
  className?: string;
  children?: ReactNode;
  as?: 'div' | 'section' | 'aside' | 'nav';
  role?: string;
  'aria-label'?: string;
}) {
  return (
    <As
      role={role}
      aria-label={ariaLabel}
      className={cn(
        level === 'pane'
          ? 'glass-pane'
          : level === 'float'
            ? 'glass-float edge-light'
            : 'glass-halo edge-light',
        className,
      )}
    >
      {children}
    </As>
  );
}

export function Label({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn('text-label uppercase text-orv-accent', className)}>{children}</span>;
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger';
}) {
  const tones = {
    neutral: 'bg-orv-track text-orv-muted',
    accent: 'bg-[color-mix(in_srgb,var(--orv-accent)_14%,transparent)] text-orv-accent',
    success: 'bg-[color-mix(in_srgb,var(--orv-success)_14%,transparent)] text-orv-success',
    warning: 'bg-[color-mix(in_srgb,var(--orv-warning)_16%,transparent)] text-orv-warning',
    danger: 'bg-[color-mix(in_srgb,var(--orv-danger)_14%,transparent)] text-orv-danger',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold',
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}

export function Avatar({ name, src, size = 40 }: { name: string; src?: string | null; size?: number }) {
  const initial = (name || '?').trim().charAt(0).toUpperCase();
  return src ? (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      className="rounded-full border border-orv-edge object-cover"
      referrerPolicy="no-referrer"
    />
  ) : (
    <span
      aria-hidden
      style={{ width: size, height: size }}
      className="glass-pane inline-flex items-center justify-center !rounded-full font-semibold"
    >
      {initial}
    </span>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange(v: boolean): void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-7 w-12 shrink-0 rounded-full border border-orv-edge transition-colors disabled:opacity-50',
        checked ? '[background:var(--orv-accent-grad)]' : 'bg-orv-track',
      )}
    >
      <motion.span
        layout
        transition={spring.snappy}
        className={cn(
          'absolute top-0.5 h-[22px] w-[22px] rounded-full bg-white shadow',
          checked ? 'right-0.5' : 'left-0.5',
        )}
      />
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange(v: T): void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="glass-pane inline-flex gap-1 !rounded-full p-1">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cn(
              'relative h-8 rounded-full px-3 text-[13px] font-medium transition-colors',
              on ? 'text-white' : 'text-orv-muted hover:text-orv-text',
            )}
          >
            {on ? (
              <motion.span
                layoutId={`seg-${label}`}
                transition={spring.snappy}
                className="absolute inset-0 rounded-full [background:var(--orv-accent-grad)]"
              />
            ) : null}
            <span className="relative">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function Empty({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <Logo size={56} glyph className="opacity-90" />
      <p className="text-heading font-semibold">{title}</p>
      {children ? <p className="max-w-sm text-small text-orv-muted">{children}</p> : null}
      {action}
    </div>
  );
}

// ---------------------------------------------------------------- sheets
export function Sheet({
  open,
  onClose,
  title,
  children,
  wide,
  footer,
  subtitle,
}: {
  open: boolean;
  onClose(): void;
  title: string;
  children: ReactNode;
  /** a viewer or a big table: more room */
  wide?: boolean;
  /** the actions (Save, Cancel…): pinned to the bottom so they never scroll away on a long form */
  footer?: ReactNode;
  subtitle?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[60] flex items-end justify-center p-0 sm:items-center sm:p-3"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <button
            aria-hidden
            tabIndex={-1}
            className="absolute inset-0 cursor-default bg-orv-scrim backdrop-blur-[6px]"
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={{ y: 40, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 30, opacity: 0 }}
            transition={spring.smooth}
            className={cn(
              'glass-halo edge-light relative flex max-h-[calc(100dvh-0.75rem)] w-full flex-col overflow-hidden !rounded-b-none sm:max-h-[calc(100dvh-1.5rem)] sm:!rounded-b-[var(--orv-glass-halo-radius)]',
              wide ? 'max-w-4xl' : 'max-w-lg',
            )}
          >
            <div className="flex shrink-0 items-start gap-3 px-5 pb-3 pt-4">
              <span
                aria-hidden
                className="absolute left-1/2 top-1.5 h-1 w-10 -translate-x-1/2 rounded-full bg-orv-track sm:hidden"
              />
              <div className="min-w-0 flex-1">
                <h2 className="text-heading font-semibold">{title}</h2>
                {subtitle ? <p className="mt-0.5 text-small text-orv-muted">{subtitle}</p> : null}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="-mr-1 grid h-8 w-8 shrink-0 place-items-center rounded-full text-orv-muted transition-colors hover:bg-orv-track hover:text-orv-text"
              >
                <X size={16} aria-hidden />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5">{children}</div>
            {footer ? (
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-orv-hairline bg-[color-mix(in_srgb,var(--orv-glass-strong)_60%,transparent)] px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                {footer}
              </div>
            ) : null}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

// ---------------------------------------------------------------- toasts ("edge glow")
interface Toast {
  id: number;
  title: string;
  body?: string;
  tone?: 'neutral' | 'success' | 'danger';
}
const ToastCtx = createContext<(t: Omit<Toast, 'id'>) => void>(() => undefined);
export const useToast = () => useContext(ToastCtx);

/** Arrivals glow softly at the screen edge and settle into a small glass card — never a banner over content. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs.slice(-2), { ...t, id }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 5000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex flex-col items-end gap-2 p-4"
      >
        <AnimatePresence>
          {items.map((t) => (
            <motion.div
              key={t.id}
              layout
              initial={{ x: 40, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 40, opacity: 0 }}
              transition={spring.smooth}
              className="glass-float pointer-events-auto w-full max-w-sm px-4 py-3"
            >
              <p
                className={cn(
                  'text-[14px] font-semibold',
                  t.tone === 'danger' && 'text-orv-danger',
                  t.tone === 'success' && 'text-orv-success',
                )}
              >
                {t.title}
              </p>
              {t.body ? <p className="text-small text-orv-muted">{t.body}</p> : null}
            </motion.div>
          ))}
        </AnimatePresence>
        <AnimatePresence>
          {items.length ? (
            <motion.span
              key="glow"
              aria-hidden
              className="fixed right-0 top-0 h-full w-1.5"
              style={{
                background: 'linear-gradient(180deg, transparent, var(--orv-accent), transparent)',
                animation: 'orv-edge-glow 2.4s ease-out forwards',
              }}
            />
          ) : null}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}

// ---------------------------------------------------------------- loading (spec 0007 B: every data view has one)
/** A shimmering block; give it the size of what will appear so nothing jumps when data lands. */
export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden className={cn('skeleton block', className)} />;
}

/** Rows shaped like list items (avatar/icon, two lines, a trailing value). */
export function SkeletonRows({
  rows = 4,
  icon = true,
  label = 'Loading',
  className,
}: {
  rows?: number;
  icon?: boolean;
  label?: string;
  className?: string;
}) {
  return (
    <div role="status" aria-label={label} aria-busy className={cn('flex flex-col gap-2', className)}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="glass-pane flex items-center gap-3 p-3" style={{ opacity: 1 - i * 0.14 }}>
          {icon ? <Skeleton className="h-9 w-9 shrink-0 !rounded-full" /> : null}
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton className="h-3.5" />
            <Skeleton className="h-3 w-2/5" />
          </div>
          <Skeleton className="h-4 w-14" />
        </div>
      ))}
    </div>
  );
}

/** Cards in a grid (dashboard tiles, people, documents). */
export function SkeletonCards({
  count = 3,
  className,
  label = 'Loading',
}: {
  count?: number;
  className?: string;
  label?: string;
}) {
  return (
    <div role="status" aria-label={label} aria-busy className={cn('grid gap-3 md:grid-cols-2', className)}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="glass-pane flex flex-col gap-3 p-5">
          <div className="flex items-center gap-3">
            <Skeleton className="h-10 w-10 shrink-0 !rounded-full" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-3.5 w-1/2" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </div>
          <Skeleton className="h-16" />
        </div>
      ))}
    </div>
  );
}

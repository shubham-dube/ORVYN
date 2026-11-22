'use client';

import { Check } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Sheet } from '@/components/ui/bits';
import { cn } from '@/lib/cn';

export interface PickOption<T> {
  value: T;
  label: string;
  sub?: string;
  icon?: ReactNode;
  colour?: string | null;
  selected?: boolean;
}

/** One choice from a short list, as big rows in a sheet (When, Priority, Project, Status …). */
export function PickSheet<T>({
  open,
  title,
  options,
  onPick,
  onClose,
  footer,
}: {
  open: boolean;
  title: string;
  options: PickOption<T>[];
  onPick(v: T): void;
  onClose(): void;
  footer?: ReactNode;
}) {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <ul className="-mx-2 flex flex-col" role="listbox" aria-label={title}>
        {options.map((o, i) => (
          <li key={i}>
            <button
              type="button"
              role="option"
              aria-selected={!!o.selected}
              onClick={() => {
                onPick(o.value);
                onClose();
              }}
              className={cn(
                'flex w-full items-center gap-3 rounded-orv-md px-3 py-2.5 text-left transition-colors hover:bg-orv-track',
                o.selected && 'bg-[color-mix(in_srgb,var(--orv-accent)_10%,transparent)]',
              )}
            >
              {o.colour ? (
                <span aria-hidden className="size-3 shrink-0 rounded-full" style={{ background: o.colour }} />
              ) : o.icon ? (
                <span
                  aria-hidden
                  className={cn('shrink-0', o.selected ? 'text-orv-accent' : 'text-orv-muted')}
                >
                  {o.icon}
                </span>
              ) : null}
              <span className="flex min-w-0 flex-1 flex-col">
                <span className={cn('text-[15px]', o.selected ? 'font-semibold' : 'font-medium')}>
                  {o.label}
                </span>
                {o.sub ? <span className="text-[12px] text-orv-muted">{o.sub}</span> : null}
              </span>
              {o.selected ? <Check size={16} className="text-orv-accent" aria-hidden /> : null}
            </button>
          </li>
        ))}
      </ul>
      {footer}
    </Sheet>
  );
}

/** usePick(): `ask(title, options)` resolves with the choice (or null), with the sheet rendered by `<Picker/>`. */
export function usePick() {
  const [state, setState] = useState<{
    title: string;
    options: PickOption<unknown>[];
    resolve(v: unknown): void;
  } | null>(null);
  const ask = <T,>(title: string, options: PickOption<T>[]) =>
    new Promise<T | null>((resolve) =>
      setState({
        title,
        options: options as PickOption<unknown>[],
        resolve: resolve as (v: unknown) => void,
      }),
    );
  const picker = (
    <PickSheet
      open={!!state}
      title={state?.title ?? ''}
      options={state?.options ?? []}
      onPick={(v) => {
        state?.resolve(v);
        setState(null);
      }}
      onClose={() => {
        state?.resolve(null);
        setState(null);
      }}
    />
  );
  return { ask, picker };
}

/** A fact about a task as a pill: set ones glow in their colour, unset ones are quiet with a "+". */
export function FactPill({
  icon,
  label,
  set = true,
  tone,
  onClick,
  onClear,
  ariaLabel,
}: {
  icon: ReactNode;
  label: string;
  set?: boolean;
  tone?: string;
  onClick(): void;
  onClear?(): void;
  ariaLabel?: string;
}) {
  const c = tone ?? 'var(--orv-accent)';
  return (
    <span
      className={cn(
        'inline-flex h-8 items-center rounded-full border text-[13px] font-semibold transition-colors',
        set ? '' : 'border-orv-edge text-orv-muted hover:border-orv-accent hover:text-orv-text',
      )}
      style={
        set
          ? {
              borderColor: `color-mix(in srgb, ${c} 45%, transparent)`,
              background: `color-mix(in srgb, ${c} 12%, transparent)`,
              color: c,
            }
          : undefined
      }
    >
      <button
        type="button"
        onClick={onClick}
        aria-label={ariaLabel ?? label}
        className="inline-flex h-full items-center gap-1.5 rounded-full pl-2.5 pr-3"
      >
        <span aria-hidden className="inline-flex">
          {icon}
        </span>
        {set ? label : `+ ${label}`}
      </button>
      {set && onClear ? (
        <button
          type="button"
          onClick={onClear}
          aria-label={`Clear ${label}`}
          className="-ml-1.5 mr-1 grid size-5 place-items-center rounded-full opacity-70 hover:bg-orv-track hover:opacity-100"
        >
          ×
        </button>
      ) : null}
    </span>
  );
}

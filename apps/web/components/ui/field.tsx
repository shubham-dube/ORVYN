'use client';

import { forwardRef, useId, useRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cn(
        'field-ring h-12 w-full rounded-orv-md px-4 text-[16px] text-orv-text placeholder:text-orv-faint outline-none disabled:opacity-55',
        className,
      )}
      {...rest}
    />
  );
});

/** A multi-line field with the same look as Input. */
export const TextArea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function TextArea({ className, ...rest }, ref) {
    return (
      <textarea
        ref={ref}
        className={cn(
          'field-ring w-full rounded-orv-md p-3 text-[15px] text-orv-text placeholder:text-orv-faint outline-none',
          className,
        )}
        {...rest}
      />
    );
  },
);

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-small font-medium text-orv-muted">
        {label}
      </label>
      {children(id)}
      {error ? (
        <p role="alert" className="text-small text-orv-danger">
          {error}
        </p>
      ) : hint ? (
        <p className="text-small text-orv-muted">{hint}</p>
      ) : null}
    </div>
  );
}

/** Six boxes for a one-time code: types, pastes and autofills (iOS/Android SMS-style one-time-code). */
export function CodeInput({
  value,
  onChange,
  onComplete,
  disabled,
}: {
  value: string;
  onChange(v: string): void;
  onComplete?(v: string): void;
  disabled?: boolean;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const set = (next: string) => {
    const clean = next.replace(/\D/g, '').slice(0, 6);
    onChange(clean);
    if (clean.length === 6) onComplete?.(clean);
    refs.current[Math.min(clean.length, 5)]?.focus();
  };
  return (
    <div className="flex justify-between gap-2" role="group" aria-label="6-digit code">
      {Array.from({ length: 6 }, (_, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          aria-label={`Digit ${i + 1}`}
          disabled={disabled}
          value={value[i] ?? ''}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, '');
            if (v.length > 1) return set(value.slice(0, i) + v); // paste or autofill
            set((value.slice(0, i) + v + value.slice(i + 1)).slice(0, 6));
          }}
          onKeyDown={(e) => {
            if (e.key === 'Backspace' && !value[i] && i > 0) {
              e.preventDefault();
              set(value.slice(0, i - 1));
            }
          }}
          className="field-ring tabular h-14 w-full min-w-0 rounded-orv-md text-center font-mono text-2xl font-semibold text-orv-text outline-none"
        />
      ))}
    </div>
  );
}

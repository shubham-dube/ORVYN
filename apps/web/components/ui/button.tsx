'use client';

import { motion, type HTMLMotionProps } from 'motion/react';
import { forwardRef } from 'react';
import { cn } from '@/lib/cn';
import { spring } from '@/lib/motion';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const variants: Record<Variant, string> = {
  primary:
    'text-white shadow-[0_10px_26px_color-mix(in_srgb,var(--orv-accent-from)_35%,transparent)] [background:var(--orv-accent-grad)]',
  secondary: 'glass-pane text-orv-text',
  ghost: 'bg-transparent text-orv-text hover:bg-orv-track',
  danger: 'bg-transparent text-orv-danger border border-current/30 hover:bg-orv-track',
};
const sizes: Record<Size, string> = {
  sm: 'h-9 px-3 text-sm rounded-orv-sm gap-1.5',
  md: 'h-11 px-4 text-[15px] rounded-orv-md gap-2',
  lg: 'h-12 px-5 text-base rounded-orv-md gap-2',
};

export interface ButtonProps extends Omit<HTMLMotionProps<'button'>, 'children'> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  children?: React.ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, disabled, className, children, ...rest },
  ref,
) {
  return (
    <motion.button
      ref={ref}
      whileTap={{ scale: 0.96 }}
      transition={spring.snappy}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex select-none items-center justify-center font-medium transition-[background,opacity,box-shadow] disabled:cursor-not-allowed disabled:opacity-55',
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner /> : null}
      {children}
    </motion.button>
  );
});

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block h-4 w-4 rounded-full border-2 border-current border-r-transparent',
        className,
      )}
      style={{ animation: 'orv-spin .7s linear infinite' }}
    />
  );
}

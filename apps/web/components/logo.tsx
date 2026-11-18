import { cn } from '@/lib/cn';

/** The ORVYN mark (a world of your own with everything in orbit); `glyph` drops the tile behind it. */
export function Logo({
  size = 28,
  glyph = false,
  className,
}: {
  size?: number;
  glyph?: boolean;
  className?: string;
}) {
  return (
    <img
      src={glyph ? '/brand/glyph.svg' : '/brand/mark.svg'}
      width={size}
      height={size}
      alt=""
      aria-hidden
      className={cn('shrink-0 select-none', className)}
      draggable={false}
    />
  );
}

/** Mark + wordmark, for headers. */
export function Wordmark({ size = 30 }: { size?: number }) {
  return (
    <span className="flex items-center gap-2.5">
      <Logo size={size} />
      <span className="text-[17px] font-semibold tracking-[0.2em]">ORVYN</span>
    </span>
  );
}

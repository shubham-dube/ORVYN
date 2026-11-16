/** The living-light background: three slow aurora blobs under a soft veil, coloured by the current phase. */
export function Aurora() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-orv-base transition-colors duration-[1200ms]"
    >
      <div
        className="absolute -left-[12vw] -top-[18vh] h-[60vmax] w-[60vmax] rounded-full opacity-90 blur-[90px] transition-colors duration-[1200ms]"
        style={{
          background: 'var(--orv-aurora-1)',
          animation: 'orv-drift-1 28s ease-in-out infinite alternate',
        }}
      />
      <div
        className="absolute -right-[18vw] top-[12vh] h-[52vmax] w-[52vmax] rounded-full opacity-85 blur-[90px] transition-colors duration-[1200ms]"
        style={{
          background: 'var(--orv-aurora-2)',
          animation: 'orv-drift-2 32s ease-in-out infinite alternate',
        }}
      />
      <div
        className="absolute -bottom-[22vh] left-[18vw] h-[58vmax] w-[58vmax] rounded-full opacity-80 blur-[100px] transition-colors duration-[1200ms]"
        style={{
          background: 'var(--orv-aurora-3)',
          animation: 'orv-drift-3 36s ease-in-out infinite alternate',
        }}
      />
      <div className="absolute inset-0" style={{ background: 'var(--orv-veil)' }} />
    </div>
  );
}

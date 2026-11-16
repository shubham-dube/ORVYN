import { ImageResponse } from 'next/og';

/** App icon: the Orb on deep night glass, rendered at any size (manifest, apple-touch, notifications). */
export async function GET(req: Request, { params }: { params: Promise<{ size: string }> }) {
  const size = Math.min(Math.max(Number((await params).size) || 192, 48), 1024);
  const maskable = new URL(req.url).searchParams.has('maskable');
  const orb = Math.round(size * (maskable ? 0.46 : 0.62));
  return new ImageResponse(
    <div
      style={{
        width: size,
        height: size,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'radial-gradient(circle at 30% 20%, #1e3a8a, #05070f 70%)',
        borderRadius: maskable ? 0 : size * 0.22,
      }}
    >
      <div
        style={{
          width: orb,
          height: orb,
          borderRadius: orb,
          background: 'radial-gradient(circle at 35% 30%, #bfe3ff, #3b82f6 45%, #0f766e)',
          boxShadow: `0 0 ${size * 0.12}px rgba(59,130,246,.75)`,
          display: 'flex',
        }}
      />
    </div>,
    { width: size, height: size, headers: { 'cache-control': 'public, max-age=86400, immutable' } },
  );
}

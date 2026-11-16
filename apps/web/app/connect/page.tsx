'use client';

import { Laptop, Puzzle, ShieldCheck } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { Glass } from '@/components/ui/bits';
import { Button } from '@/components/ui/button';
import { Orb } from '@/components/ui/orb';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';

/**
 * `/connect?redirect_uri=…&code_challenge=…&state=…` — the desktop app or the Chrome extension sends you here to
 * connect it to your account. Nothing happens until you press Connect; the API decides which apps may ask.
 */
export default function ConnectPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <Suspense>
        <Connect />
      </Suspense>
    </main>
  );
}

function Connect() {
  const { status, me } = useSession();
  const router = useRouter();
  const params = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const req = useMemo(
    () => ({
      redirectUri: params.get('redirect_uri') ?? '',
      challenge: params.get('code_challenge') ?? '',
      state: params.get('state') ?? '',
    }),
    [params],
  );
  const kind = req.redirectUri.includes('.chromiumapp.org') ? 'extension' : 'desktop';

  useEffect(() => {
    if (status === 'signedOut') {
      router.replace(`/sign-in?next=${encodeURIComponent(`/connect?${params.toString()}`)}`);
    }
  }, [status, router, params]);

  if (status !== 'signedIn') {
    return <Orb size={56} state="thinking" label="Loading" />;
  }

  const approve = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ redirect: string }>('/auth/link/start', { method: 'POST', body: req });
      setDone(true);
      window.location.assign(r.redirect);
    } catch (e) {
      setError(
        e instanceof ApiError && e.code === 'redirect_not_allowed'
          ? 'This app isn’t one ORVYN trusts. Nothing was connected.'
          : 'That didn’t work. Start again from the app.',
      );
      setBusy(false);
    }
  };

  return (
    <Glass level="halo" className="flex w-full max-w-[420px] flex-col items-center gap-5 p-8 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full text-white [background:var(--orv-accent-grad)]">
        {kind === 'extension' ? <Puzzle size={26} aria-hidden /> : <Laptop size={26} aria-hidden />}
      </span>
      <div className="flex flex-col gap-1">
        <h1 className="text-title font-semibold">
          {kind === 'extension' ? 'Connect ORVYN for Chrome?' : 'Connect ORVYN for Windows?'}
        </h1>
        <p className="text-small text-orv-muted">
          It will sign in as <span className="font-medium text-orv-text">{me?.email}</span> and appear in your
          devices, where you can sign it out any time.
        </p>
      </div>
      {error ? (
        <p role="alert" className="text-small text-orv-danger">
          {error}
        </p>
      ) : null}
      {done ? (
        <p className="text-small text-orv-muted">Connected — you can go back to the app.</p>
      ) : (
        <div className="flex w-full flex-col gap-2">
          <Button variant="primary" size="lg" loading={busy} onClick={() => void approve()}>
            <ShieldCheck size={18} aria-hidden /> Connect
          </Button>
          <Button variant="ghost" onClick={() => router.replace('/')}>
            Not now
          </Button>
        </div>
      )}
    </Glass>
  );
}

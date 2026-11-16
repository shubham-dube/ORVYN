'use client';

import { Fingerprint, Mail } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import { Glass, Label } from '@/components/ui/bits';
import { Button } from '@/components/ui/button';
import { CodeInput, Field, Input } from '@/components/ui/field';
import { Orb } from '@/components/ui/orb';
import { ApiError } from '@/lib/api';
import { spring } from '@/lib/motion';
import { useSession } from '@/lib/session';

const GOOGLE = process.env.NEXT_PUBLIC_GOOGLE_ENABLED === '1';
const ERRORS: Record<string, string> = {
  invite_required: 'ORVYN is invite-only. Ask for an invite link.',
  expired: 'That took too long. Please try again.',
  account_disabled: 'This account has been disabled.',
};

export function SignInCard({
  invite,
  heading = 'Welcome back',
  sub,
}: {
  invite?: string;
  heading?: string;
  sub?: string;
}) {
  const s = useSession();
  const router = useRouter();
  const params = useSearchParams();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<null | 'email' | 'code' | 'passkey'>(null);
  const [error, setError] = useState<string | null>(
    ERRORS[params.get('error') ?? ''] ?? (params.get('error') ? 'Sign-in failed. Please try again.' : null),
  );

  useEffect(() => {
    if (s.status === 'signedIn') router.replace(safeNext(params.get('next')));
  }, [s.status, router, params]);

  const run = async (kind: 'email' | 'code' | 'passkey', fn: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    try {
      await fn();
    } catch (e) {
      if (e instanceof Error && e.name === 'NotAllowedError')
        setError(null); // user closed the passkey prompt
      else setError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(null);
    }
  };

  const submitEmail = (e: FormEvent) => {
    e.preventDefault();
    void run('email', async () => {
      await s.startEmail(email.trim().toLowerCase(), invite);
      setStep('code');
    });
  };
  const submitCode = (value = code) =>
    run('code', async () => {
      await s.verifyEmail(email.trim().toLowerCase(), value, invite);
    });

  return (
    <Glass level="halo" className="w-full max-w-[420px] p-7 sm:p-8">
      <div className="mb-7 flex flex-col items-center gap-4 text-center">
        <Orb size={56} label="ORVYN" />
        <div className="flex flex-col gap-1">
          <h1 className="text-title font-semibold">{heading}</h1>
          <p className="text-small text-orv-muted">{sub ?? 'Sign in to your ORVYN.'}</p>
        </div>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        {step === 'email' ? (
          <motion.div
            key="email"
            initial={{ opacity: 0, x: -16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16 }}
            transition={spring.smooth}
            className="flex flex-col gap-4"
          >
            {!invite ? (
              <Button
                variant="primary"
                size="lg"
                loading={busy === 'passkey'}
                onClick={() => run('passkey', s.signInWithPasskey)}
              >
                <Fingerprint size={18} aria-hidden /> Sign in with passkey
              </Button>
            ) : null}
            {GOOGLE ? (
              <a
                href={s.googleUrl(invite)}
                className="glass-pane inline-flex h-12 items-center justify-center gap-2 rounded-orv-md font-medium"
              >
                <GoogleMark /> Continue with Google
              </a>
            ) : null}
            <div className="flex items-center gap-3 text-[12px] text-orv-faint">
              <span className="h-px flex-1 bg-orv-hairline" />
              or with email
              <span className="h-px flex-1 bg-orv-hairline" />
            </div>
            <form onSubmit={submitEmail} className="flex flex-col gap-3">
              <Field label="Email" error={error}>
                {(id) => (
                  <Input
                    id={id}
                    type="email"
                    autoComplete="email webauthn"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                  />
                )}
              </Field>
              <Button
                type="submit"
                variant={invite ? 'primary' : 'secondary'}
                size="lg"
                loading={busy === 'email'}
              >
                <Mail size={18} aria-hidden /> Email me a code
              </Button>
            </form>
          </motion.div>
        ) : (
          <motion.div
            key="code"
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 16 }}
            transition={spring.smooth}
            className="flex flex-col gap-4"
          >
            <div className="flex flex-col gap-1 text-center">
              <Label>Check your inbox</Label>
              <p className="text-small text-orv-muted">
                If <span className="font-medium text-orv-text">{email}</span> can sign in, a 6-digit code is
                on its way.
              </p>
            </div>
            <CodeInput
              value={code}
              onChange={setCode}
              onComplete={(v) => void submitCode(v)}
              disabled={busy === 'code'}
            />
            {error ? (
              <p role="alert" className="text-center text-small text-orv-danger">
                {error}
              </p>
            ) : null}
            <Button
              variant="primary"
              size="lg"
              loading={busy === 'code'}
              disabled={code.length !== 6}
              onClick={() => void submitCode()}
            >
              Sign in
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setStep('email');
                setCode('');
                setError(null);
              }}
            >
              Use a different email
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </Glass>
  );
}

function GoogleMark() {
  return (
    <svg aria-hidden width="18" height="18" viewBox="0 0 48 48">
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"
      />
    </svg>
  );
}

/** Only same-site paths: `/connect?…` yes, `//evil.example` or `https://…` no (no open redirect). */
export function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : '/';
}

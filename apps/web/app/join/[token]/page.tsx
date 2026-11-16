'use client';

import { use, useEffect, useState, Suspense } from 'react';
import { SignInCard } from '@/components/sign-in-card';
import { Glass } from '@/components/ui/bits';
import { Orb } from '@/components/ui/orb';
import { api } from '@/lib/api';

export default function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [preview, setPreview] = useState<{
    valid: boolean;
    invitedBy?: string;
    email?: string | null;
  } | null>(null);
  useEffect(() => {
    api<{ valid: boolean; invitedBy?: string; email?: string | null }>(
      `/invites/${encodeURIComponent(token)}`,
      { auth: false },
    ).then(setPreview, () => setPreview({ valid: false }));
  }, [token]);

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      {preview === null ? (
        <div className="skeleton h-[420px] w-full max-w-[420px] !rounded-[28px]" />
      ) : preview.valid ? (
        <Suspense>
          <SignInCard
            invite={token}
            heading={`${preview.invitedBy} invited you`}
            sub={preview.email ? `Join ORVYN with ${preview.email}.` : 'Create your ORVYN account.'}
          />
        </Suspense>
      ) : (
        <Glass level="halo" className="flex w-full max-w-[420px] flex-col items-center gap-4 p-8 text-center">
          <Orb size={48} />
          <h1 className="text-title font-semibold">This invite can’t be used</h1>
          <p className="text-small text-orv-muted">
            It may have expired or already been used. Ask for a new link.
          </p>
        </Glass>
      )}
    </main>
  );
}

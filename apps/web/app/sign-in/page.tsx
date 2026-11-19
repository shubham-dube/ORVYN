import Link from 'next/link';
import { Suspense } from 'react';
import { SignInCard } from '@/components/sign-in-card';

export const metadata = { title: 'Sign in' };

export default function SignInPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 p-4">
      <Suspense>
        <SignInCard />
      </Suspense>
      <Link href="/welcome" className="text-[13px] text-orv-muted hover:text-orv-accent">
        What is ORVYN? →
      </Link>
    </main>
  );
}

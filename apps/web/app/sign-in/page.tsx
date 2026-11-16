import { Suspense } from 'react';
import { SignInCard } from '@/components/sign-in-card';

export const metadata = { title: 'Sign in' };

export default function SignInPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <Suspense>
        <SignInCard />
      </Suspense>
    </main>
  );
}

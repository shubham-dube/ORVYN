'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { BriefPageBody } from '@/components/brief';

function Inner() {
  const q = useSearchParams();
  return <BriefPageBody openSettings={q.get('settings') === '1'} />;
}

/** The Brief (spec 0009): one calm look at the day. */
export default function BriefPage() {
  return (
    <Suspense>
      <Inner />
    </Suspense>
  );
}

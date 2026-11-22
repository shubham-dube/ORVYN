'use client';

import { PrsView } from '@/components/prs';

/** My pull requests (spec 0012 G): open, to review, merged and closed. */
export default function PrsPage() {
  return (
    <div data-module="today">
      <PrsView />
    </div>
  );
}

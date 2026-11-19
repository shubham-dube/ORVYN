'use client';

import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { use } from 'react';
import { GroupView } from '@/components/split';

export default function SplitGroupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <div className="flex flex-col gap-2">
      <Link
        href="/split"
        className="inline-flex items-center gap-1 px-1 text-[13px] text-orv-muted hover:text-orv-text"
      >
        <ArrowLeft size={14} /> All groups
      </Link>
      <GroupView id={id} />
    </div>
  );
}

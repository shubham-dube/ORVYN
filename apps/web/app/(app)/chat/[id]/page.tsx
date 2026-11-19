'use client';

import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { use } from 'react';
import { ChatList, Thread } from '@/components/chat';

export default function ChatThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <div className="grid h-[calc(100dvh-7rem)] gap-4 md:grid-cols-[320px_1fr]">
      <div className="hidden min-h-0 md:block">
        <ChatList active={id} />
      </div>
      <div className="flex min-h-0 flex-col gap-2">
        <Link href="/chat" className="inline-flex items-center gap-1 text-[13px] text-orv-muted md:hidden">
          <ArrowLeft size={14} /> Chats
        </Link>
        <Thread id={id} />
      </div>
    </div>
  );
}

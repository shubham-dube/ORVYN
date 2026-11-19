'use client';

import { ChatList } from '@/components/chat';

/** Chat (spec 0011): the conversations; a thread opens beside them on wide screens. */
export default function ChatPage() {
  return (
    <div className="grid h-[calc(100dvh-7rem)] gap-4 md:grid-cols-[320px_1fr]">
      <ChatList />
      <div className="hidden place-items-center md:grid">
        <p className="text-small text-orv-muted">Pick a chat, or start a new one.</p>
      </div>
    </div>
  );
}

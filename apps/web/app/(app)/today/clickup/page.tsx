'use client';

import { ClickUpView } from '@/components/clickup';

/** ClickUp without opening ClickUp (spec 0012 B2): every status, the task sheet, time and comments. */
export default function ClickUpPage() {
  return (
    <div data-module="today">
      <ClickUpView />
    </div>
  );
}

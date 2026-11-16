'use client';

import { MODULE_KEYS } from '@orvyn/contracts';
import { useState } from 'react';
import { useTheme } from '@/components/theme-provider';
import { Avatar, Badge, Empty, Glass, Label, Segmented, Switch } from '@/components/ui/bits';
import { Button } from '@/components/ui/button';
import { CodeInput, Field, Input } from '@/components/ui/field';
import { Orb } from '@/components/ui/orb';
import type { ThemePreference } from '@/lib/theme';

/** Every primitive in every light, for design review and visual tests. Not linked from the app. */
export default function Gallery() {
  const { preference, setPreference } = useTheme();
  const [on, setOn] = useState(true);
  const [code, setCode] = useState('');
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-title font-semibold">Aurora Glass</h1>
        <Segmented<ThemePreference>
          label="Light"
          value={preference}
          onChange={setPreference}
          options={[
            { value: 'dawn', label: 'Dawn' },
            { value: 'day', label: 'Day' },
            { value: 'dusk', label: 'Dusk' },
            { value: 'night', label: 'Night' },
          ]}
        />
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {(['pane', 'float', 'halo'] as const).map((l) => (
          <Glass key={l} level={l} className="p-5">
            <Label>{l}</Label>
            <p className="mt-2 text-small text-orv-muted">Text on glass stays readable in every light.</p>
          </Glass>
        ))}
      </div>
      <Glass className="flex flex-wrap items-center gap-3 p-5">
        <Button variant="primary">Primary</Button>
        <Button>Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="danger">Danger</Button>
        <Button variant="primary" loading>
          Loading
        </Button>
        <Button disabled>Disabled</Button>
      </Glass>
      <Glass className="grid gap-4 p-5 md:grid-cols-2">
        <Field label="Input" hint="With a hint">
          {(id) => <Input id={id} placeholder="Type here" />}
        </Field>
        <Field label="Error" error="Something isn’t right">
          {(id) => <Input id={id} defaultValue="oops" />}
        </Field>
        <CodeInput value={code} onChange={setCode} />
        <Switch label="A switch" checked={on} onChange={setOn} />
      </Glass>
      <Glass className="flex flex-wrap items-center gap-3 p-5">
        <Badge>neutral</Badge>
        <Badge tone="accent">accent</Badge>
        <Badge tone="success">success</Badge>
        <Badge tone="warning">warning</Badge>
        <Badge tone="danger">danger</Badge>
        <Avatar name="Asha Rao" />
        <Avatar name="Dev" size={32} />
      </Glass>
      <Glass className="grid gap-3 p-5 sm:grid-cols-3 lg:grid-cols-5">
        {MODULE_KEYS.map((k) => (
          <div key={k} data-module={k} className="glass-pane flex items-center gap-2 p-3">
            <span aria-hidden className="h-6 w-6 rounded-[8px] [background:var(--orv-accent-grad)]" />
            <span className="text-[13px] font-semibold text-orv-accent">{k}</span>
          </div>
        ))}
      </Glass>
      <Glass className="flex flex-wrap items-center justify-around gap-6 p-8">
        <Orb size={64} label="Idle" />
        <Orb size={64} state="thinking" label="Thinking" />
        <Orb size={64} state="needs-you" label="Needs you" />
      </Glass>
      <Glass className="p-5">
        <div className="skeleton h-4 w-2/3 rounded" />
        <div className="skeleton mt-2 h-4 w-1/2 rounded" />
      </Glass>
      <Empty title="All quiet">Nothing needs you right now.</Empty>
    </main>
  );
}

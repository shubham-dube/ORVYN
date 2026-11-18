'use client';

import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';

interface Health {
  store: string;
  ok: boolean;
  ms: number;
  error?: string;
  bucket?: string;
  endpoint?: string;
}

/** Owner: does file storage (R2 / S3 or the server's disk) work end to end right now, and if not, why. */
export function StorageHealth() {
  const [h, setH] = useState<Health | null>(null);
  const [busy, setBusy] = useState(false);
  const check = async () => {
    setBusy(true);
    try {
      setH(await api<Health>('/files/health'));
    } catch (e) {
      setH({ store: '?', ok: false, ms: 0, error: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-3" data-testid="storage-health">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" size="sm" onClick={() => void check()} disabled={busy}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : null} Check storage now
        </Button>
        {h ? (
          <span
            className={`flex items-center gap-1.5 text-[14px] ${h.ok ? 'text-orv-success' : 'text-orv-danger'}`}
          >
            {h.ok ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
            {h.ok ? `Working (${h.store === 's3' ? 'R2 / S3' : 'server disk'}, ${h.ms} ms)` : 'Not working'}
          </span>
        ) : null}
      </div>
      {h && !h.ok ? (
        <div className="rounded-orv-md bg-orv-track p-3 text-[13px]">
          <p className="font-medium">What the storage said</p>
          <p className="mt-1 break-words font-mono text-[12px]">{h.error}</p>
          {h.bucket ? (
            <p className="mt-2 text-orv-muted">
              Bucket <code>{h.bucket}</code> at <code>{h.endpoint}</code>. Check S3_ENDPOINT is
              https://&lt;account-id&gt;.r2.cloudflarestorage.com (no bucket in it), S3_BUCKET is the bucket’s
              name, and the R2 API token has Object Read &amp; Write on that bucket.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

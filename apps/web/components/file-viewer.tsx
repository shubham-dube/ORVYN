'use client';

import { Download, FileQuestion, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { parseCsvRows } from '@/lib/vault-items';
import { Sheet } from '@/components/ui/bits';
import { Button } from '@/components/ui/button';
import { downloadFile } from '@/lib/api';

/** What the viewer can show itself; anything else is offered as a download. */
export type ViewKind = 'image' | 'pdf' | 'audio' | 'video' | 'text' | 'csv' | 'none';

export function viewKind(mime: string, name = ''): ViewKind {
  const m = mime.toLowerCase();
  if (/^image\/(png|jpeg|webp|gif|avif|bmp)$/.test(m)) return 'image';
  if (m === 'application/pdf') return 'pdf';
  if (m.startsWith('audio/')) return 'audio';
  if (m.startsWith('video/')) return 'video';
  if (m === 'text/csv' || m === 'text/tab-separated-values' || /\.(csv|tsv)$/i.test(name)) return 'csv';
  if (m.startsWith('text/') || m === 'application/json') return 'text';
  return 'none';
}

/**
 * Opens a stored file inside ORVYN (spec 0007 A1): photos, PDFs, voice notes and other audio, videos, text and
 * spreadsheets as a table. The bytes come decrypted for their owner only and live in memory while open.
 */
export function FileViewer({
  file,
  onClose,
}: {
  file: { id: string; name: string; mime: string } | null;
  onClose(): void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const kind = file ? viewKind(file.mime, file.name) : 'none';

  useEffect(() => {
    if (!file) return;
    let gone = false;
    let made: string | null = null;
    setUrl(null);
    setText(null);
    setError(null);
    downloadFile(file.id)
      .then(async (blob) => {
        if (gone) return;
        const typed = blob.type ? blob : new Blob([blob], { type: file.mime });
        made = URL.createObjectURL(
          file.mime && blob.type !== file.mime ? new Blob([typed], { type: file.mime }) : typed,
        );
        if (kind === 'text' || kind === 'csv') setText((await blob.text()).slice(0, 400_000));
        setUrl(made);
      })
      .catch((e: Error) => !gone && setError(e.message || 'The file couldn’t be opened.'));
    return () => {
      gone = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [file, kind]);

  const save = () => {
    if (!url || !file) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
  };

  return (
    <Sheet open={!!file} onClose={onClose} title={file?.name ?? 'File'} wide>
      <div className="flex flex-col gap-3" data-testid="file-viewer">
        {error ? (
          <p role="alert" className="text-small text-orv-danger">
            {error}
          </p>
        ) : !url ? (
          <div className="grid h-56 place-items-center rounded-orv-md bg-orv-track" aria-label="Opening">
            <Loader2 className="animate-spin text-orv-accent" aria-hidden />
          </div>
        ) : kind === 'image' ? (
          <img src={url} alt={file!.name} className="max-h-[70dvh] w-full rounded-orv-md object-contain" />
        ) : kind === 'pdf' ? (
          <iframe
            src={url}
            title={file!.name}
            className="h-[70dvh] w-full rounded-orv-md border border-orv-edge bg-white"
          />
        ) : kind === 'audio' ? (
          <div className="flex flex-col items-center gap-3 rounded-orv-md bg-orv-track p-6">
            <AudioWave />
            <audio src={url} controls className="w-full" aria-label={`Play ${file!.name}`} />
          </div>
        ) : kind === 'video' ? (
          <video
            src={url}
            controls
            className="max-h-[70dvh] w-full rounded-orv-md bg-black"
            aria-label={file!.name}
          />
        ) : kind === 'csv' && text !== null ? (
          <CsvTable text={text} />
        ) : kind === 'text' && text !== null ? (
          <pre className="max-h-[65dvh] overflow-auto whitespace-pre-wrap rounded-orv-md bg-orv-track p-4 font-mono text-[13px]">
            {text}
          </pre>
        ) : (
          <div className="flex flex-col items-center gap-2 rounded-orv-md bg-orv-track p-8 text-center">
            <FileQuestion className="text-orv-muted" aria-hidden />
            <p className="text-small text-orv-muted">
              This kind of file opens in its own app. Download it to open it.
            </p>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={save} disabled={!url}>
            <Download size={14} /> Download
          </Button>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

function CsvTable({ text }: { text: string }) {
  const rows = parseCsvRows(text).slice(0, 300);
  const [head, ...body] = rows;
  if (!head) return <p className="text-small text-orv-muted">The file is empty.</p>;
  return (
    <div className="max-h-[65dvh] overflow-auto rounded-orv-md border border-orv-edge">
      <table className="w-full border-collapse text-[13px]">
        <thead className="sticky top-0 bg-orv-field">
          <tr>
            {head.map((h, i) => (
              <th key={i} className="border-b border-orv-edge px-3 py-2 text-left font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((r, i) => (
            <tr key={i} className="odd:bg-orv-track">
              {r.map((c, j) => (
                <td key={j} className="px-3 py-1.5 align-top">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AudioWave() {
  return (
    <div className="flex h-12 items-center gap-1" aria-hidden>
      {Array.from({ length: 28 }, (_, i) => (
        <span
          key={i}
          className="w-1 rounded-full [background:var(--orv-accent-grad)]"
          style={{
            height: `${20 + Math.abs(Math.sin(i * 1.7)) * 80}%`,
            opacity: 0.5 + Math.abs(Math.cos(i)) * 0.5,
          }}
        />
      ))}
    </div>
  );
}

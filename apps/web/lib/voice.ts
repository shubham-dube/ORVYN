'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Speech to text in the browser, done right (spec 0007 A2).
 *
 * The recogniser reports a growing list of results; each `result` event carries only what changed from
 * `resultIndex` on. Earlier code appended the whole list on every event, so words repeated. Here:
 * - final results are kept by their index (replaced, never appended), interim words are shown but never committed;
 * - Chrome on Android sometimes repeats the whole sentence so far as a new final ("pay" → "pay rent" → "pay rent
 *   tomorrow"); a final that extends the previous one replaces it;
 * - when the browser stops by itself after a pause, listening resumes with what was heard kept as the new base;
 * - optionally the audio itself is recorded (MediaRecorder) so it can be kept as a voice note.
 */

interface Alt {
  transcript: string;
}
interface Result {
  isFinal: boolean;
  length: number;
  [i: number]: Alt;
}
interface ResultEvent {
  resultIndex: number;
  results: { length: number; [i: number]: Result };
}
interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: ResultEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** Joins final results, dropping ones that a later result repeats in full (the Android cumulative-final quirk). */
export function joinFinals(finals: (string | undefined)[]): string {
  const out: string[] = [];
  for (const raw of finals) {
    const f = (raw ?? '').trim();
    if (!f) continue;
    const prev = out.at(-1);
    if (prev !== undefined) {
      const a = norm(prev);
      const b = norm(f);
      if (b === a) continue; // the same words again
      if (b.startsWith(a)) {
        out[out.length - 1] = f; // the same sentence, grown
        continue;
      }
      if (a.startsWith(b)) continue; // a shorter repeat of what we have
    }
    out.push(f);
  }
  return out.join(' ');
}

const join = (...parts: string[]) =>
  parts
    .map((p) => p.trim())
    .filter(Boolean)
    .join(' ');

export interface Voice {
  supported: boolean;
  listening: boolean;
  /** the words not yet final (shown greyed, never committed) */
  interim: string;
  /** 0–1, how loud right now (while recording) */
  level: number;
  /** begin listening; `base` is the text already there, which the heard words follow */
  start(base: string): Promise<void>;
  /** stop; resolves with the recording when one was made */
  stop(): Promise<Blob | null>;
  error: string | null;
}

export function useVoice(o: { onText(text: string): void; record?: boolean; lang?: string }): Voice {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const want = useRef(false);
  const rec = useRef<Recognition | null>(null);
  const base = useRef('');
  const finals = useRef<string[]>([]);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const stream = useRef<MediaStream | null>(null);
  const raf = useRef(0);
  const onText = useRef(o.onText);
  onText.current = o.onText;

  const Speech =
    typeof window !== 'undefined'
      ? ((window as unknown as Record<string, unknown>).SpeechRecognition ??
        (window as unknown as Record<string, unknown>).webkitSpeechRecognition)
      : undefined;
  const supported = !!Speech;

  const committed = () => join(base.current, joinFinals(finals.current));

  const begin = useCallback(() => {
    const r = new (Speech as new () => Recognition)();
    r.lang = o.lang || (typeof navigator !== 'undefined' ? navigator.language : '') || 'en-IN';
    r.interimResults = true;
    r.continuous = true;
    r.maxAlternatives = 1;
    finals.current = [];
    r.onresult = (e) => {
      let live = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]!;
        const words = res[0]?.transcript ?? '';
        if (res.isFinal) finals.current[i] = words;
        else live += words;
      }
      setInterim(live.trim());
      onText.current(committed());
    };
    r.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      setError(
        e.error === 'not-allowed' || e.error === 'service-not-allowed'
          ? 'Microphone access is blocked. Allow it in the browser’s site settings.'
          : 'Couldn’t hear that. Try again.',
      );
      want.current = false;
    };
    r.onend = () => {
      // the browser stops after a pause: keep what was heard and listen on, until asked to stop
      base.current = committed();
      finals.current = [];
      setInterim('');
      if (want.current) {
        try {
          begin();
          return;
        } catch {
          /* fall through: stopped */
        }
      }
      setListening(false);
    };
    rec.current = r;
    r.start();
  }, [Speech, o.lang]);

  const meter = (s: MediaStream) => {
    try {
      const ctx = new AudioContext();
      const an = ctx.createAnalyser();
      an.fftSize = 256;
      ctx.createMediaStreamSource(s).connect(an);
      const buf = new Uint8Array(an.frequencyBinCount);
      const tick = () => {
        an.getByteTimeDomainData(buf);
        let peak = 0;
        for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
        setLevel(Math.min(1, peak / 64));
        raf.current = requestAnimationFrame(tick);
      };
      tick();
      return () => void ctx.close();
    } catch {
      return () => undefined;
    }
  };
  const closeMeter = useRef<() => void>(() => undefined);

  const start = useCallback(
    async (text: string) => {
      setError(null);
      base.current = text;
      finals.current = [];
      chunks.current = [];
      want.current = true;
      if (o.record && typeof MediaRecorder !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
        try {
          const s = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true },
          });
          stream.current = s;
          const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((t) =>
            MediaRecorder.isTypeSupported(t),
          );
          const m = new MediaRecorder(s, type ? { mimeType: type } : undefined);
          m.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
          m.start(1000);
          recorder.current = m;
          closeMeter.current = meter(s);
        } catch {
          // no recording (permission or a busy microphone): the words still work
          recorder.current = null;
        }
      }
      if (supported) {
        try {
          begin();
        } catch {
          setError('Couldn’t start listening.');
        }
      }
      setListening(true);
    },
    [begin, o.record, supported],
  );

  const stop = useCallback(async (): Promise<Blob | null> => {
    want.current = false;
    try {
      rec.current?.stop();
    } catch {
      /* already stopped */
    }
    setInterim('');
    setListening(false);
    cancelAnimationFrame(raf.current);
    closeMeter.current();
    setLevel(0);
    const m = recorder.current;
    recorder.current = null;
    const blob = m
      ? await new Promise<Blob | null>((resolve) => {
          m.onstop = () =>
            resolve(
              chunks.current.length ? new Blob(chunks.current, { type: m.mimeType || 'audio/webm' }) : null,
            );
          try {
            m.stop();
          } catch {
            resolve(null);
          }
        })
      : null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    return blob;
  }, []);

  useEffect(
    () => () => {
      want.current = false;
      try {
        rec.current?.abort();
      } catch {
        /* fine */
      }
      stream.current?.getTracks().forEach((t) => t.stop());
      cancelAnimationFrame(raf.current);
    },
    [],
  );

  return {
    supported: supported || typeof MediaRecorder !== 'undefined',
    listening,
    interim,
    level,
    start,
    stop,
    error,
  };
}

/** "voice-2026-11-18-1405.webm" */
export const voiceFileName = (blob: Blob, at = new Date()) => {
  const ext = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm';
  const p = (n: number) => String(n).padStart(2, '0');
  return `voice-${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())}-${p(at.getHours())}${p(at.getMinutes())}.${ext}`;
};

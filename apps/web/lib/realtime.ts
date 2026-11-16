import type { ServerMessage } from '@orvyn/contracts';
import { API_URL, getAccessToken, refreshSession } from './api';

type Handler = (m: ServerMessage) => void;

/** One socket per tab. Reconnects with jittered backoff; re-authenticates after a token refresh. */
export class Realtime {
  private ws: WebSocket | null = null;
  private handlers = new Set<Handler>();
  private attempt = 0;
  private stopped = true;
  private timer: ReturnType<typeof setTimeout> | null = null;

  on(h: Handler): () => void {
    this.handlers.add(h);
    return () => this.handlers.delete(h);
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.ws?.close();
    this.ws = null;
  }

  private connect(): void {
    const token = getAccessToken();
    if (!token || this.stopped) return;
    const ws = new WebSocket(`${API_URL.replace(/^http/, 'ws')}/ws`);
    this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token: getAccessToken() }));
    ws.onmessage = (e) => {
      const msg = JSON.parse(String(e.data)) as ServerMessage;
      if (msg.type === 'hello') this.attempt = 0;
      for (const h of this.handlers) h(msg);
    };
    ws.onclose = async (e) => {
      if (this.stopped || this.ws !== ws) return;
      if (e.code === 4401) {
        const s = await refreshSession(); // expired token: refresh once, then reconnect
        if (!s) return this.stop();
      }
      const delay = Math.min(30_000, 1000 * 2 ** this.attempt++) * (0.7 + Math.random() * 0.6);
      this.timer = setTimeout(() => this.connect(), delay);
    };
  }
}

export const realtime = typeof window === 'undefined' ? null : new Realtime();

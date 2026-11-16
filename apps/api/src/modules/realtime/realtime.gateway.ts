import { Logger } from '@nestjs/common';
import { type OnGatewayConnection, WebSocketGateway } from '@nestjs/websockets';
import { type WebSocket } from 'ws';
import { AuthGuard } from '../auth/auth.guard';
import { RealtimeService } from './realtime.service';

const AUTH_TIMEOUT_MS = 5_000;
const PING_MS = 25_000;

/**
 * One socket per open app. The client's first message must be {"type":"auth","token":"<access token>"}
 * (tokens never go in the URL, where proxies log them). The server only pushes; clients use HTTP for writes.
 */
@WebSocketGateway({ path: '/ws' })
export class RealtimeGateway implements OnGatewayConnection {
  private readonly log = new Logger('ws');
  constructor(
    private readonly guard: AuthGuard,
    private readonly realtime: RealtimeService,
  ) {}

  handleConnection(ws: WebSocket): void {
    let detach: (() => void) | undefined;
    const timer = setTimeout(() => ws.close(4401, 'auth timeout'), AUTH_TIMEOUT_MS);
    let alive = true;
    const ping = setInterval(() => {
      if (!alive) return ws.terminate();
      alive = false;
      ws.ping();
    }, PING_MS);
    ws.on('pong', () => (alive = true));
    ws.on('close', () => {
      clearTimeout(timer);
      clearInterval(ping);
      detach?.();
    });
    ws.on('message', async (raw) => {
      if (detach) return; // already authenticated; clients don't send anything else
      try {
        const msg = JSON.parse(String(raw)) as { type?: string; token?: string };
        if (msg.type !== 'auth' || !msg.token) throw new Error('expected auth');
        const auth = await this.guard.authenticate(`Bearer ${msg.token}`);
        clearTimeout(timer);
        detach = this.realtime.attach(auth.userId, auth.deviceId, ws);
        ws.send(JSON.stringify({ type: 'hello', userId: auth.userId, deviceId: auth.deviceId }));
      } catch {
        ws.close(4401, 'unauthorized');
      }
    });
    ws.on('error', (e) => this.log.debug(`socket error: ${e.message}`));
  }
}

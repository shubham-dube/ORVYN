import { Logger } from '@nestjs/common';
import { PC_FRAME_MAX, PcFrame } from '@orvyn/contracts';
import { type OnGatewayConnection, WebSocketGateway } from '@nestjs/websockets';
import { type WebSocket } from 'ws';
import { AccessService } from '../access/access.service';
import { type AuthContext } from '../auth/auth.decorators';
import { AuthGuard } from '../auth/auth.guard';
import { RealtimeService } from './realtime.service';

const AUTH_TIMEOUT_MS = 5_000;
const PING_MS = 25_000;
/** The PC relay (spec 0021), per socket: enough for a busy terminal, not for a flood. */
const PC_FRAMES_PER_SEC = 200;
const PC_BYTES_PER_SEC = 1024 * 1024;
const PC_WAITING_MAX = 400;
const PC_RECHECK_MS = 15_000;

/**
 * One socket per open app. The client's first message must be {"type":"auth","token":"<access token>"}
 * (tokens never go in the URL, where proxies log them). The server only pushes; clients use HTTP for writes. The one
 * exception is `pc`: encrypted messages passed on between two devices of the same person, never stored (ADR-0019).
 */
@WebSocketGateway({ path: '/ws' })
export class RealtimeGateway implements OnGatewayConnection {
  private readonly log = new Logger('ws');
  constructor(
    private readonly guard: AuthGuard,
    private readonly realtime: RealtimeService,
    private readonly access: AccessService,
  ) {}

  handleConnection(ws: WebSocket): void {
    let detach: (() => void) | undefined;
    let pc: ((raw: string) => void) | undefined;
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
      if (pc) return pc(String(raw));
      try {
        const msg = JSON.parse(String(raw)) as { type?: string; token?: string };
        if (msg.type !== 'auth' || !msg.token) throw new Error('expected auth');
        const auth = await this.guard.authenticate(`Bearer ${msg.token}`);
        clearTimeout(timer);
        if (detach || ws.readyState !== ws.OPEN) return;
        detach = this.realtime.attach(auth.userId, auth.deviceId, ws);
        pc = this.pcRelay(auth);
        ws.send(JSON.stringify({ type: 'hello', userId: auth.userId, deviceId: auth.deviceId }));
      } catch {
        ws.close(4401, 'unauthorized');
      }
    });
    ws.on('error', (e) => this.log.debug(`socket error: ${e.message}`));
  }

  /** In order, one at a time; what breaks the rules is dropped (the two ends notice the gap and start again). */
  private pcRelay(auth: AuthContext): (raw: string) => void {
    let allowed = auth.entitlements.has('pc');
    let checkedAt = Date.now();
    let frames = PC_FRAMES_PER_SEC;
    let bytes = PC_BYTES_PER_SEC;
    let filledAt = Date.now();
    let waiting = 0;
    let chain = Promise.resolve();
    const pass = async (raw: string) => {
      if (Date.now() - checkedAt > PC_RECHECK_MS) {
        checkedAt = Date.now();
        const p = await this.access.principal(auth.userId);
        allowed = !!p && !p.disabled && p.entitlements.has('pc');
      }
      if (!allowed) return;
      const f = PcFrame.safeParse(JSON.parse(raw));
      if (!f.success) return;
      const { to, s, d } = f.data;
      await this.realtime.send({
        userId: auth.userId,
        deviceId: to,
        exceptDeviceId: auth.deviceId,
        msg: { type: 'pc', from: auth.deviceId, s, d },
      });
    };
    return (raw) => {
      const now = Date.now();
      const sec = (now - filledAt) / 1000;
      filledAt = now;
      frames = Math.min(PC_FRAMES_PER_SEC, frames + sec * PC_FRAMES_PER_SEC);
      bytes = Math.min(PC_BYTES_PER_SEC, bytes + sec * PC_BYTES_PER_SEC);
      const tooMuch = raw.length > PC_FRAME_MAX + 512 || frames < 1 || bytes < raw.length;
      if (tooMuch || waiting >= PC_WAITING_MAX) return;
      frames -= 1;
      bytes -= raw.length;
      waiting++;
      chain = chain
        .then(() => pass(raw))
        .catch(() => undefined) // never logged, not even that it was odd
        .finally(() => waiting--);
    };
  }
}

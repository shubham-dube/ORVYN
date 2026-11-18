import { createServer, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';

/** Just enough of Meta's WhatsApp Cloud API: records template messages to a phone number id. */
export class FakeWhatsApp {
  server!: Server;
  url = '';
  sent: { to: string; template: string; text: string; auth: string }[] = [];
  fail = false;

  async start() {
    this.server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        if (this.fail) {
          res.writeHead(500).end('{}');
          return;
        }
        const j = JSON.parse(body || '{}');
        this.sent.push({
          to: j.to,
          template: j.template?.name,
          text: j.template?.components?.[0]?.parameters?.[0]?.text ?? '',
          auth: String(req.headers.authorization),
        });
        res.writeHead(200, { 'content-type': 'application/json' }).end('{"messages":[{"id":"wamid.x"}]}');
      });
    });
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }
  close() {
    return new Promise<void>((r) => this.server.close(() => r()));
  }
  env() {
    return { WHATSAPP_TOKEN: 'wa-token', WHATSAPP_PHONE_ID: '12345', WHATSAPP_API: this.url };
  }
  lastCode(): string {
    return /(\d{6})/.exec(this.sent.at(-1)?.text ?? '')?.[1] ?? '';
  }
}

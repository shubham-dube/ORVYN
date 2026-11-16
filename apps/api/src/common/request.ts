import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { type FastifyRequest } from 'fastify';

export interface ClientInfo {
  ip: string;
  userAgent: string;
}

export function clientInfo(req: FastifyRequest): ClientInfo {
  return { ip: req.ip ?? '', userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300) };
}

export const Client = createParamDecorator((_: unknown, ctx: ExecutionContext): ClientInfo =>
  clientInfo(ctx.switchToHttp().getRequest<FastifyRequest>()),
);

import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type EntitlementKey } from '@orvyn/contracts';
import { type FastifyRequest } from 'fastify';
import { forbidden, unauthorized } from '../../common/errors';
import { AccessService } from '../access/access.service';
import { type AuthContext, IS_PUBLIC, OWNER_ONLY, REQUIRED_ENTITLEMENT } from './auth.decorators';
import { TokensService } from './tokens.service';

/**
 * Global guard: every route requires a valid access token for an active device of an enabled user,
 * unless marked @Public(). Feature switches and owner-only routes are enforced here, on the server (ADR-0005).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokensService,
    private readonly access: AccessService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    const req = ctx.switchToHttp().getRequest<FastifyRequest & { auth?: AuthContext }>();
    const auth = await this.authenticate(req.headers.authorization);
    const needed = this.reflector.getAllAndOverride<EntitlementKey | undefined>(
      REQUIRED_ENTITLEMENT,
      targets,
    );
    if (needed && !auth.entitlements.has(needed))
      throw forbidden('feature_not_enabled', 'This feature is not enabled for you.');
    if (this.reflector.getAllAndOverride<boolean>(OWNER_ONLY, targets) && auth.role !== 'owner')
      throw forbidden();
    req.auth = auth;
    return true;
  }

  /** Shared with the realtime gateway. */
  async authenticate(header: string | undefined): Promise<AuthContext> {
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) throw unauthorized();
    const claims = await this.tokens.verifyAccess(token);
    if (!claims) throw unauthorized('token_expired', 'Session expired.');
    const p = await this.access.principal(claims.sub);
    if (!p || p.disabled) throw unauthorized('account_disabled', 'This account has been disabled.');
    if (!(await this.access.deviceActive(claims.sub, claims.did)))
      throw unauthorized('session_revoked', 'This device was signed out.');
    return { userId: p.userId, deviceId: claims.did, role: p.role, entitlements: p.entitlements };
  }
}

import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import { type EntitlementKey, type Role } from '@orvyn/contracts';

export interface AuthContext {
  userId: string;
  deviceId: string;
  role: Role;
  entitlements: Set<EntitlementKey>;
}

export const IS_PUBLIC = 'orvyn:public';
export const REQUIRED_ENTITLEMENT = 'orvyn:entitlement';
export const OWNER_ONLY = 'orvyn:owner';

/** No sign-in needed. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Caller must have this feature switched on (ADR-0005). Enforced by AuthGuard. */
export const RequireEntitlement = (key: EntitlementKey) => SetMetadata(REQUIRED_ENTITLEMENT, key);
/** Only the owner (admin console). */
export const OwnerOnly = () => SetMetadata(OWNER_ONLY, true);

export const Auth = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthContext => {
  const req = ctx.switchToHttp().getRequest<{ auth?: AuthContext }>();
  if (!req.auth) throw new Error('Auth used on a public route');
  return req.auth;
});

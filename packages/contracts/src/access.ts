import { z } from 'zod';
import { ENTITLEMENT_KEYS } from './entitlements';
import { Email, Role } from './auth';

const Key = z.enum(ENTITLEMENT_KEYS as [string, ...string[]]);

export const CreateInviteRequest = z.object({
  email: Email.optional(),
  entitlements: z.array(Key).max(20),
  expiresInDays: z.number().int().min(1).max(30).default(7),
  note: z.string().max(120).optional(),
});
export type CreateInviteRequest = z.infer<typeof CreateInviteRequest>;

export const InviteView = z.object({
  id: z.string().uuid(),
  email: z.string().nullable(),
  entitlements: z.array(z.string()),
  note: z.string().nullable(),
  expiresAt: z.string(),
  usedAt: z.string().nullable(),
  /** Only returned once, when the invite is created. */
  link: z.string().optional(),
});
export type InviteView = z.infer<typeof InviteView>;

export const AdminUserView = z.object({
  id: z.string().uuid(),
  email: z.string(),
  name: z.string(),
  role: Role,
  entitlements: z.array(z.string()),
  disabled: z.boolean(),
  createdAt: z.string(),
  lastSeenAt: z.string().nullable(),
});
export type AdminUserView = z.infer<typeof AdminUserView>;

export const SetEntitlementsRequest = z.object({ entitlements: z.array(Key).max(20) });
export const SetDisabledRequest = z.object({ disabled: z.boolean() });

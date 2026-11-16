import { z } from 'zod';
import { ENTITLEMENT_KEYS } from './entitlements';

export const Platform = z.enum(['web', 'android', 'ios', 'windows', 'macos', 'linux', 'extension']);
export type Platform = z.infer<typeof Platform>;

export const DeviceInfo = z.object({
  name: z.string().trim().min(1).max(80),
  platform: Platform,
  appVersion: z.string().max(40).default('0.0.0'),
});
export type DeviceInfo = z.infer<typeof DeviceInfo>;

export const Email = z.string().trim().toLowerCase().email().max(254);

export const EmailStartRequest = z.object({ email: Email, invite: z.string().max(200).optional() });
export type EmailStartRequest = z.infer<typeof EmailStartRequest>;

export const EmailVerifyRequest = z.object({
  email: Email,
  code: z.string().regex(/^\d{6}$/),
  device: DeviceInfo,
  invite: z.string().max(200).optional(),
});
export type EmailVerifyRequest = z.infer<typeof EmailVerifyRequest>;

export const GoogleIdTokenRequest = z.object({
  idToken: z.string().min(10).max(4096),
  device: DeviceInfo,
  invite: z.string().max(200).optional(),
});
export type GoogleIdTokenRequest = z.infer<typeof GoogleIdTokenRequest>;

export const RefreshRequest = z.object({ refreshToken: z.string().min(20).max(200).optional() });
export type RefreshRequest = z.infer<typeof RefreshRequest>;

export const Role = z.enum(['owner', 'member']);
export type Role = z.infer<typeof Role>;

export const Me = z.object({
  id: z.string().uuid(),
  email: z.string(),
  name: z.string(),
  avatarUrl: z.string().nullable(),
  role: Role,
  entitlements: z.array(z.enum(ENTITLEMENT_KEYS as [string, ...string[]])),
  hasPasskey: z.boolean(),
});
export type Me = z.infer<typeof Me>;

export const SessionResponse = z.object({
  accessToken: z.string(),
  expiresIn: z.number().int(),
  /** Only for native clients (mobile/desktop/extension); web gets an HttpOnly cookie instead. */
  refreshToken: z.string().optional(),
  deviceId: z.string().uuid(),
  user: Me,
});
export type SessionResponse = z.infer<typeof SessionResponse>;

export const DeviceView = z.object({
  id: z.string().uuid(),
  name: z.string(),
  platform: Platform,
  appVersion: z.string(),
  current: z.boolean(),
  createdAt: z.string(),
  lastSeenAt: z.string(),
});
export type DeviceView = z.infer<typeof DeviceView>;

export const UpdateProfileRequest = z.object({ name: z.string().trim().min(1).max(80) });

/**
 * Linking a desktop app or the browser extension to an account (ADR-0003 addendum): the app opens the web app with a
 * PKCE challenge and its redirect URI; the signed-in person approves; the web app gets a one-time code from the API
 * and sends it to the redirect; the app redeems it with the verifier for its own device session.
 */
export const LinkStartRequest = z.object({
  /** base64url(SHA-256(verifier)), 43 chars */
  challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  /** http://127.0.0.1:<port>/… (desktop) or https://<extension-id>.chromiumapp.org/… (extension) */
  redirectUri: z.string().url().max(300),
  state: z.string().min(16).max(128),
});
export type LinkStartRequest = z.infer<typeof LinkStartRequest>;

export const LinkStartResponse = z.object({
  /** where the web app sends the person next (redirect URI + code + state) */
  redirect: z.string(),
  client: z.enum(['desktop', 'extension']),
});
export type LinkStartResponse = z.infer<typeof LinkStartResponse>;

export const LinkRedeemRequest = z.object({
  code: z.string().min(20).max(100),
  verifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/),
  device: DeviceInfo,
});
export type LinkRedeemRequest = z.infer<typeof LinkRedeemRequest>;

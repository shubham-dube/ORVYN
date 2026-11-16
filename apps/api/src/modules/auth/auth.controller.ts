import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  DeviceInfo,
  EmailStartRequest,
  EmailVerifyRequest,
  GoogleIdTokenRequest,
  LinkRedeemRequest,
  LinkStartRequest,
  type LinkStartResponse,
  RefreshRequest,
  type SessionResponse,
  UpdateProfileRequest,
} from '@orvyn/contracts';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import { type FastifyReply, type FastifyRequest } from 'fastify';
import type Redis from 'ioredis';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { randomToken } from '../../common/crypto';
import { notFound, unauthorized } from '../../common/errors';
import { REDIS } from '../../common/redis.module';
import { Client, type ClientInfo } from '../../common/request';
import { ZodPipe } from '../../common/zod.pipe';
import { ENV, type Env } from '../../config/env';
import { AccessService } from '../access/access.service';
import { AuditService } from '../audit/audit.service';
import { Auth, type AuthContext, Public } from './auth.decorators';
import { AuthService, type IssuedSession } from './auth.service';
import { GoogleVerifier } from './google.service';
import { LinkService } from './link.service';
import { PasskeysService } from './passkeys.service';

export const REFRESH_COOKIE = 'orvyn_rt';

const PasskeyLoginVerify = z.object({
  challengeId: z.string().min(8).max(64),
  response: z.any(),
  device: DeviceInfo,
});
const PasskeyRegisterVerify = z.object({ response: z.any(), name: z.string().max(60).default('Passkey') });

@Controller()
export class AuthController {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly auth: AuthService,
    private readonly passkeys: PasskeysService,
    private readonly link: LinkService,
    private readonly google: GoogleVerifier,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------------ email code
  @Public()
  @Post('auth/email/start')
  @HttpCode(200)
  async emailStart(
    @Body(new ZodPipe(EmailStartRequest)) body: EmailStartRequest,
    @Client() client: ClientInfo,
  ) {
    await this.auth.startEmail(body.email, body.invite, client);
    return { sent: true };
  }

  @Public()
  @Post('auth/email/verify')
  @HttpCode(200)
  async emailVerify(
    @Body(new ZodPipe(EmailVerifyRequest)) body: EmailVerifyRequest,
    @Client() client: ClientInfo,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SessionResponse> {
    return this.respond(
      await this.auth.verifyEmail(body.email, body.code, body.device, body.invite, client),
      reply,
    );
  }

  // ------------------------------------------------------------------ Google
  /** Mobile / desktop: the app obtained a Google ID token natively. */
  @Public()
  @Post('auth/google')
  @HttpCode(200)
  async googleIdToken(
    @Body(new ZodPipe(GoogleIdTokenRequest)) body: GoogleIdTokenRequest,
    @Client() client: ClientInfo,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SessionResponse> {
    const g = await this.google.verify(body.idToken);
    return this.respond(
      await this.auth.signIn(
        { email: g.email, name: g.name, avatarUrl: g.picture, method: 'google' },
        body.device,
        body.invite,
        client,
      ),
      reply,
    );
  }

  /** Web: redirect to Google (authorization code + PKCE). */
  @Public()
  @Get('auth/google/start')
  async googleStart(
    @Query('invite') invite: string | undefined,
    @Query('device') deviceName: string | undefined,
    @Res() reply: FastifyReply,
  ) {
    if (!this.env.GOOGLE_WEB_CLIENT_ID)
      throw notFound('google_not_configured', 'Google sign-in is not set up yet.');
    const state = randomToken(16);
    const verifier = randomToken(32);
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    await this.redis.set(
      `oauth:google:${state}`,
      JSON.stringify({ verifier, invite, deviceName }),
      'EX',
      600,
    );
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({
      client_id: this.env.GOOGLE_WEB_CLIENT_ID,
      redirect_uri: `${this.env.API_URL}/auth/google/callback`,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      prompt: 'select_account',
    }).toString();
    return reply.redirect(url.toString(), 302);
  }

  @Public()
  @Get('auth/google/callback')
  async googleCallback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Client() client: ClientInfo,
    @Res() reply: FastifyReply,
  ) {
    const fail = (reason: string) => reply.redirect(`${this.env.WEB_URL}/sign-in?error=${reason}`, 302);
    const saved = state ? await this.redis.getdel(`oauth:google:${state}`) : null;
    if (!code || !saved) return fail('expired');
    const { verifier, invite, deviceName } = JSON.parse(saved) as {
      verifier: string;
      invite?: string;
      deviceName?: string;
    };
    try {
      const idToken = await this.google.exchangeCode(
        code,
        verifier,
        `${this.env.API_URL}/auth/google/callback`,
      );
      const g = await this.google.verify(idToken);
      const session = await this.auth.signIn(
        { email: g.email, name: g.name, avatarUrl: g.picture, method: 'google' },
        { name: (deviceName || 'Web browser').slice(0, 80), platform: 'web', appVersion: '0.0.0' },
        invite,
        client,
      );
      this.setRefreshCookie(reply, session.refreshToken);
      return reply.redirect(`${this.env.WEB_URL}/?signedIn=1`, 302);
    } catch (e) {
      const codeName = (e as { response?: { error?: { code?: string } } }).response?.error?.code ?? 'failed';
      return fail(codeName);
    }
  }

  // ------------------------------------------------------------------ passkeys
  @Public()
  @Post('auth/passkey/options')
  @HttpCode(200)
  passkeyLoginOptions() {
    return this.passkeys.authenticationOptions();
  }

  @Public()
  @Post('auth/passkey/verify')
  @HttpCode(200)
  async passkeyLogin(
    @Body(new ZodPipe(PasskeyLoginVerify)) body: z.infer<typeof PasskeyLoginVerify>,
    @Client() client: ClientInfo,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SessionResponse> {
    const email = await this.passkeys.authenticate(
      body.challengeId,
      body.response as AuthenticationResponseJSON,
    );
    return this.respond(
      await this.auth.signIn({ email, method: 'passkey' }, body.device, undefined, client),
      reply,
    );
  }

  @Post('me/passkeys/options')
  @HttpCode(200)
  passkeyRegisterOptions(@Auth() a: AuthContext) {
    return this.passkeys.registrationOptions(a.userId);
  }

  @Post('me/passkeys')
  async passkeyRegister(
    @Auth() a: AuthContext,
    @Body(new ZodPipe(PasskeyRegisterVerify)) body: z.infer<typeof PasskeyRegisterVerify>,
    @Client() client: ClientInfo,
  ) {
    const r = await this.passkeys.register(a.userId, body.response as RegistrationResponseJSON, body.name);
    await this.audit.record('auth.passkey_added', {
      actorId: a.userId,
      targetType: 'passkey',
      targetId: r.id,
      client,
    });
    return r;
  }

  @Get('me/passkeys')
  listPasskeys(@Auth() a: AuthContext) {
    return this.passkeys.list(a.userId);
  }

  @Delete('me/passkeys/:id')
  async removePasskey(@Auth() a: AuthContext, @Param('id') id: string, @Client() client: ClientInfo) {
    await this.passkeys.remove(a.userId, id);
    await this.audit.record('auth.passkey_removed', {
      actorId: a.userId,
      targetType: 'passkey',
      targetId: id,
      client,
    });
    return { ok: true };
  }

  // ------------------------------------------------------------------ desktop / extension linking
  /** The signed-in web app approves an app and gets where to send its one-time code. */
  @Post('auth/link/start')
  @HttpCode(200)
  linkStart(
    @Auth() a: AuthContext,
    @Body(new ZodPipe(LinkStartRequest)) body: LinkStartRequest,
    @Client() client: ClientInfo,
  ): Promise<LinkStartResponse> {
    return this.link.start(a.userId, body.challenge, body.redirectUri, body.state, client);
  }

  /** The app exchanges the code + its PKCE verifier for its own device session. */
  @Public()
  @Post('auth/link/redeem')
  @HttpCode(200)
  async linkRedeem(
    @Body(new ZodPipe(LinkRedeemRequest)) body: LinkRedeemRequest,
    @Client() client: ClientInfo,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SessionResponse> {
    return this.respond(await this.link.redeem(body.code, body.verifier, body.device, client), reply);
  }

  // ------------------------------------------------------------------ session
  @Public()
  @Post('auth/refresh')
  @HttpCode(200)
  async refresh(
    @Body(new ZodPipe(RefreshRequest)) body: RefreshRequest,
    @Req() req: FastifyRequest,
    @Client() client: ClientInfo,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SessionResponse> {
    const token = body.refreshToken ?? req.cookies?.[REFRESH_COOKIE];
    if (!token) throw unauthorized('no_session');
    try {
      return this.respond(await this.auth.refresh(token, client), reply);
    } catch (e) {
      if (!body.refreshToken) this.clearRefreshCookie(reply);
      throw e;
    }
  }

  @Post('auth/sign-out')
  @HttpCode(200)
  async signOut(
    @Auth() a: AuthContext,
    @Client() client: ClientInfo,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    await this.auth.revokeDevice(a.userId, a.deviceId, 'sign_out', client);
    this.clearRefreshCookie(reply);
    return { ok: true };
  }

  // ------------------------------------------------------------------ me & devices
  @Get('me')
  me(@Auth() a: AuthContext) {
    return this.auth.me(a.userId);
  }

  @Patch('me')
  updateMe(@Auth() a: AuthContext, @Body(new ZodPipe(UpdateProfileRequest)) body: { name: string }) {
    return this.auth.updateName(a.userId, body.name);
  }

  @Get('me/devices')
  devices(@Auth() a: AuthContext) {
    return this.auth.listDevices(a.userId, a.deviceId);
  }

  @Delete('me/devices/:id')
  async revokeDevice(@Auth() a: AuthContext, @Param('id') id: string, @Client() client: ClientInfo) {
    await this.auth.revokeDevice(a.userId, id, 'revoked_by_user', client);
    return { ok: true };
  }

  @Public()
  @Get('invites/:token')
  invitePreview(@Param('token') token: string) {
    return this.access.invitePreview(token);
  }

  // ------------------------------------------------------------------ helpers
  /** Web gets the refresh token as an HttpOnly cookie; native clients get it in the body. */
  private respond(s: IssuedSession, reply: FastifyReply): SessionResponse {
    const base = { accessToken: s.accessToken, expiresIn: s.expiresIn, deviceId: s.deviceId, user: s.user };
    if (s.platform === 'web') {
      this.setRefreshCookie(reply, s.refreshToken);
      return base;
    }
    return { ...base, refreshToken: s.refreshToken };
  }

  private setRefreshCookie(reply: FastifyReply, token: string): void {
    void reply.setCookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      secure: this.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/auth',
      maxAge: this.env.REFRESH_TOKEN_TTL_DAYS * 86_400,
      ...(this.env.COOKIE_DOMAIN ? { domain: this.env.COOKIE_DOMAIN } : {}),
    });
  }

  private clearRefreshCookie(reply: FastifyReply): void {
    void reply.clearCookie(REFRESH_COOKIE, {
      path: '/auth',
      ...(this.env.COOKIE_DOMAIN ? { domain: this.env.COOKIE_DOMAIN } : {}),
    });
  }
}

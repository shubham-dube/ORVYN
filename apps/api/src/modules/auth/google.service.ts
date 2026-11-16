import { Inject, Injectable } from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';
import { unauthorized } from '../../common/errors';
import { ENV, type Env } from '../../config/env';

export interface GoogleProfile {
  email: string;
  name: string;
  picture: string | null;
}

/** Verifies Google ID tokens (mobile/desktop sign-in and the web code flow). Replaced by a fake in tests. */
@Injectable()
export class GoogleVerifier {
  private readonly client = new OAuth2Client();
  constructor(@Inject(ENV) private readonly env: Env) {}

  get configured(): boolean {
    return this.env.GOOGLE_CLIENT_IDS.length > 0;
  }

  async verify(idToken: string): Promise<GoogleProfile> {
    if (!this.configured) throw unauthorized('google_not_configured', 'Google sign-in is not set up yet.');
    try {
      const ticket = await this.client.verifyIdToken({ idToken, audience: this.env.GOOGLE_CLIENT_IDS });
      const p = ticket.getPayload();
      if (!p?.email || !p.email_verified) throw new Error('email not verified');
      return { email: p.email.toLowerCase(), name: p.name ?? '', picture: p.picture ?? null };
    } catch {
      throw unauthorized('google_invalid', 'Google sign-in failed. Please try again.');
    }
  }

  /** Web code flow: exchange the authorization code (PKCE) for an ID token. */
  async exchangeCode(code: string, codeVerifier: string, redirectUri: string): Promise<string> {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: this.env.GOOGLE_WEB_CLIENT_ID,
        client_secret: this.env.GOOGLE_WEB_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        code_verifier: codeVerifier,
      }),
    });
    const data = (await res.json()) as { id_token?: string };
    if (!res.ok || !data.id_token)
      throw unauthorized('google_invalid', 'Google sign-in failed. Please try again.');
    return data.id_token;
  }
}

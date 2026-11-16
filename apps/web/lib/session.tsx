'use client';

import type { Me, SessionResponse } from '@orvyn/contracts';
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { api, API_URL, onSession, refreshSession, setSession, thisDevice } from './api';
import { realtime } from './realtime';

type Status = 'loading' | 'signedOut' | 'signedIn';

interface SessionCtx {
  status: Status;
  me: Me | null;
  deviceId: string | null;
  startEmail(email: string, invite?: string): Promise<void>;
  verifyEmail(email: string, code: string, invite?: string): Promise<void>;
  signInWithPasskey(): Promise<void>;
  googleUrl(invite?: string): string;
  addPasskey(name: string): Promise<void>;
  signOut(): Promise<void>;
  refreshMe(): Promise<void>;
}

const Ctx = createContext<SessionCtx | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [me, setMe] = useState<Me | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // keep state in step with every session change (sign-in, refresh, sign-out)
  useEffect(
    () =>
      onSession((s: SessionResponse | null) => {
        if (timer.current) clearTimeout(timer.current);
        if (!s) {
          setMe(null);
          setDeviceId(null);
          setStatus('signedOut');
          realtime?.stop();
          return;
        }
        setMe(s.user);
        setDeviceId(s.deviceId);
        setStatus('signedIn');
        realtime?.start();
        // refresh a minute before the access token expires
        timer.current = setTimeout(() => void refreshSession(), Math.max(10, s.expiresIn - 60) * 1000);
      }),
    [],
  );

  useEffect(() => {
    void refreshSession().then((s) => {
      if (!s) setStatus('signedOut');
    });
  }, []);

  useEffect(
    () =>
      realtime?.on((m) => {
        if (m.type === 'session.revoked') setSession(null);
        if (m.type === 'entitlements.changed')
          setMe((p) => (p ? { ...p, entitlements: m.entitlements as Me['entitlements'] } : p));
      }),
    [],
  );

  const startEmail = useCallback(async (email: string, invite?: string) => {
    await api('/auth/email/start', { method: 'POST', body: { email, invite }, auth: false });
  }, []);

  const verifyEmail = useCallback(async (email: string, code: string, invite?: string) => {
    const s = await api<SessionResponse>('/auth/email/verify', {
      method: 'POST',
      body: { email, code, invite, device: thisDevice() },
      auth: false,
    });
    setSession(s);
  }, []);

  const signInWithPasskey = useCallback(async () => {
    const { challengeId, options } = await api<{
      challengeId: string;
      options: Parameters<typeof startAuthentication>[0]['optionsJSON'];
    }>('/auth/passkey/options', { method: 'POST', auth: false });
    const response = await startAuthentication({ optionsJSON: options });
    const s = await api<SessionResponse>('/auth/passkey/verify', {
      method: 'POST',
      body: { challengeId, response, device: thisDevice() },
      auth: false,
    });
    setSession(s);
  }, []);

  const addPasskey = useCallback(async (name: string) => {
    const options = await api<Parameters<typeof startRegistration>[0]['optionsJSON']>(
      '/me/passkeys/options',
      { method: 'POST' },
    );
    const response = await startRegistration({ optionsJSON: options });
    await api('/me/passkeys', { method: 'POST', body: { response, name } });
    setMe((p) => (p ? { ...p, hasPasskey: true } : p));
  }, []);

  const googleUrl = useCallback((invite?: string) => {
    const q = new URLSearchParams({ device: thisDevice().name, ...(invite ? { invite } : {}) });
    return `${API_URL}/auth/google/start?${q}`;
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api('/auth/sign-out', { method: 'POST' });
    } finally {
      setSession(null);
    }
  }, []);

  const refreshMe = useCallback(async () => setMe(await api<Me>('/me')), []);

  const value = useMemo(
    () => ({
      status,
      me,
      deviceId,
      startEmail,
      verifyEmail,
      signInWithPasskey,
      googleUrl,
      addPasskey,
      signOut,
      refreshMe,
    }),
    [
      status,
      me,
      deviceId,
      startEmail,
      verifyEmail,
      signInWithPasskey,
      googleUrl,
      addPasskey,
      signOut,
      refreshMe,
    ],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useSession outside SessionProvider');
  return c;
}

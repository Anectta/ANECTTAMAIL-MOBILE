import crypto from 'crypto';

export type OAuthProvider = 'google' | 'microsoft';

interface OAuthStateEntry {
  provider: OAuthProvider;
  appRedirectUri: string;
  expiresAt: number;
}

const stateStore = new Map<string, OAuthStateEntry>();
const STATE_TTL_MS = 10 * 60 * 1000;

function cleanupStates(): void {
  const now = Date.now();
  for (const [key, entry] of stateStore.entries()) {
    if (entry.expiresAt <= now) stateStore.delete(key);
  }
}

function getProviderConfig(provider: OAuthProvider) {
  const baseUrl = (process.env.GATEWAY_PUBLIC_URL || `http://localhost:${process.env.PORT || 8787}`).replace(
    /\/+$/,
    ''
  );
  if (provider === 'google') {
    return {
      clientId: process.env.GOOGLE_OAUTH_CLIENT_ID || '',
      clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || '',
      authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      scope: 'openid email profile https://mail.google.com/',
      redirectUri: `${baseUrl}/api/oauth/google/callback`,
      imapHost: 'imap.gmail.com',
      imapPort: 993,
      smtpHost: 'smtp.gmail.com',
      smtpPort: 465,
    };
  }
  const tenant = process.env.MICROSOFT_OAUTH_TENANT || 'common';
  return {
    clientId: process.env.MICROSOFT_OAUTH_CLIENT_ID || '',
    clientSecret: process.env.MICROSOFT_OAUTH_CLIENT_SECRET || '',
    authUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
    tokenUrl: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
    scope:
      'openid email profile offline_access https://outlook.office.com/IMAP.AccessAsUser.All https://outlook.office.com/SMTP.Send',
    redirectUri: `${baseUrl}/api/oauth/microsoft/callback`,
    imapHost: 'outlook.office365.com',
    imapPort: 993,
    smtpHost: 'smtp.office365.com',
    smtpPort: 587,
  };
}

export const mobileOAuthService = {
  getAvailableProviders(): Record<OAuthProvider, boolean> {
    return {
      google: Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET),
      microsoft: Boolean(
        process.env.MICROSOFT_OAUTH_CLIENT_ID && process.env.MICROSOFT_OAUTH_CLIENT_SECRET
      ),
    };
  },

  createAuthUrl(provider: OAuthProvider, appRedirectUri = 'anecttamail://oauth-callback'): string {
    cleanupStates();
    const cfg = getProviderConfig(provider);
    if (!cfg.clientId || !cfg.clientSecret) {
      throw new Error(
        `OAuth ${provider} não configurado no Gateway. Defina as variáveis de ambiente no .env.`
      );
    }

    const state = crypto.randomBytes(20).toString('hex');
    stateStore.set(state, {
      provider,
      appRedirectUri,
      expiresAt: Date.now() + STATE_TTL_MS,
    });

    const params = new URLSearchParams({
      client_id: cfg.clientId,
      redirect_uri: cfg.redirectUri,
      response_type: 'code',
      scope: cfg.scope,
      state,
      access_type: 'offline',
      prompt: 'consent',
    });

    return `${cfg.authUrl}?${params.toString()}`;
  },

  async handleCallback(provider: OAuthProvider, code: string, state: string) {
    cleanupStates();
    const entry = stateStore.get(state);
    if (!entry || entry.provider !== provider) {
      throw new Error('Estado OAuth inválido ou expirado.');
    }
    stateStore.delete(state);

    const cfg = getProviderConfig(provider);
    const body = new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: cfg.redirectUri,
    });

    const tokenRes = await fetch(cfg.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const tokenData: any = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.access_token) {
      throw new Error(tokenData.error_description || tokenData.error || 'Falha ao trocar código OAuth.');
    }

    return {
      appRedirectUri: entry.appRedirectUri,
      provider,
      accessToken: String(tokenData.access_token),
      refreshToken: tokenData.refresh_token ? String(tokenData.refresh_token) : undefined,
      expiresIn: Number(tokenData.expires_in || 3600),
      imapHost: cfg.imapHost,
      imapPort: cfg.imapPort,
      smtpHost: cfg.smtpHost,
      smtpPort: cfg.smtpPort,
    };
  },

  async refreshAccessToken(provider: OAuthProvider, refreshToken: string) {
    const cfg = getProviderConfig(provider);
    if (!cfg.clientId || !cfg.clientSecret) {
      throw new Error(`OAuth ${provider} não configurado no Gateway.`);
    }
    const body = new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });
    const res = await fetch(cfg.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const data: any = await res.json();
    if (!res.ok || !data.access_token) {
      throw new Error(data.error_description || data.error || 'Falha ao renovar token OAuth.');
    }
    return {
      accessToken: String(data.access_token),
      expiresIn: Number(data.expires_in || 3600),
    };
  },
};

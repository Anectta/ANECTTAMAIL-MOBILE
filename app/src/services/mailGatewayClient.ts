import type { EmailItem, MailFolder } from '@/types/email';
import type { MobileAccountConfig } from './secureStorage';

export interface GatewaySyncResponse {
  success: boolean;
  emails?: EmailItem[];
  error?: string;
  count?: number;
}

export interface PairedAccountInfo {
  displayName: string;
  email: string;
  protocol: 'imap' | 'pop3';
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
}

function buildUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}${path}`;
}

export const mailGatewayClient = {
  getOAuthStartUrl(gatewayUrl: string, provider: 'google' | 'microsoft', redirectUri?: string): string {
    const query = redirectUri ? `?redirectUri=${encodeURIComponent(redirectUri)}` : '';
    return buildUrl(gatewayUrl, `/api/oauth/${provider}/start${query}`);
  },

  async claimPairingCode(
    gatewayUrl: string,
    code: string
  ): Promise<{ success: boolean; accounts?: PairedAccountInfo[]; error?: string }> {
    const res = await fetch(buildUrl(gatewayUrl, '/api/pairing/claim'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    return await res.json();
  },

  async registerPush(
    account: MobileAccountConfig,
    device: { deviceId: string; platform: 'android' | 'ios' | 'web'; pushToken: string }
  ): Promise<{ success: boolean }> {
    const res = await fetch(buildUrl(account.gatewayUrl, '/api/push/register'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: device.deviceId,
        platform: device.platform,
        pushToken: device.pushToken,
        accountId: account.id,
        imapConfig: {
          protocol: account.protocol,
          host: account.imapHost,
          port: account.imapPort,
          secure: account.imapSecure,
          user: account.email,
          pass: account.password,
          accessToken: account.accessToken,
        },
      }),
    });
    return await res.json();
  },

  async testConnection(account: MobileAccountConfig): Promise<{ success: boolean; message: string }> {
    const res = await fetch(buildUrl(account.gatewayUrl, '/api/mail/test-connection'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        protocol: account.protocol,
        host: account.imapHost,
        port: account.imapPort,
        secure: account.imapSecure,
        user: account.email,
        pass: account.password,
      }),
    });
    return await res.json();
  },

  async fetchFolder(
    account: MobileAccountConfig,
    folder: MailFolder = 'inbox',
    limit = 40
  ): Promise<GatewaySyncResponse> {
    const res = await fetch(buildUrl(account.gatewayUrl, '/api/mail/folder'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        config: {
          protocol: account.protocol,
          host: account.imapHost,
          port: account.imapPort,
          secure: account.imapSecure,
          user: account.email,
          pass: account.password,
          accessToken: account.accessToken,
        },
        folder,
        limit,
      }),
    });
    return await res.json();
  },

  async syncAll(account: MobileAccountConfig, limitPerFolder = 30): Promise<GatewaySyncResponse> {
    const res = await fetch(buildUrl(account.gatewayUrl, '/api/mail/sync'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        config: {
          protocol: account.protocol,
          host: account.imapHost,
          port: account.imapPort,
          secure: account.imapSecure,
          user: account.email,
          pass: account.password,
          accessToken: account.accessToken,
        },
        limitPerFolder,
      }),
    });
    return await res.json();
  },

  async sendEmail(
    account: MobileAccountConfig,
    payload: { to: string; subject: string; text: string; html?: string }
  ): Promise<{ success: boolean; error?: string }> {
    const res = await fetch(buildUrl(account.gatewayUrl, '/api/mail/send'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        smtpConfig: {
          host: account.smtpHost,
          port: account.smtpPort,
          secure: account.smtpSecure,
          user: account.email,
          pass: account.password,
          accessToken: account.accessToken,
        },
        mailOptions: {
          from: account.displayName ? `"${account.displayName}" <${account.email}>` : account.email,
          to: payload.to,
          subject: payload.subject,
          text: payload.text,
          html: payload.html,
        },
        imapConfig:
          account.protocol === 'imap'
            ? {
                protocol: 'imap',
                host: account.imapHost,
                port: account.imapPort,
                secure: account.imapSecure,
                user: account.email,
                pass: account.password,
              }
            : undefined,
      }),
    });
    return await res.json();
  },
};

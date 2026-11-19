import { Preferences } from '@capacitor/preferences';
import type { EmailItem } from '@/types/email';

export interface MobileAccountConfig {
  id: string;
  gatewayUrl: string;
  protocol: 'imap' | 'pop3';
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  email: string;
  password: string;
  accessToken?: string;
  refreshToken?: string;
  authProvider?: 'password' | 'google' | 'microsoft';
  displayName: string;
}

const KEYS = {
  ACCOUNTS: 'anectta_mobile_accounts_v2',
  ACTIVE_ACCOUNT: 'anectta_mobile_active_account_v2',
  DEVICE_ID: 'anectta_mobile_device_id_v1',
  EMAILS_PREFIX: 'anectta_mobile_emails_v2_',
};

export function createEmptyAccount(gatewayUrl = 'http://localhost:8787'): MobileAccountConfig {
  return {
    id: `acc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    gatewayUrl,
    protocol: 'imap',
    imapHost: '',
    imapPort: 993,
    imapSecure: true,
    smtpHost: '',
    smtpPort: 465,
    smtpSecure: true,
    email: '',
    password: '',
    displayName: '',
  };
}

export const secureStorage = {
  async getOrCreateDeviceId(): Promise<string> {
    const { value } = await Preferences.get({ key: KEYS.DEVICE_ID });
    if (value) return value;
    const id = `dev_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    await Preferences.set({ key: KEYS.DEVICE_ID, value: id });
    return id;
  },

  async loadAccounts(): Promise<MobileAccountConfig[]> {
    try {
      const { value } = await Preferences.get({ key: KEYS.ACCOUNTS });
      if (!value) return [];
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  },

  async saveAccounts(accounts: MobileAccountConfig[]): Promise<void> {
    await Preferences.set({ key: KEYS.ACCOUNTS, value: JSON.stringify(accounts) });
  },

  async loadActiveAccountId(): Promise<string | null> {
    const { value } = await Preferences.get({ key: KEYS.ACTIVE_ACCOUNT });
    return value || null;
  },

  async saveActiveAccountId(id: string): Promise<void> {
    await Preferences.set({ key: KEYS.ACTIVE_ACCOUNT, value: id });
  },

  async loadCachedEmails(accountId: string): Promise<EmailItem[]> {
    try {
      const { value } = await Preferences.get({ key: `${KEYS.EMAILS_PREFIX}${accountId}` });
      if (!value) return [];
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  },

  async saveCachedEmails(accountId: string, emails: EmailItem[]): Promise<void> {
    await Preferences.set({
      key: `${KEYS.EMAILS_PREFIX}${accountId}`,
      value: JSON.stringify(emails.slice(0, 150)),
    });
  },
};

import { Preferences } from '@capacitor/preferences';
import { AnecttaMail } from '@/native/anecttaMail';
import type { MailAccount, MailFolderInfo, MessageHeader, Security } from '@/types/mail';

/**
 * Persistência local do app. Contas (sem senha), pastas e cabeçalhos em cache ficam nas
 * preferências do app; a senha fica no cofre do sistema (Android Keystore), via motor nativo.
 */
const KEYS = {
  ACCOUNTS: 'anectta_mobile_accounts_v3',
  ACTIVE: 'anectta_mobile_active_account_v3',
  FOLDERS: (accountId: string) => `anectta_mobile_folders_v3_${accountId}`,
  HEADERS: (accountId: string, folder: string) => `anectta_mobile_headers_v3_${accountId}_${folder}`,
};

/** Quantos cabeçalhos por pasta ficam guardados para abrir o app instantaneamente. */
const MAX_CACHED_HEADERS = 200;

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const { value } = await Preferences.get({ key });
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

async function writeJson(key: string, value: unknown): Promise<void> {
  await Preferences.set({ key, value: JSON.stringify(value) });
}

export function newAccountId(): string {
  return `acc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export const accountStore = {
  async loadAccounts(): Promise<MailAccount[]> {
    const list = await readJson<MailAccount[]>(KEYS.ACCOUNTS, []);
    return Array.isArray(list) ? list : [];
  },

  async saveAccounts(accounts: MailAccount[]): Promise<void> {
    await writeJson(KEYS.ACCOUNTS, accounts);
  },

  async loadActiveId(): Promise<string | null> {
    const { value } = await Preferences.get({ key: KEYS.ACTIVE });
    return value || null;
  },

  async saveActiveId(id: string): Promise<void> {
    await Preferences.set({ key: KEYS.ACTIVE, value: id });
  },

  async loadFolders(accountId: string): Promise<MailFolderInfo[]> {
    return readJson<MailFolderInfo[]>(KEYS.FOLDERS(accountId), []);
  },

  async saveFolders(accountId: string, folders: MailFolderInfo[]): Promise<void> {
    await writeJson(KEYS.FOLDERS(accountId), folders);
  },

  async loadHeaders(accountId: string, folder: string): Promise<MessageHeader[]> {
    return readJson<MessageHeader[]>(KEYS.HEADERS(accountId, folder), []);
  },

  async saveHeaders(accountId: string, folder: string, headers: MessageHeader[]): Promise<void> {
    await writeJson(KEYS.HEADERS(accountId, folder), headers.slice(0, MAX_CACHED_HEADERS));
  },

  /** Apaga tudo de uma conta: senha do cofre, pastas e cabeçalhos em cache. */
  async removeAccountData(accountId: string): Promise<void> {
    try {
      await AnecttaMail.removeAccountPassword({ accountId });
    } catch {
      // segue limpando o restante
    }
    const { keys } = await Preferences.keys();
    await Promise.all(
      keys
        .filter((k) => k === KEYS.FOLDERS(accountId) || k.startsWith(`anectta_mobile_headers_v3_${accountId}_`))
        .map((key) => Preferences.remove({ key }))
    );
  },

  /**
   * Migra contas da versão anterior (que guardava a senha sem criptografia e usava o
   * gateway): a senha vai para o cofre e os dados antigos são apagados.
   */
  async migrateLegacy(): Promise<MailAccount[]> {
    const legacy = await readJson<any[]>('anectta_mobile_accounts_v2', []);
    if (!Array.isArray(legacy) || legacy.length === 0) return [];
    const migrated: MailAccount[] = [];
    for (const old of legacy) {
      if (!old?.email || !old?.imapHost) continue;
      const imapSecurity: Security = old.imapSecure === false ? 'starttls' : 'ssl';
      const smtpSecurity: Security = old.smtpSecure === false ? 'starttls' : 'ssl';
      const account: MailAccount = {
        id: String(old.id || newAccountId()),
        email: String(old.email),
        displayName: String(old.displayName || ''),
        imapHost: String(old.imapHost),
        imapPort: Number(old.imapPort) || 993,
        imapSecurity,
        smtpHost: String(old.smtpHost || ''),
        smtpPort: Number(old.smtpPort) || 465,
        smtpSecurity,
      };
      if (old.password) {
        try {
          await AnecttaMail.saveAccountPassword({ accountId: account.id, password: String(old.password) });
        } catch {
          // sem a senha no cofre, o app pede de novo ao abrir a conta
        }
      }
      migrated.push(account);
    }
    const { keys } = await Preferences.keys();
    await Promise.all(
      keys
        .filter((k) => k.startsWith('anectta_mobile_') && k.includes('_v2'))
        .map((key) => Preferences.remove({ key }))
    );
    return migrated;
  },
};

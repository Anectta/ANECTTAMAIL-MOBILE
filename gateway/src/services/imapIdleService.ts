import { ImapFlow } from 'imapflow';
import { isTlsHostTrusted } from './tlsTrust';
import type { MailServerConfig } from './mailService';

interface IdleEntry {
  key: string;
  config: MailServerConfig;
  client: ImapFlow | null;
  stopped: boolean;
  retryMs: number;
  timer: NodeJS.Timeout | null;
}

/**
 * Mantém uma conexão IMAP IDLE por conta (pasta INBOX). Quando o servidor avisa
 * que chegou mensagem nova, dispara o callback para o renderer sincronizar na hora.
 */
export class ImapIdleService {
  private static entries = new Map<string, IdleEntry>();
  private static onNewMail: ((accountKey: string) => void) | null = null;

  public static setListener(cb: (accountKey: string) => void) {
    this.onNewMail = cb;
  }

  private static keyOf(config: MailServerConfig) {
    return `${config.user}@${config.host}:${config.port || 993}`;
  }

  public static start(config: MailServerConfig): boolean {
    if (!config.host || !config.user || (!config.pass && !config.accessToken)) return false;
    if ((config.protocol || 'imap') !== 'imap') return false;
    const key = this.keyOf(config);
    const existing = this.entries.get(key);
    if (existing) {
      existing.config = config; // atualiza credenciais/token
      return true;
    }
    const entry: IdleEntry = { key, config, client: null, stopped: false, retryMs: 5000, timer: null };
    this.entries.set(key, entry);
    void this.run(entry);
    return true;
  }

  public static stopAll() {
    for (const e of this.entries.values()) this.teardown(e);
    this.entries.clear();
  }

  private static teardown(e: IdleEntry) {
    e.stopped = true;
    if (e.timer) clearTimeout(e.timer);
    try { e.client?.close(); } catch { /* ignore */ }
    e.client = null;
  }

  private static scheduleRetry(e: IdleEntry) {
    if (e.stopped) return;
    if (e.timer) clearTimeout(e.timer);
    e.timer = setTimeout(() => void this.run(e), e.retryMs);
    e.retryMs = Math.min(e.retryMs * 2, 120000);
  }

  private static async run(e: IdleEntry) {
    if (e.stopped) return;
    const c = e.config;
    const client = new ImapFlow({
      host: c.host,
      port: c.port || 993,
      secure: c.secure !== false,
      auth: c.accessToken ? { user: c.user, accessToken: c.accessToken } : { user: c.user, pass: c.pass },
      tls: { rejectUnauthorized: !isTlsHostTrusted(c.host) },
      logger: false,
      // Reenvia IDLE periodicamente para manter a conexão viva em NAT/proxies
      maxIdleTime: 5 * 60 * 1000,
    } as any);
    e.client = client;

    client.on('error', (err: any) => {
      console.warn('[IMAP IDLE] erro de socket:', err?.message || err);
    });
    client.on('exists', () => {
      this.onNewMail?.(e.key);
    });
    client.on('close', () => {
      if (e.client === client) e.client = null;
      this.scheduleRetry(e);
    });

    try {
      await client.connect();
      await client.mailboxOpen('INBOX'); // ImapFlow entra em IDLE automaticamente quando ocioso
      e.retryMs = 5000;
      console.log('[IMAP IDLE] ativo para', e.key);
    } catch (err: any) {
      console.warn('[IMAP IDLE] falha ao conectar:', err?.message || err);
      try { client.close(); } catch { /* ignore */ }
    }
  }
}

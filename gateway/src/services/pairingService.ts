import crypto from 'crypto';

/**
 * Payload de configuração transferido no pareamento Desktop ↔ Mobile.
 * Por segurança (modelo zero-password-sync), NUNCA inclui senhas ou tokens secretos.
 */
export interface PairingAccountPayload {
  displayName: string;
  email: string;
  protocol: 'imap' | 'pop3';
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  theme?: string;
  signatureHtml?: string;
}

interface PairingRecord {
  code: string;
  payload: PairingAccountPayload[];
  createdAt: number;
  expiresAt: number;
}

const PAIRING_TTL_MS = 3 * 60 * 1000; // 3 minutos
const store = new Map<string, PairingRecord>();

function cleanupExpired(): void {
  const now = Date.now();
  for (const [code, record] of store.entries()) {
    if (record.expiresAt <= now) {
      store.delete(code);
    }
  }
}

function generateNumericCode(): string {
  // Código numérico de 6 dígitos criptograficamente seguro
  const num = crypto.randomInt(100000, 999999);
  return String(num);
}

export const pairingService = {
  createSession(accounts: PairingAccountPayload[]): { code: string; expiresInSeconds: number } {
    cleanupExpired();

    // Sanitiza explicitamente para garantir que nenhuma senha seja armazenada
    const sanitized: PairingAccountPayload[] = accounts.map((acc) => ({
      displayName: String(acc.displayName || '').trim(),
      email: String(acc.email || '').trim(),
      protocol: acc.protocol === 'pop3' ? 'pop3' : 'imap',
      imapHost: String(acc.imapHost || '').trim(),
      imapPort: Number(acc.imapPort || (acc.protocol === 'pop3' ? 995 : 993)),
      imapSecure: acc.imapSecure !== false,
      smtpHost: String(acc.smtpHost || '').trim(),
      smtpPort: Number(acc.smtpPort || 465),
      smtpSecure: acc.smtpSecure !== false,
      theme: acc.theme ? String(acc.theme) : undefined,
      signatureHtml: acc.signatureHtml ? String(acc.signatureHtml) : undefined,
    }));

    let code = generateNumericCode();
    while (store.has(code)) {
      code = generateNumericCode();
    }

    const now = Date.now();
    store.set(code, {
      code,
      payload: sanitized,
      createdAt: now,
      expiresAt: now + PAIRING_TTL_MS,
    });

    return {
      code,
      expiresInSeconds: Math.floor(PAIRING_TTL_MS / 1000),
    };
  },

  claimSession(rawCode: string): PairingAccountPayload[] | null {
    cleanupExpired();
    const code = String(rawCode || '').replace(/\D/g, '');
    const record = store.get(code);
    if (!record) return null;

    // Uso único: apaga imediatamente da memória ao ser resgatado
    store.delete(code);
    if (record.expiresAt <= Date.now()) return null;
    return record.payload;
  },
};

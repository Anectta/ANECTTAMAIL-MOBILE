import type { MailAccount, Security } from '@/types/mail';

/** Servidores de provedores conhecidos (mesma base usada no Anectta MAIL Desktop). */
export interface ProviderPreset {
  name: string;
  imapHost: string;
  imapPort: number;
  imapSecurity: Security;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: Security;
  /** O provedor exige "senha de app" quando há verificação em duas etapas. */
  needsAppPassword?: boolean;
}

const preset = (
  name: string,
  imapHost: string,
  smtpHost: string,
  smtpPort = 465,
  smtpSecurity: Security = 'ssl',
  needsAppPassword = false
): ProviderPreset => ({
  name,
  imapHost,
  imapPort: 993,
  imapSecurity: 'ssl',
  smtpHost,
  smtpPort,
  smtpSecurity,
  needsAppPassword,
});

const GMAIL = preset('Google (Gmail)', 'imap.gmail.com', 'smtp.gmail.com', 465, 'ssl', true);
const OUTLOOK = preset('Microsoft (Outlook / Hotmail)', 'outlook.office365.com', 'smtp.office365.com', 587, 'starttls');
const YAHOO = preset('Yahoo', 'imap.mail.yahoo.com', 'smtp.mail.yahoo.com', 465, 'ssl', true);
const ICLOUD = preset('iCloud', 'imap.mail.me.com', 'smtp.mail.me.com', 587, 'starttls', true);
const AOL = preset('AOL', 'imap.aol.com', 'smtp.aol.com', 465, 'ssl', true);
const ZOHO = preset('Zoho Mail', 'imap.zoho.com', 'smtp.zoho.com');

const KNOWN_DOMAINS: Record<string, ProviderPreset> = {
  'gmail.com': GMAIL,
  'googlemail.com': GMAIL,
  'outlook.com': OUTLOOK,
  'outlook.com.br': OUTLOOK,
  'hotmail.com': OUTLOOK,
  'hotmail.com.br': OUTLOOK,
  'live.com': OUTLOOK,
  'msn.com': OUTLOOK,
  'yahoo.com': YAHOO,
  'yahoo.com.br': YAHOO,
  'ymail.com': YAHOO,
  'icloud.com': ICLOUD,
  'me.com': ICLOUD,
  'mac.com': ICLOUD,
  'aol.com': AOL,
  'zoho.com': ZOHO,
  'uol.com.br': preset('UOL', 'imap.uol.com.br', 'smtps.uol.com.br', 587, 'starttls'),
  'bol.com.br': preset('BOL', 'imap.bol.com.br', 'smtps.bol.com.br', 587, 'starttls'),
  'terra.com.br': preset('Terra', 'imap.terra.com.br', 'smtp.terra.com.br', 587, 'starttls'),
};

export function domainOf(email: string): string {
  const at = email.lastIndexOf('@');
  return at >= 0 ? email.slice(at + 1).trim().toLowerCase() : '';
}

/**
 * Configuração sugerida para o e-mail: provedor conhecido, ou o padrão mais comum para
 * domínios próprios (imap.dominio:993 SSL e smtp.dominio:465 SSL), que o usuário pode ajustar.
 */
export function suggestServers(email: string): { preset: ProviderPreset; known: boolean } {
  const domain = domainOf(email);
  const known = KNOWN_DOMAINS[domain];
  if (known) return { preset: known, known: true };
  return {
    preset: preset(domain ? `Domínio ${domain}` : 'Servidor próprio', domain ? `imap.${domain}` : '', domain ? `smtp.${domain}` : ''),
    known: false,
  };
}

export function applyPreset(account: MailAccount, p: ProviderPreset): MailAccount {
  return {
    ...account,
    imapHost: p.imapHost,
    imapPort: p.imapPort,
    imapSecurity: p.imapSecurity,
    smtpHost: p.smtpHost,
    smtpPort: p.smtpPort,
    smtpSecurity: p.smtpSecurity,
    providerName: p.name,
    needsAppPassword: p.needsAppPassword,
  };
}

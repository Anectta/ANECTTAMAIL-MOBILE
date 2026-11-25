/** Tipos do Anectta MAIL Mobile (conexão direta IMAP/SMTP do aparelho). */

export type Security = 'ssl' | 'starttls' | 'none';

/** Conta configurada no aparelho. A senha NÃO fica aqui: vive no cofre do sistema. */
export interface MailAccount {
  id: string;
  email: string;
  displayName: string;
  /** Usuário de login, se diferente do e-mail. */
  username?: string;
  imapHost: string;
  imapPort: number;
  imapSecurity: Security;
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: Security;
  providerName?: string;
  /** Dica de senha de app (Gmail, Yahoo, iCloud...). */
  needsAppPassword?: boolean;
}

export type FolderRole = 'inbox' | 'sent' | 'drafts' | 'trash' | 'junk' | 'archive' | 'other';

export interface MailFolderInfo {
  path: string;
  name: string;
  role: FolderRole;
  total: number;
  unread: number;
}

export interface MailAddress {
  name: string;
  email: string;
}

export interface MessageHeader {
  uid: number;
  messageId: string;
  inReplyTo: string;
  references: string;
  from: MailAddress;
  to: MailAddress[];
  cc: MailAddress[];
  subject: string;
  /** Data em milissegundos. */
  date: number;
  seen: boolean;
  flagged: boolean;
  answered: boolean;
  hasAttachments: boolean;
  size: number;
  /** Trecho do texto (preenchido depois que a mensagem é aberta uma vez). */
  snippet?: string;
}

export interface HeaderPage {
  folder: string;
  uidValidity: number;
  total: number;
  hasMore: boolean;
  messages: MessageHeader[];
}

export interface AttachmentInfo {
  partId: string;
  name: string;
  contentType: string;
  size: number;
  inline: boolean;
}

export interface MessageBody {
  uid: number;
  text: string;
  html: string;
  attachments: AttachmentInfo[];
}

export interface OutgoingMessage {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text: string;
  html?: string;
  inReplyTo?: string;
  references?: string;
}

export interface SendResult {
  messageId: string;
  savedToSent: boolean;
  sentFolder: string;
}

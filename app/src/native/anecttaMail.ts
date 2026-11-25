import { Capacitor, registerPlugin } from '@capacitor/core';
import type {
  HeaderPage,
  MailAccount,
  MailFolderInfo,
  MessageBody,
  OutgoingMessage,
  SendResult,
} from '@/types/mail';

/** Conta enviada ao motor nativo; `password` só vai ao testar/salvar a conta. */
export type AccountPayload = MailAccount & { password?: string };

/**
 * Motor de e-mail nativo (Android: Java + Angus Mail). O aparelho conversa direto com o
 * servidor IMAP/SMTP do usuário — não existe servidor intermediário.
 */
export interface AnecttaMailPlugin {
  saveAccountPassword(options: { accountId: string; password: string }): Promise<void>;
  removeAccountPassword(options: { accountId: string }): Promise<void>;
  hasAccountPassword(options: { accountId: string }): Promise<{ has: boolean }>;

  testConnection(options: { account: AccountPayload }): Promise<{ message: string }>;
  listFolders(options: { account: AccountPayload }): Promise<{ folders: MailFolderInfo[] }>;
  fetchHeaders(options: {
    account: AccountPayload;
    folder: string;
    limit?: number;
    beforeUid?: number;
  }): Promise<HeaderPage>;
  fetchBody(options: {
    account: AccountPayload;
    folder: string;
    uid: number;
    markSeen?: boolean;
  }): Promise<MessageBody>;
  setFlags(options: {
    account: AccountPayload;
    folder: string;
    uids: number[];
    seen?: boolean;
    flagged?: boolean;
  }): Promise<void>;
  moveMessages(options: {
    account: AccountPayload;
    folder: string;
    uids: number[];
    toFolder: string;
  }): Promise<void>;
  deleteMessages(options: {
    account: AccountPayload;
    folder: string;
    uids: number[];
    trashFolder?: string;
  }): Promise<void>;
  sendMessage(options: { account: AccountPayload; message: OutgoingMessage }): Promise<SendResult>;
}

export const AnecttaMail = registerPlugin<AnecttaMailPlugin>('AnecttaMail', {
  // No navegador (desenvolvimento) não existe IMAP: usa uma caixa de demonstração em memória.
  web: () => import('./anecttaMailWeb').then((m) => new m.AnecttaMailWeb()),
});

/** true quando roda no navegador (modo demonstração). */
export const isDemoMode = !Capacitor.isNativePlatform();

/** Mensagem de erro amigável vinda do motor nativo. */
export function errorMessage(err: unknown, fallback = 'Não foi possível concluir a operação.'): string {
  if (err && typeof err === 'object' && 'message' in err) {
    const msg = String((err as { message?: unknown }).message || '').trim();
    if (msg) return msg;
  }
  return fallback;
}

import { WebPlugin } from '@capacitor/core';
import type { AccountPayload, AnecttaMailPlugin } from './anecttaMail';
import type {
  HeaderPage,
  MailFolderInfo,
  MessageBody,
  MessageHeader,
  OutgoingMessage,
  SendResult,
} from '@/types/mail';

/**
 * Implementação de demonstração para o navegador (desenvolvimento). Tudo fica em memória;
 * nenhuma senha é gravada. No aparelho, quem responde é o motor nativo IMAP/SMTP.
 */
interface DemoMessage {
  header: MessageHeader;
  body: MessageBody;
}

const HOUR = 3600_000;

function demoMailbox(owner: string): Record<string, DemoMessage[]> {
  const now = Date.now();
  let uid = 100;
  const make = (
    fromName: string,
    fromEmail: string,
    subject: string,
    text: string,
    hoursAgo: number,
    extra: Partial<MessageHeader> = {},
    html = ''
  ): DemoMessage => {
    uid += 1;
    return {
      header: {
        uid,
        messageId: `<demo-${uid}@anectta.demo>`,
        inReplyTo: '',
        references: '',
        from: { name: fromName, email: fromEmail },
        to: [{ name: '', email: owner }],
        cc: [],
        subject,
        date: now - hoursAgo * HOUR,
        seen: false,
        flagged: false,
        answered: false,
        hasAttachments: false,
        size: text.length,
        ...extra,
      },
      body: { uid, text, html, attachments: [] },
    };
  };
  const inbox = [
    make('Marina Duarte', 'marina.duarte@exemplo.com.br', 'Reunião de alinhamento do projeto',
      'Olá,\n\nPodemos fazer a reunião na sexta-feira às 14h? Segue a pauta em anexo.\n\nAbraços,\nMarina', 1,
      { hasAttachments: true }),
    make('Financeiro Exemplo', 'cobranca@exemplo.com.br', 'Fatura de dezembro disponível',
      'Sua fatura no valor de R$ 389,90 vence em 05/12.', 3, { seen: true },
      '<p>Sua fatura no valor de <b>R$ 389,90</b> vence em <b>05/12</b>.</p>' +
        '<p><img src="https://exemplo.com.br/pixel.gif" width="1" height="1"></p>'),
    make('Rafael Moura', 'rafael@cliente-exemplo.com.br', 'Proposta revisada',
      'Bom dia! Revisei a proposta e deixei os comentários. Consegue me retornar até amanhã?', 20,
      { flagged: true }),
    make('Equipe de Suporte', 'suporte@servico-exemplo.com', 'Seu chamado #4821 foi respondido',
      'Olá! Seu chamado foi respondido pela nossa equipe.', 30, { seen: true }),
    make('Juliana Prado', 'juliana@exemplo.com.br', 'Fotos do evento',
      'Oi! Seguem as fotos do evento de ontem.', 52, { seen: true, hasAttachments: true }),
  ];
  for (let i = 1; i <= 30; i += 1) {
    inbox.push(make(`Contato ${i}`, `contato${i}@exemplo.com.br`, `Mensagem antiga ${i}`,
      `Conteúdo da mensagem antiga ${i}.`, 72 + i * 10, { seen: true }));
  }
  // Como no IMAP real: UIDs crescem com a chegada (a mais nova tem o maior UID).
  inbox
    .sort((a, b) => a.header.date - b.header.date)
    .forEach((m, i) => {
      m.header.uid = 1000 + i;
      m.body.uid = 1000 + i;
    });
  return {
    INBOX: inbox,
    'Itens Enviados': [
      make('Você', owner, 'Re: Orçamento aprovado', 'Perfeito, vamos seguir com o orçamento.', 5, { seen: true }),
    ],
    Rascunhos: [],
    Arquivo: [
      make('Newsletter Exemplo', 'news@exemplo.com', 'Novidades da semana', 'Confira as novidades.', 100, { seen: true }),
    ],
    Spam: [make('Promoção!!!', 'oferta@spam-exemplo.com', 'Você ganhou um prêmio', 'Clique aqui.', 8)],
    Lixeira: [],
  };
}

const ROLES: Record<string, MailFolderInfo['role']> = {
  INBOX: 'inbox',
  'Itens Enviados': 'sent',
  Rascunhos: 'drafts',
  Arquivo: 'archive',
  Spam: 'junk',
  Lixeira: 'trash',
};

export class AnecttaMailWeb extends WebPlugin implements AnecttaMailPlugin {
  private readonly boxes = new Map<string, Record<string, DemoMessage[]>>();
  private readonly passwords = new Map<string, string>();

  private box(account: AccountPayload): Record<string, DemoMessage[]> {
    const key = account.email.toLowerCase();
    let b = this.boxes.get(key);
    if (!b) {
      b = demoMailbox(account.email);
      this.boxes.set(key, b);
    }
    return b;
  }

  private ensureAuth(account: AccountPayload): void {
    const pwd = account.password || this.passwords.get(account.id);
    if (!pwd) throw new Error('A senha desta conta não está salva neste aparelho.');
    if (pwd === 'erro') throw new Error('Usuário ou senha incorretos (IMAP).');
  }

  private delay(): Promise<void> {
    return new Promise((r) => setTimeout(r, 250));
  }

  async saveAccountPassword(o: { accountId: string; password: string }): Promise<void> {
    this.passwords.set(o.accountId, o.password);
  }

  async removeAccountPassword(o: { accountId: string }): Promise<void> {
    this.passwords.delete(o.accountId);
  }

  async hasAccountPassword(o: { accountId: string }): Promise<{ has: boolean }> {
    return { has: this.passwords.has(o.accountId) };
  }

  async testConnection(o: { account: AccountPayload }): Promise<{ message: string }> {
    await this.delay();
    this.ensureAuth(o.account);
    const total = this.box(o.account).INBOX.length;
    return { message: `Conexão bem-sucedida (demonstração). Caixa de Entrada com ${total} mensagens.` };
  }

  async listFolders(o: { account: AccountPayload }): Promise<{ folders: MailFolderInfo[] }> {
    await this.delay();
    this.ensureAuth(o.account);
    const b = this.box(o.account);
    return {
      folders: Object.keys(b).map((path) => ({
        path,
        name: path === 'INBOX' ? 'Caixa de Entrada' : path,
        role: ROLES[path] || 'other',
        total: b[path].length,
        unread: b[path].filter((m) => !m.header.seen).length,
      })),
    };
  }

  async fetchHeaders(o: {
    account: AccountPayload;
    folder: string;
    limit?: number;
    beforeUid?: number;
  }): Promise<HeaderPage> {
    await this.delay();
    this.ensureAuth(o.account);
    const all = [...(this.box(o.account)[o.folder] || [])].sort((a, b) => b.header.uid - a.header.uid);
    const older = o.beforeUid ? all.filter((m) => m.header.uid < (o.beforeUid as number)) : all;
    const page = older.slice(0, o.limit || 40);
    return {
      folder: o.folder,
      uidValidity: 1,
      total: all.length,
      hasMore: older.length > page.length,
      messages: page.map((m) => ({ ...m.header })),
    };
  }

  async fetchBody(o: { account: AccountPayload; folder: string; uid: number; markSeen?: boolean }): Promise<MessageBody> {
    await this.delay();
    this.ensureAuth(o.account);
    const msg = (this.box(o.account)[o.folder] || []).find((m) => m.header.uid === o.uid);
    if (!msg) throw new Error('Mensagem não encontrada. Ela pode ter sido movida ou excluída em outro aparelho.');
    if (o.markSeen !== false) msg.header.seen = true;
    return { ...msg.body };
  }

  async setFlags(o: { account: AccountPayload; folder: string; uids: number[]; seen?: boolean; flagged?: boolean }): Promise<void> {
    await this.delay();
    for (const m of this.box(o.account)[o.folder] || []) {
      if (!o.uids.includes(m.header.uid)) continue;
      if (typeof o.seen === 'boolean') m.header.seen = o.seen;
      if (typeof o.flagged === 'boolean') m.header.flagged = o.flagged;
    }
  }

  async moveMessages(o: { account: AccountPayload; folder: string; uids: number[]; toFolder: string }): Promise<void> {
    await this.delay();
    const b = this.box(o.account);
    const moving = (b[o.folder] || []).filter((m) => o.uids.includes(m.header.uid));
    b[o.folder] = (b[o.folder] || []).filter((m) => !o.uids.includes(m.header.uid));
    b[o.toFolder] = [...(b[o.toFolder] || []), ...moving];
  }

  async deleteMessages(o: { account: AccountPayload; folder: string; uids: number[]; trashFolder?: string }): Promise<void> {
    if (o.trashFolder && o.trashFolder !== o.folder) {
      await this.moveMessages({ ...o, toFolder: o.trashFolder });
      return;
    }
    await this.delay();
    const b = this.box(o.account);
    b[o.folder] = (b[o.folder] || []).filter((m) => !o.uids.includes(m.header.uid));
  }

  async sendMessage(o: { account: AccountPayload; message: OutgoingMessage }): Promise<SendResult> {
    await this.delay();
    this.ensureAuth(o.account);
    if (o.message.to.length === 0) throw new Error('Informe ao menos um destinatário.');
    const b = this.box(o.account);
    const uid = Date.now() % 1_000_000;
    b['Itens Enviados'].push({
      header: {
        uid,
        messageId: `<sent-${uid}@anectta.demo>`,
        inReplyTo: o.message.inReplyTo || '',
        references: o.message.references || '',
        from: { name: o.account.displayName, email: o.account.email },
        to: o.message.to.map((email) => ({ name: '', email })),
        cc: [],
        subject: o.message.subject,
        date: Date.now(),
        seen: true,
        flagged: false,
        answered: false,
        hasAttachments: false,
        size: o.message.text.length,
      },
      body: { uid, text: o.message.text, html: '', attachments: [] },
    });
    return { messageId: `<sent-${uid}@anectta.demo>`, savedToSent: true, sentFolder: 'Itens Enviados' };
  }
}

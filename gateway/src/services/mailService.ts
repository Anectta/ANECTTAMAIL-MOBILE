import fs from 'fs';
import path from 'path';
import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import { simpleParser } from 'mailparser';
import { SimplePop3Client } from './pop3Client';
import { isTlsHostTrusted } from './tlsTrust';
import { getDataStorageDir } from './storagePath';

export interface MailServerConfig {
  protocol?: 'imap' | 'pop3';
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  accessToken?: string;
  leaveOnServer?: boolean;
  knownUidsByFolder?: Record<string, number[]>;
}

export interface QuotaInfo {
  usedBytes: number;
  limitBytes: number;
}

export interface DiscoveredCustomFolder {
  imapPath: string;
  name: string;
  parentImapPath?: string;
  parentSystemFolder?: SupportedFolder;
  delimiter?: string;
}

export interface FetchResult {
  success: boolean;
  emails?: any[];
  error?: string;
  count?: number;
  folderStats?: Record<string, number>;
  customFolders?: DiscoveredCustomFolder[];
  quota?: QuotaInfo;
  flagUpdates?: Array<{ id: string; isRead: boolean; isStarred: boolean }>;
}

export type SupportedFolder = 'inbox' | 'sent' | 'drafts' | 'archive' | 'trash' | 'junk';

const EMAIL_ADDRESS_REGEX = /([^\s,;<>'"]+@[^\s,;<>'"]+\.[^\s,;<>'"]+)/;

/**
 * Extracts and validates a single email address from a raw header or address string.
 */
function extractValidEmail(raw: unknown): string | undefined {
  if (!raw) return undefined;
  const text = String(raw).replace(/^mailto:/i, '').trim();
  if (!text) return undefined;
  const bracketMatch = text.match(/<([^\s<>'"]+@[^\s<>'"]+\.[^\s<>'"]+)>/);
  const candidate = (bracketMatch ? bracketMatch[1] : text.match(EMAIL_ADDRESS_REGEX)?.[1] || '').trim();
  return /^[^\s@<>'"]+@[^\s@<>'"]+\.[^\s@<>'"]+$/.test(candidate) ? candidate : undefined;
}

/**
 * Extracts a validated read-receipt (MDN) return address from parsed email headers,
 * falling back to the sender's email if the header value is malformed.
 */
function extractReadReceiptAddress(headers: any, fallbackSenderEmail: string): string | undefined {
  if (!headers || typeof headers.get !== 'function') return undefined;
  const rawHeader =
    headers.get('disposition-notification-to') ||
    headers.get('return-receipt-to') ||
    headers.get('x-confirm-reading-to');
  if (!rawHeader) return undefined;

  const firstEntry = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
  const rawCandidates: unknown[] =
    typeof firstEntry === 'object' && firstEntry !== null
      ? [firstEntry.value?.[0]?.address, firstEntry.text]
      : [firstEntry];

  for (const candidate of rawCandidates) {
    const valid = extractValidEmail(candidate);
    if (valid) return valid;
  }

  return extractValidEmail(fallbackSenderEmail);
}

export class MailService {
  /**
   * Universal test connection (routes to IMAP or POP3 based on protocol)
   */
  public static async testIncomingConnection(config: MailServerConfig): Promise<{ success: boolean; message: string }> {
    if (config.protocol === 'pop3') {
      return await this.testPop3Connection(config);
    }
    return await this.testImapConnection(config);
  }

  /**
   * Universal fetch inbox (routes to IMAP or POP3)
   */
  public static async fetchIncomingInbox(config: MailServerConfig): Promise<FetchResult> {
    if (config.protocol === 'pop3') {
      return await this.fetchPop3Inbox(config);
    }
    return await this.fetchFolderMessages(config, 'inbox');
  }

  /**
   * Test IMAP incoming server connection
   */
  public static async testImapConnection(config: MailServerConfig): Promise<{ success: boolean; message: string }> {
    if (!config.host || !config.user || (!config.pass && !config.accessToken)) {
      return {
        success: false,
        message: 'Preencha o servidor, usuário e senha (ou conecte via OAuth 2.0) para conectar ao IMAP.',
      };
    }

    const client = new ImapFlow({
      host: config.host,
      port: config.port || 993,
      secure: config.secure !== false,
      auth: config.accessToken
        ? { user: config.user, accessToken: config.accessToken }
        : { user: config.user, pass: config.pass },
      tls: {
        rejectUnauthorized: !isTlsHostTrusted(config.host),
      },
      logger: false,
    });
    client.on('error', (err: any) => {
      console.warn('[IMAP-TEST] Erro assíncrono no socket IMAP:', err?.message || err);
    });

    try {
      await client.connect();
      const status = await client.status('INBOX', { messages: true, unseen: true });
      const totalMessages = (status && typeof status === 'object' && status.messages) || 0;
      const totalUnseen = (status && typeof status === 'object' && status.unseen) || 0;
      await client.logout();
      return {
        success: true,
        message: `Conectado com sucesso via IMAP! ${totalMessages} mensagens encontradas no servidor (${totalUnseen} não lidas).`,
      };
    } catch (err: any) {
      console.error('[IMAP-TEST] Erro de conexão:', err);
      const isYahoo =
        (config.host && config.host.toLowerCase().includes('yahoo')) ||
        (config.user && config.user.toLowerCase().includes('yahoo'));
      const isGmail =
        (config.host && config.host.toLowerCase().includes('gmail')) ||
        (config.user && config.user.toLowerCase().includes('gmail'));
      const isApple =
        (config.host && (config.host.toLowerCase().includes('apple') || config.host.toLowerCase().includes('icloud') || config.host.toLowerCase().includes('mail.me.com'))) ||
        (config.user && (config.user.toLowerCase().includes('@icloud.') || config.user.toLowerCase().includes('@me.com') || config.user.toLowerCase().includes('@mac.com')));
      const isAol =
        (config.host && config.host.toLowerCase().includes('aol')) ||
        (config.user && (config.user.toLowerCase().includes('@aol.') || config.user.toLowerCase().includes('@aim.com')));
      const isMicrosoft =
        (config.host && (config.host.toLowerCase().includes('outlook') || config.host.toLowerCase().includes('office365') || config.host.toLowerCase().includes('hotmail'))) ||
        (config.user && (config.user.toLowerCase().includes('@outlook.') || config.user.toLowerCase().includes('@hotmail.') || config.user.toLowerCase().includes('@live.') || config.user.toLowerCase().includes('@msn.')));

      let detailed = err.responseText || err.message || 'Falha na autenticação';
      if (err.authenticationFailed || err.message === 'Command failed' || err.message?.includes('AUTHENTICATIONFAILED') || err.message?.includes('LOGIN failed')) {
        if (isMicrosoft) {
          detailed =
            'A Microsoft desativou o login por senha comum e senhas de app para contas @outlook.com, @hotmail.com e @live.com via IMAP. Conexões diretas por senha não são mais aceitas (a Microsoft exige autenticação moderna OAuth 2.0).';
        } else if (isYahoo) {
          detailed =
            'Credenciais recusadas pelo Yahoo. O Yahoo exige uma "Senha de Aplicativo" de 16 caracteres gerada na Central de Segurança do Yahoo (não utilize sua senha pessoal de login).';
        } else if (isGmail) {
          detailed =
            'Credenciais recusadas pelo Google. O Gmail exige uma "Senha de App" de 16 caracteres gerada na Conta Google (Segurança > Senhas de app com Verificação em Duas Etapas ativa).';
        } else if (isApple) {
          detailed =
            'Credenciais recusadas pela Apple. O iCloud Mail exige obrigatoriamente uma "Senha Específica de App" gerada nas configurações do seu ID Apple (appleid.apple.com).';
        } else if (isAol) {
          detailed =
            'Credenciais recusadas pela AOL. O AOL Mail pertence ao grupo Yahoo e exige uma "Senha de Aplicativo" gerada na Central de Segurança da AOL.';
        } else {
          detailed = `Credenciais recusadas ou comando não suportado: ${err.responseText || err.message}`;
        }
      }

      return {
        success: false,
        message: `Falha ao conectar via IMAP: ${detailed}`,
      };
    }
  }

  /**
   * Test POP3 incoming server connection
   */
  public static async testPop3Connection(config: MailServerConfig): Promise<{ success: boolean; message: string }> {
    if (!config.host || !config.user || !config.pass) {
      return {
        success: false,
        message: 'Preencha o servidor, usuário e senha para conectar ao POP3.',
      };
    }

    const pop3 = new SimplePop3Client({
      user: config.user,
      pass: config.pass,
      host: config.host,
      port: config.port || 995,
      tls: config.secure !== false,
      rejectUnauthorized: !isTlsHostTrusted(config.host),
      timeout: 10000,
    });

    try {
      await pop3.connect();
      await pop3.login();
      const stat = await pop3.stat();
      await pop3.quit();

      return {
        success: true,
        message: `Conectado com sucesso via POP3! ${stat.count} mensagens disponíveis no servidor para download local.`,
      };
    } catch (err: any) {
      pop3.close();
      return {
        success: false,
        message: `Falha ao conectar via POP3: ${err.message || 'Verifique o host, porta (995 SSL) e senha.'}`,
      };
    }
  }

  /**
   * Discovers matching server mailbox path for a logical folder
   */
  public static findServerMailbox(mailboxes: any[], folder: SupportedFolder): string | null {
    if (folder === 'inbox') {
      return 'INBOX';
    }

    const specialUseMap: Record<SupportedFolder, string> = {
      inbox: '\\inbox',
      sent: '\\sent',
      drafts: '\\drafts',
      trash: '\\trash',
      junk: '\\junk',
      archive: '\\archive',
    };

    const targetSpecial = specialUseMap[folder];
    if (targetSpecial) {
      const match = mailboxes.find((m) => {
        const special = (m.specialUse || '').toLowerCase();
        return special === targetSpecial;
      });
      if (match && match.path) return match.path;
    }

    // Pattern matching by path and name
    const patterns: Record<SupportedFolder, RegExp[]> = {
      inbox: [/^inbox$/i],
      sent: [/sent/i, /enviad/i, /itens enviados/i, /caixa de sa[ií]da/i],
      drafts: [/draft/i, /rascunho/i, /rascunh/i],
      trash: [/trash/i, /lixeira/i, /itens exclu/i, /excluid/i, /deleted/i, /lixo/i],
      junk: [/junk/i, /spam/i, /mala_direta/i, /mala direta/i, /quarentena/i, /eletr[oô]nico/i],
      archive: [/archive/i, /arquivo/i, /arquiv/i, /todos/i],
    };

    const regexList = patterns[folder] || [];
    for (const regex of regexList) {
      const match = mailboxes.find((m) => {
        if (m.flags && (m.flags.has('\\Noselect') || m.flags.has('\\NonExistent'))) {
          return false;
        }
        return regex.test(m.path || '') || regex.test(m.name || '');
      });
      if (match && match.path) return match.path;
    }

    return null;
  }

  /**
   * Identifica se um anexo é na verdade uma imagem de assinatura digital ou inline
   */
  private static isSignatureOrInlineAttachment(att: any, bodyHtml?: string): boolean {
    const filename = (att.filename || att.name || '').trim();
    const contentType = (att.contentType || '').toLowerCase();
    const isImage =
      contentType.startsWith('image/') ||
      /\.(png|jpe?g|gif|bmp|webp|ico)$/i.test(filename);

    if (!isImage) return false;

    if (att.related || att.contentDisposition === 'inline' || att.isSignature || att.isInline) {
      return true;
    }
    if (att.cid && bodyHtml && bodyHtml.includes(att.cid)) {
      return true;
    }
    if (
      filename &&
      bodyHtml &&
      (bodyHtml.includes(filename) || bodyHtml.includes(encodeURIComponent(filename)))
    ) {
      return true;
    }
    const size = att.size || (att.content ? att.content.length : 0);
    const isSmallImage = size < 350 * 1024;
    const outlookAutoImagePattern = /^image\d{3,4}\.(png|jpe?g|gif|bmp|webp)$/i;
    if (outlookAutoImagePattern.test(filename) && isSmallImage) {
      return true;
    }
    const signatureNamePattern =
      /^(signature|assinatura|logo|logotipo|banner|footer|rodape|header|cabecalho|stamp|selo|social|icon_?|icone_?|whatsapp|facebook|linkedin|instagram|twitter|yt|youtube|badge)\w*\.(png|jpe?g|gif|webp|svg)$/i;
    if (signatureNamePattern.test(filename) && isSmallImage) {
      return true;
    }
    return false;
  }

  /**
   * Grava anexo baixado em cache local de dados do usuário
   */
  private static saveAttachmentCache(
    messageId: string,
    att: any,
    index: number,
    bodyHtml?: string
  ): { id: string; name: string; size: number; contentType: string; path?: string; isSignature?: boolean } {
    const attId = `att-${messageId}-${index}`;
    const isSignature = this.isSignatureOrInlineAttachment(att, bodyHtml);
    try {
      const attachmentsBaseDir = path.join(
        getDataStorageDir(),
        'attachments',
        messageId.replace(/[^a-zA-Z0-9_-]/g, '_')
      );
      if (!fs.existsSync(attachmentsBaseDir)) {
        fs.mkdirSync(attachmentsBaseDir, { recursive: true });
      }
      const safeFilename = (att.filename || `anexo-${index + 1}`).replace(/[\\/:*?"<>|]/g, '_');
      const filePath = path.join(attachmentsBaseDir, safeFilename);
      if (att.content && Buffer.isBuffer(att.content)) {
        fs.writeFileSync(filePath, att.content);
      }
      return {
        id: attId,
        name: att.filename || `anexo-${index + 1}`,
        size: att.size || (att.content ? att.content.length : 0),
        contentType: att.contentType || 'application/octet-stream',
        path: filePath,
        isSignature,
      };
    } catch (err) {
      console.warn('[MAIL SERVICE] Falha ao gravar anexo em cache:', err);
      return {
        id: attId,
        name: att.filename || `anexo-${index + 1}`,
        size: att.size || 0,
        contentType: att.contentType || 'application/octet-stream',
        isSignature,
      };
    }
  }

  /**
   * Faz o download sob demanda de um anexo específico via IMAP (usado quando o cache local está corrompido/truncado).
   */
  public static async redownloadImapAttachment(
    config: MailServerConfig,
    folderOrPath: string,
    uid: number,
    targetFilename: string,
    destFilePath: string
  ): Promise<boolean> {
    if (config.protocol === 'pop3' || !config.host || !config.user || (!config.pass && !config.accessToken)) {
      return false;
    }

    const client = new ImapFlow({
      host: config.host,
      port: config.port || 993,
      secure: config.secure !== false,
      auth: config.accessToken
        ? { user: config.user, accessToken: config.accessToken }
        : { user: config.user, pass: config.pass },
      tls: { rejectUnauthorized: !isTlsHostTrusted(config.host) },
      logger: false,
    });
    client.on('error', () => {});

    try {
      await client.connect();
      const mailboxes = await client.list();
      const systemFolders: SupportedFolder[] = ['inbox', 'sent', 'drafts', 'trash', 'junk', 'archive'];
      let mailboxPath: string | null = null;

      if (systemFolders.includes(folderOrPath as SupportedFolder)) {
        mailboxPath =
          this.findServerMailbox(mailboxes, folderOrPath as SupportedFolder) ||
          (folderOrPath === 'inbox' ? 'INBOX' : null);
      } else {
        const cleanTarget = folderOrPath.startsWith('imap:') ? folderOrPath.slice(5) : folderOrPath;
        const normalized = cleanTarget.replace(/_/g, '/');
        const match = mailboxes.find(
          (m: any) =>
            !(m.flags && (m.flags.has('\\Noselect') || m.flags.has('\\NonExistent'))) &&
            (m.path === cleanTarget ||
              m.name === cleanTarget ||
              m.path.replace(/[\\/:*?"<>|.\s-]/g, '_') === cleanTarget.replace(/[\\/:*?"<>|.\s-]/g, '_') ||
              m.path === normalized)
        );
        mailboxPath = match?.path || cleanTarget;
      }

      if (!mailboxPath) {
        await client.logout();
        return false;
      }

      const lock = await client.getMailboxLock(mailboxPath);
      let saved = false;
      try {
        const msg = await client.fetchOne(
          String(uid),
          { source: true },
          { uid: true }
        );
        if (msg && (msg as any).source) {
          const parsed: any = await simpleParser((msg as any).source);
          if (parsed.attachments && Array.isArray(parsed.attachments)) {
            const normTarget = targetFilename.replace(/[\\/:*?"<>|]/g, '_').toLowerCase();
            const att =
              parsed.attachments.find(
                (a: any) =>
                  (a.filename || '').replace(/[\\/:*?"<>|]/g, '_').toLowerCase() === normTarget
              ) ||
              parsed.attachments.find((a: any) =>
                (a.filename || '').toLowerCase().endsWith(path.extname(targetFilename).toLowerCase())
              ) ||
              parsed.attachments[0];

            if (att && att.content && Buffer.isBuffer(att.content)) {
              const dir = path.dirname(destFilePath);
              if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
              }
              fs.writeFileSync(destFilePath, att.content);
              saved = true;
            }
          }
        }
      } finally {
        lock.release();
      }

      await client.logout();
      return saved;
    } catch (err: any) {
      console.warn('[IMAP] Falha ao rebaixar anexo completo:', err?.message || err);
      try {
        await client.logout();
      } catch {}
      return false;
    }
  }

  /**
   * Helper to parse IMAP message into app EmailItem structure
   */
  private static async formatImapMessage(
    message: any,
    folder: string,
    config: MailServerConfig
  ): Promise<any> {
    const env = message.envelope || {};
    const senderName = env.from?.[0]?.name || env.from?.[0]?.address || 'Remetente Desconhecido';
    const senderEmail = env.from?.[0]?.address || '';
    const subject = env.subject || '(Sem Assunto)';
    const date = env.date
      ? new Date(env.date)
      : message.internalDate
      ? new Date(message.internalDate)
      : new Date();
    const isUnread = !message.flags?.has('\\Seen');
    const isStarred = Boolean(message.flags?.has('\\Flagged'));
    const messageId = `imap-${folder}-${message.uid}`;

    let bodyText = '';
    let bodyHtml: string | undefined = undefined;
    let snippet = '';
    let hasAttachment = false;
    let attachmentsList: any[] = [];
    let messageIdHeader: string | undefined = env.messageId || undefined;
    let inReplyToHeader: string | undefined = env.inReplyTo || undefined;
    let readReceiptRequestedBy: string | undefined = undefined;

    if (message.source) {
      try {
        const parsed: any = await simpleParser(message.source);
        const textContent = parsed.text || '';
        const htmlContent = parsed.html || '';
        bodyHtml = htmlContent || undefined;
        bodyText = textContent || (htmlContent ? htmlContent.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '');
        snippet = bodyText.slice(0, 120);

        if (parsed.messageId) {
          messageIdHeader = String(parsed.messageId).trim();
        }
        if (parsed.inReplyTo) {
          inReplyToHeader = String(parsed.inReplyTo).trim();
        }
        readReceiptRequestedBy = extractReadReceiptAddress(parsed.headers, senderEmail);

        if (parsed.attachments && Array.isArray(parsed.attachments) && parsed.attachments.length > 0) {
          attachmentsList = parsed.attachments.map((att: any, idx: number) =>
            this.saveAttachmentCache(messageId, att, idx, htmlContent)
          );
          hasAttachment = attachmentsList.some((a) => !a.isSignature);
        }
      } catch (parseErr) {
        console.warn('[MAIL SERVICE] Erro no simpleParser:', parseErr);
      }
    }

    if (!bodyText) {
      bodyText = `De: ${senderName} <${senderEmail}>\nPara: ${env.to?.[0]?.address || config.user}\nData: ${date.toLocaleString('pt-BR')}\nAssunto: ${subject}\n\n[Mensagem sincronizada via IMAP da pasta ${folder.toUpperCase()} do servidor ${config.host}]`;
      snippet = subject;
    }

    // Compute period
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
    const lastWeekStart = new Date(todayStart.getTime() - 7 * 24 * 60 * 60 * 1000);

    let period: 'today' | 'yesterday' | 'last_week' | 'older' = 'older';
    if (date >= todayStart) period = 'today';
    else if (date >= yesterdayStart) period = 'yesterday';
    else if (date >= lastWeekStart) period = 'last_week';

    const timeStr =
      date >= todayStart
        ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : date >= yesterdayStart
        ? 'Ontem'
        : date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });

    const folderTagMap: Record<string, string> = {
      inbox: 'Entrada',
      sent: 'Enviado',
      drafts: 'Rascunho',
      trash: 'Lixeira',
      junk: 'Spam',
      archive: 'Arquivo',
    };

    const folderTag = folderTagMap[folder] || (folder.startsWith('imap:') ? folder.slice(5).split(/[/.]/).pop() || folder : folder);
    const allRecipients = Array.isArray(env.to) && env.to.length > 0
      ? env.to.map((t: any) => (t.name ? `${t.name} <${t.address}>` : t.address)).filter(Boolean).join(', ')
      : env.to?.[0]?.address || config.user;

    return {
      id: messageId,
      messageIdHeader,
      inReplyToHeader,
      readReceiptRequestedBy,
      sender: senderName,
      senderEmail: senderEmail,
      avatar: '',
      recipient: allRecipients,
      subject: subject,
      snippet: snippet || subject,
      body: bodyText,
      bodyHtml: bodyHtml,
      attachments: attachmentsList.length > 0 ? attachmentsList : undefined,
      timestamp: timeStr,
      dateStr: date.toISOString(),
      period: period,
      folder: folder,
      priority: 'medium',
      isRead: !isUnread,
      isStarred: isStarred,
      hasAttachment: hasAttachment,
      tags: ['IMAP', folderTag],
    };
  }

  /**
   * Fetch messages from a specific folder via IMAP
   */
  public static async fetchFolderMessages(
    config: MailServerConfig,
    targetFolder: string = 'inbox',
    limit: number = 25,
    imapPathOverride?: string
  ): Promise<FetchResult> {
    if (!config.host || !config.user || (!config.pass && !config.accessToken)) {
      return {
        success: false,
        error: 'Credenciais de e-mail não configuradas.',
      };
    }

    if (config.protocol === 'pop3') {
      if (targetFolder === 'inbox') {
        return await this.fetchPop3Inbox(config);
      }
      return {
        success: true,
        emails: [],
        count: 0,
      };
    }

    const client = new ImapFlow({
      host: config.host,
      port: config.port || 993,
      secure: config.secure !== false,
      auth: config.accessToken
        ? { user: config.user, accessToken: config.accessToken }
        : { user: config.user, pass: config.pass },
      tls: {
        rejectUnauthorized: !isTlsHostTrusted(config.host),
      },
      logger: false,
    });
    client.on('error', (err: any) => {
      console.warn('[IMAP] Erro assíncrono no socket IMAP (fetchFolderMessages):', err?.message || err);
    });

    try {
      await client.connect();
      let quotaInfo: QuotaInfo | undefined;
      try {
        const q: any = await client.getQuota('INBOX');
        if (q && q.storage && typeof q.storage.usage === 'number') {
          quotaInfo = {
            usedBytes: q.storage.usage,
            limitBytes: typeof q.storage.limit === 'number' ? q.storage.limit : 0,
          };
        }
      } catch {
        // Servidor IMAP não suporta GETQUOTAROOT ou falhou silenciosamente
      }

      const mailboxes = await client.list();
      const systemFolders: SupportedFolder[] = ['inbox', 'sent', 'drafts', 'trash', 'junk', 'archive'];
      let mailboxPath: string | null = imapPathOverride || null;
      if (!mailboxPath) {
        if (systemFolders.includes(targetFolder as SupportedFolder)) {
          mailboxPath =
            this.findServerMailbox(mailboxes, targetFolder as SupportedFolder) ||
            (targetFolder === 'inbox' ? 'INBOX' : null);
        } else {
          const cleanTarget = targetFolder.startsWith('imap:') ? targetFolder.slice(5) : targetFolder;
          const match = mailboxes.find(
            (m: any) =>
              !(m.flags && (m.flags.has('\\Noselect') || m.flags.has('\\NonExistent'))) &&
              (m.path === cleanTarget || m.name === cleanTarget)
          );
          mailboxPath = match?.path || null;
        }
      }

      if (!mailboxPath) {
        await client.logout();
        return {
          success: true,
          emails: [],
          count: 0,
          quota: quotaInfo,
        };
      }

      const lock = await client.getMailboxLock(mailboxPath);
      const messages: any[] = [];

      try {
        const total = client.mailbox ? client.mailbox.exists : 0;
        if (total > 0) {
          const startIdx = Math.max(1, total - limit + 1);
          const range = `${startIdx}:${total}`;

            for await (const message of client.fetch(range, {
              envelope: true,
              flags: true,
              bodyStructure: true,
              uid: true,
              size: true,
              source: true,
            })) {
              try {
                const formatted = await this.formatImapMessage(message, targetFolder, config);
                messages.push(formatted);
              } catch (formatErr: any) {
                console.warn(`[IMAP] Erro ao formatar mensagem UID ${message?.uid}:`, formatErr?.message);
              }
            }

            // Ordena sempre decrescente por data/hora (mais recente no topo)
            messages.sort((a, b) => {
              const timeA = a.dateStr ? new Date(a.dateStr).getTime() : 0;
              const timeB = b.dateStr ? new Date(b.dateStr).getTime() : 0;
              return timeB - timeA;
            });
        }
      } finally {
        lock.release();
      }

      await client.logout();
      return {
        success: true,
        emails: messages,
        count: messages.length,
        quota: quotaInfo,
      };
    } catch (err: any) {
      return {
        success: false,
        error: `Erro ao sincronizar pasta ${targetFolder} via IMAP: ${err.message}`,
      };
    }
  }

  /**
   * Fetches only new messages (by UID) with full MIME source, while collecting flag updates
   * for already-cached UIDs without re-downloading their full source.
   */
  private static async fetchFolderIncremental(
    client: ImapFlow,
    range: string,
    folderKey: string,
    config: MailServerConfig,
    knownUids: Set<number>,
    flagUpdates: Array<{ id: string; isRead: boolean; isStarred: boolean }>
  ): Promise<{ messages: any[]; bytesCount: number }> {
    const messages: any[] = [];
    let bytesCount = 0;

    if (knownUids.size > 0) {
      const newUids: number[] = [];
      for await (const meta of client.fetch(range, { uid: true, flags: true, size: true })) {
        if (typeof (meta as any).size === 'number') {
          bytesCount += (meta as any).size;
        }
        const uid = Number((meta as any).uid);
        if (!Number.isFinite(uid)) continue;
        if (knownUids.has(uid)) {
          flagUpdates.push({
            id: `imap-${folderKey}-${uid}`,
            isRead: Boolean(meta.flags?.has('\\Seen')),
            isStarred: Boolean(meta.flags?.has('\\Flagged')),
          });
        } else {
          newUids.push(uid);
        }
      }

      if (newUids.length === 0) {
        return { messages, bytesCount };
      }

      for await (const message of client.fetch(
        newUids.join(','),
        {
          envelope: true,
          flags: true,
          bodyStructure: true,
          uid: true,
          source: true,
        },
        { uid: true }
      )) {
        try {
          const formatted = await this.formatImapMessage(message, folderKey, config);
          messages.push(formatted);
        } catch (formatErr: any) {
          console.warn(`[IMAP] Erro ao formatar mensagem UID ${message?.uid} em ${folderKey}:`, formatErr?.message);
        }
      }
      return { messages, bytesCount };
    }

    for await (const message of client.fetch(range, {
      envelope: true,
      flags: true,
      bodyStructure: true,
      uid: true,
      size: true,
      source: true,
    })) {
      if (typeof (message as any).size === 'number') {
        bytesCount += (message as any).size;
      }
      try {
        const formatted = await this.formatImapMessage(message, folderKey, config);
        messages.push(formatted);
      } catch (formatErr: any) {
        console.warn(`[IMAP] Erro ao formatar mensagem UID ${message?.uid}:`, formatErr?.message);
      }
    }

    return { messages, bytesCount };
  }

  /**
   * Full IMAP Multi-Folder Synchronization:
   * Synchronizes Inbox, Sent, Drafts, Trash, Junk, Archive from the IMAP server
   */
  public static async syncAllFolders(
    config: MailServerConfig,
    limitPerFolder: number = 25
  ): Promise<FetchResult & { folderStats?: Record<string, number> }> {
    if (!config.host || !config.user || (!config.pass && !config.accessToken)) {
      return {
        success: false,
        error: 'Credenciais de e-mail não configuradas.',
      };
    }

    if (config.protocol === 'pop3') {
      const pop3Res = await this.fetchPop3Inbox(config);
      return {
        ...pop3Res,
        folderStats: { inbox: pop3Res.count || 0 },
      };
    }

    const client = new ImapFlow({
      host: config.host,
      port: config.port || 993,
      secure: config.secure !== false,
      auth: config.accessToken
        ? { user: config.user, accessToken: config.accessToken }
        : { user: config.user, pass: config.pass },
      tls: {
        rejectUnauthorized: !isTlsHostTrusted(config.host),
      },
      logger: false,
    });
    client.on('error', (err: any) => {
      console.warn('[IMAP] Erro assíncrono no socket IMAP (fetchFolderMessages):', err?.message || err);
    });

    try {
      await client.connect();
      let quotaInfo: QuotaInfo | undefined;
      try {
        const q: any = await client.getQuota('INBOX');
        if (q && q.storage && typeof q.storage.usage === 'number') {
          quotaInfo = {
            usedBytes: q.storage.usage,
            limitBytes: typeof q.storage.limit === 'number' ? q.storage.limit : 0,
          };
        }
      } catch {
        // Servidor não suporta QUOTA
      }

      const mailboxes = await client.list();

      const inboxOnly = Boolean((config as any).inboxOnly);
      const foldersToSync: SupportedFolder[] = inboxOnly
        ? ['inbox']
        : ['inbox', 'sent', 'drafts', 'trash', 'junk', 'archive'];
      const allMessages: any[] = [];
      const flagUpdates: Array<{ id: string; isRead: boolean; isStarred: boolean }> = [];
      const folderStats: Record<string, number> = {};
      const systemPathToFolder = new Map<string, SupportedFolder>();
      const discoveredCustomFolders: DiscoveredCustomFolder[] = [];
      const knownUidsByFolder = config.knownUidsByFolder || {};
      let fallbackUsedBytes = 0;

      for (const folder of foldersToSync) {
        const mailboxPath = this.findServerMailbox(mailboxes, folder) || (folder === 'inbox' ? 'INBOX' : null);
        if (!mailboxPath) {
          folderStats[folder] = 0;
          continue;
        }
        systemPathToFolder.set(mailboxPath.toLowerCase(), folder);

        try {
          const lock = await client.getMailboxLock(mailboxPath);
          let folderMessages: any[] = [];

          try {
            const total = client.mailbox ? client.mailbox.exists : 0;
            if (total > 0) {
              const effectiveLimit = folder === 'inbox' ? Math.max(limitPerFolder, 50) : limitPerFolder;
              const startIdx = Math.max(1, total - effectiveLimit + 1);
              const range = `${startIdx}:${total}`;
              const knownUids = new Set<number>(knownUidsByFolder[folder] || []);
              const res = await this.fetchFolderIncremental(
                client,
                range,
                folder,
                config,
                knownUids,
                flagUpdates
              );
              folderMessages = res.messages;
              fallbackUsedBytes += res.bytesCount;
            }
          } finally {
            lock.release();
          }

          // Ordena rigorosamente as mensagens da pasta por data decrescente (mais recente primeiro)
          folderMessages.sort((a, b) => {
            const timeA = a.dateStr ? new Date(a.dateStr).getTime() : 0;
            const timeB = b.dateStr ? new Date(b.dateStr).getTime() : 0;
            return timeB - timeA;
          });

          folderStats[folder] = folderMessages.length;
          allMessages.push(...folderMessages);
        } catch (folderErr: any) {
          console.warn(`[IMAP] Falha ao sincronizar pasta ${folder} (${mailboxPath}):`, folderErr.message);
          folderStats[folder] = 0;
        }
      }

      // Descobre e sincroniza pastas personalizadas / subpastas no servidor IMAP
      const customMailboxes = mailboxes.filter((m: any) => {
        if (inboxOnly) return false; // sincronização rápida: apenas Caixa de Entrada
        if (!m?.path) return false;
        if (m.flags && (m.flags.has('\\Noselect') || m.flags.has('\\NonExistent'))) {
          return false;
        }
        const lowerPath = m.path.toLowerCase();
        if (lowerPath === 'inbox' || systemPathToFolder.has(lowerPath)) {
          return false;
        }
        return true;
      });

      for (const m of customMailboxes) {
        const delimiter = m.delimiter || (m.path.includes('/') ? '/' : m.path.includes('.') ? '.' : '/');
        const parentPathRaw =
          typeof m.parentPath === 'string' && m.parentPath.length > 0
            ? m.parentPath
            : m.path.includes(delimiter)
            ? m.path.slice(0, m.path.lastIndexOf(delimiter))
            : '';
        const parentSystemFolder = parentPathRaw
          ? systemPathToFolder.get(parentPathRaw.toLowerCase()) ||
            (parentPathRaw.toLowerCase() === 'inbox' ? 'inbox' : undefined)
          : undefined;

        discoveredCustomFolders.push({
          imapPath: m.path,
          name: m.name || m.path.split(delimiter).pop() || m.path,
          parentImapPath: parentPathRaw && !parentSystemFolder ? parentPathRaw : undefined,
          parentSystemFolder,
          delimiter,
        });

        try {
          const lock = await client.getMailboxLock(m.path);
          let customMessages: any[] = [];
          try {
            const total = client.mailbox ? client.mailbox.exists : 0;
            if (total > 0) {
              const effectiveLimit = Math.min(limitPerFolder, 30);
              const startIdx = Math.max(1, total - effectiveLimit + 1);
              const range = `${startIdx}:${total}`;
              const folderKey = `imap:${m.path}`;
              const knownUids = new Set<number>(knownUidsByFolder[folderKey] || []);
              const res = await this.fetchFolderIncremental(
                client,
                range,
                folderKey,
                config,
                knownUids,
                flagUpdates
              );
              customMessages = res.messages;
            }
          } finally {
            lock.release();
          }

          customMessages.sort((a, b) => {
            const timeA = a.dateStr ? new Date(a.dateStr).getTime() : 0;
            const timeB = b.dateStr ? new Date(b.dateStr).getTime() : 0;
            return timeB - timeA;
          });

          folderStats[`imap:${m.path}`] = customMessages.length;
          allMessages.push(...customMessages);
        } catch (customErr: any) {
          console.warn(`[IMAP] Falha ao sincronizar pasta personalizada ${m.path}:`, customErr?.message);
        }
      }

      if (!quotaInfo && fallbackUsedBytes > 0) {
        quotaInfo = {
          usedBytes: fallbackUsedBytes,
          limitBytes: 0,
        };
      }

      await client.logout();

      return {
        success: true,
        emails: allMessages,
        count: allMessages.length,
        folderStats: folderStats,
        customFolders: discoveredCustomFolders,
        quota: quotaInfo,
        flagUpdates: flagUpdates.length > 0 ? flagUpdates : undefined,
      };
    } catch (err: any) {
      return {
        success: false,
        error: `Erro ao sincronizar pastas IMAP: ${err.message}`,
      };
    }
  }

  /**
   * Creates a custom folder (or subfolder) on the IMAP server
   */
  public static async createImapFolder(
    config: MailServerConfig,
    folderName: string,
    parentFolderOrPath?: string
  ): Promise<{ success: boolean; imapPath?: string; error?: string }> {
    if (config.protocol === 'pop3' || !config.host || !config.user || (!config.pass && !config.accessToken)) {
      return { success: false, error: 'Conta IMAP não configurada.' };
    }

    const client = new ImapFlow({
      host: config.host,
      port: config.port || 993,
      secure: config.secure !== false,
      auth: config.accessToken
        ? { user: config.user, accessToken: config.accessToken }
        : { user: config.user, pass: config.pass },
      tls: { rejectUnauthorized: !isTlsHostTrusted(config.host) },
      logger: false,
    });
    client.on('error', () => {});

    try {
      await client.connect();
      const mailboxes = await client.list();
      const inboxBox = mailboxes.find((m: any) => (m.path || '').toUpperCase() === 'INBOX');
      const defaultDelimiter = inboxBox?.delimiter || mailboxes[0]?.delimiter || '/';

      let parentPath = '';
      if (parentFolderOrPath) {
        const systemFolders: SupportedFolder[] = ['inbox', 'sent', 'drafts', 'trash', 'junk', 'archive'];
        if (systemFolders.includes(parentFolderOrPath as SupportedFolder)) {
          parentPath = this.findServerMailbox(mailboxes, parentFolderOrPath as SupportedFolder) || (parentFolderOrPath === 'inbox' ? 'INBOX' : '');
        } else {
          parentPath = parentFolderOrPath.startsWith('imap:') ? parentFolderOrPath.slice(5) : parentFolderOrPath;
        }
      }

      const fullPath = parentPath ? `${parentPath}${defaultDelimiter}${folderName}` : folderName;
      await client.mailboxCreate(fullPath);
      await client.logout();
      return { success: true, imapPath: fullPath };
    } catch (err: any) {
      try { await client.logout(); } catch {}
      return { success: false, error: err?.message || 'Erro ao criar pasta IMAP.' };
    }
  }

  /**
   * Renames a custom folder on the IMAP server
   */
  public static async renameImapFolder(
    config: MailServerConfig,
    oldImapPath: string,
    newName: string
  ): Promise<{ success: boolean; imapPath?: string; error?: string }> {
    if (config.protocol === 'pop3' || !config.host || !config.user || (!config.pass && !config.accessToken)) {
      return { success: false, error: 'Conta IMAP não configurada.' };
    }

    const client = new ImapFlow({
      host: config.host,
      port: config.port || 993,
      secure: config.secure !== false,
      auth: config.accessToken
        ? { user: config.user, accessToken: config.accessToken }
        : { user: config.user, pass: config.pass },
      tls: { rejectUnauthorized: !isTlsHostTrusted(config.host) },
      logger: false,
    });
    client.on('error', () => {});

    try {
      await client.connect();
      const mailboxes = await client.list();
      const match = mailboxes.find((m: any) => m.path === oldImapPath);
      const delimiter = match?.delimiter || (oldImapPath.includes('/') ? '/' : oldImapPath.includes('.') ? '.' : '/');
      const lastDelim = oldImapPath.lastIndexOf(delimiter);
      const newPath = lastDelim >= 0 ? `${oldImapPath.slice(0, lastDelim + 1)}${newName}` : newName;
      await client.mailboxRename(oldImapPath, newPath);
      await client.logout();
      return { success: true, imapPath: newPath };
    } catch (err: any) {
      try { await client.logout(); } catch {}
      return { success: false, error: err?.message || 'Erro ao renomear pasta IMAP.' };
    }
  }

  /**
   * Deletes a custom folder on the IMAP server
   */
  public static async deleteImapFolder(
    config: MailServerConfig,
    imapPath: string
  ): Promise<{ success: boolean; error?: string }> {
    if (config.protocol === 'pop3' || !config.host || !config.user || (!config.pass && !config.accessToken)) {
      return { success: false, error: 'Conta IMAP não configurada.' };
    }

    const client = new ImapFlow({
      host: config.host,
      port: config.port || 993,
      secure: config.secure !== false,
      auth: config.accessToken
        ? { user: config.user, accessToken: config.accessToken }
        : { user: config.user, pass: config.pass },
      tls: { rejectUnauthorized: !isTlsHostTrusted(config.host) },
      logger: false,
    });
    client.on('error', () => {});

    try {
      await client.connect();
      await client.mailboxDelete(imapPath);
      await client.logout();
      return { success: true };
    } catch (err: any) {
      try { await client.logout(); } catch {}
      return { success: false, error: err?.message || 'Erro ao excluir pasta IMAP.' };
    }
  }

  /**
   * Backwards-compatible fetchInbox
   */
  public static async fetchInbox(config: MailServerConfig): Promise<FetchResult> {
    return await this.fetchFolderMessages(config, 'inbox');
  }

  /**
   * Fetch real emails from POP3 server (Local Download Model)
   */
  public static async fetchPop3Inbox(config: MailServerConfig): Promise<FetchResult> {
    if (!config.host || !config.user || !config.pass) {
      return {
        success: false,
        error: 'Credenciais de e-mail POP3 não configuradas.',
      };
    }

    const pop3 = new SimplePop3Client({
      user: config.user,
      pass: config.pass,
      host: config.host,
      port: config.port || 995,
      tls: config.secure !== false,
      rejectUnauthorized: !isTlsHostTrusted(config.host),
      timeout: 15000,
    });

    try {
      await pop3.connect();
      await pop3.login();
      const stat = await pop3.stat();
      const messages: any[] = [];
      const total = stat.count;

      // Download the last 15 messages via POP3 RETR
      const startIdx = Math.max(1, total - 14);
      for (let i = total; i >= startIdx; i--) {
        try {
          const rawMessage = await pop3.retr(i);
          const parsed: any = await simpleParser(rawMessage);

          const senderName = parsed.from?.value?.[0]?.name || parsed.from?.value?.[0]?.address || 'Remetente POP3';
          const senderEmail = parsed.from?.value?.[0]?.address || '';
          const subject = parsed.subject || '(Sem Assunto)';
          const date = parsed.date ? new Date(parsed.date) : new Date();
          const pop3MessageId = `pop3-${i}-${Date.now()}`;

          let popAttachments: any[] = [];
          if (parsed.attachments && Array.isArray(parsed.attachments) && parsed.attachments.length > 0) {
            popAttachments = parsed.attachments.map((att: any, idx: number) =>
              this.saveAttachmentCache(pop3MessageId, att, idx, parsed.html)
            );
          }

          const hasRealPopAttachments = popAttachments.some((a) => !a.isSignature);

          const popReadReceiptRequestedBy = extractReadReceiptAddress(parsed.headers, senderEmail);

          messages.push({
            id: pop3MessageId,
            messageIdHeader: parsed.messageId ? String(parsed.messageId).trim() : undefined,
            inReplyToHeader: parsed.inReplyTo ? String(parsed.inReplyTo).trim() : undefined,
            readReceiptRequestedBy: popReadReceiptRequestedBy,
            sender: senderName,
            senderEmail: senderEmail,
            avatar: '',
            recipient: parsed.to ? (Array.isArray(parsed.to) ? parsed.to.map((t: any) => t?.text).filter(Boolean).join(', ') : parsed.to.text) : config.user,
            subject: subject,
            snippet: parsed.text ? parsed.text.slice(0, 100) : subject,
            body: parsed.text || `[Mensagem baixada via POP3 de ${config.host}]`,
            bodyHtml: parsed.html || undefined,
            attachments: popAttachments.length > 0 ? popAttachments : undefined,
            timestamp: date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            dateStr: date.toISOString(),
            period: 'today',
            folder: 'inbox',
            priority: 'medium',
            isRead: false,
            isStarred: false,
            hasAttachment: hasRealPopAttachments,
            tags: ['POP3 (Local)'],
          });
        } catch (fetchErr) {
          console.warn(`Erro ao baixar mensagem POP3 #${i}:`, fetchErr);
        }
      }

      await pop3.quit();

      // Ordena decrescente por data (mais recente no topo)
      messages.sort((a, b) => {
        const timeA = a.dateStr ? new Date(a.dateStr).getTime() : 0;
        const timeB = b.dateStr ? new Date(b.dateStr).getTime() : 0;
        return timeB - timeA;
      });

      return {
        success: true,
        emails: messages,
        count: messages.length,
      };
    } catch (err: any) {
      pop3.close();
      return {
        success: false,
        error: `Erro de download POP3: ${err.message}`,
      };
    }
  }

  /**
   * Send real email via SMTP with automatic port/TLS negotiation and fallback
   */
  public static async sendSmtp(
    config: MailServerConfig & { incomingHost?: string },
    emailData: any
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const user = (config.user || '').trim();
    const pass = config.pass || '';
    let primaryHost = (config.host || '').trim();
    const incomingHost = (config.incomingHost || '').trim();

    // Se o servidor de entrada for ex: pop.terra.com.br / imap.terra.com.br, deriva smtp.terra.com.br
    const derivedSmtpFromIncoming = incomingHost
      ? incomingHost.replace(/^(pop3?|imap4?)\./i, 'smtp.')
      : '';

    const userDomain = user.includes('@') ? user.split('@')[1].toLowerCase() : '';
    const isDefaultDomainSmtp =
      userDomain &&
      (primaryHost.toLowerCase() === `smtp.${userDomain}` ||
        primaryHost.toLowerCase() === `mail.${userDomain}` ||
        primaryHost.toLowerCase() === 'email-ssl.com.br');

    if (
      derivedSmtpFromIncoming &&
      derivedSmtpFromIncoming.toLowerCase() !== incomingHost.toLowerCase() &&
      (!primaryHost || isDefaultDomainSmtp)
    ) {
      primaryHost = derivedSmtpFromIncoming;
    }

    if (!primaryHost || !user || (!pass && !config.accessToken)) {
      return {
        success: false,
        error: 'Servidor SMTP, usuário ou senha não configurados. Verifique em Configurações do Servidor.',
      };
    }

    const configuredPort = Number(config.port) || 465;
    const altPort = configuredPort === 465 ? 587 : 465;

    const candidates: Array<{ host: string; port: number; secure: boolean }> = [
      {
        host: primaryHost,
        port: configuredPort,
        secure: configuredPort === 465,
      },
      {
        host: primaryHost,
        port: altPort,
        secure: altPort === 465,
      },
    ];

    if (derivedSmtpFromIncoming && derivedSmtpFromIncoming !== primaryHost) {
      candidates.push(
        { host: derivedSmtpFromIncoming, port: 587, secure: false },
        { host: derivedSmtpFromIncoming, port: 465, secure: true }
      );
    }

    let lastError = '';
    const ehloHostname =
      userDomain && userDomain !== 'terra.com.br'
        ? userDomain
        : 'client.anecttamail.local';

    for (const candidate of candidates) {
      try {
        const transporter = nodemailer.createTransport({
          name: ehloHostname,
          host: candidate.host,
          port: candidate.port,
          secure: candidate.secure,
          auth: config.accessToken
            ? ({
                type: 'OAuth2',
                user,
                accessToken: config.accessToken,
              } as any)
            : {
                user,
                pass,
              },
          tls: {
            rejectUnauthorized: !isTlsHostTrusted(candidate.host),
          },
          connectionTimeout: 12000,
          greetingTimeout: 10000,
          socketTimeout: 15000,
        });

        const recipientTokens = String(emailData.recipient || '')
          .split(/[;,]/)
          .map((r) => r.trim())
          .filter(Boolean);

        const invalidRecipient = recipientTokens.find((token) => !extractValidEmail(token));
        if (recipientTokens.length === 0 || invalidRecipient) {
          return {
            success: false,
            error: invalidRecipient
              ? `Destinatário inválido: "${invalidRecipient}". Verifique o endereço de e-mail.`
              : 'Nenhum destinatário válido informado.',
          };
        }

        const normalizedRecipients = recipientTokens.join(', ');

        const safeSenderName = String(emailData.sender || user)
          .replace(/["<>\r\n]/g, '')
          .trim() || user;

        const mailOptions: any = {
          from: `"${safeSenderName}" <${user}>`,
          to: normalizedRecipients,
          subject: emailData.subject,
          text: emailData.body,
        };

        if (emailData.html) {
          mailOptions.html = emailData.html;
        }

        if (emailData.requestReadReceipt || emailData.trackingEnabled) {
          const receiptAddress = `"${safeSenderName}" <${user}>`;
          mailOptions.headers = {
            ...(mailOptions.headers || {}),
            'Disposition-Notification-To': receiptAddress,
            'Return-Receipt-To': receiptAddress,
            'X-Confirm-Reading-To': receiptAddress,
          };
        }

        if (emailData.attachments && Array.isArray(emailData.attachments) && emailData.attachments.length > 0) {
          const validatedAttachments: any[] = [];
          for (const att of emailData.attachments) {
            if (att.path) {
              if (!fs.existsSync(att.path)) {
                return {
                  success: false,
                  error: `O anexo "${att.name || att.path}" não foi encontrado no disco. Verifique se o arquivo foi movido ou excluído.`,
                };
              }
              validatedAttachments.push({
                filename: att.name || path.basename(att.path || 'anexo'),
                path: att.path,
                cid: att.cid || undefined,
              });
            }
          }
          if (validatedAttachments.length > 0) {
            mailOptions.attachments = validatedAttachments;
          }
        }

        const info = await transporter.sendMail(mailOptions);

        return {
          success: true,
          messageId: info.messageId,
        };
      } catch (err: any) {
        lastError = err?.message || String(err);
        console.warn(
          `[SMTP] Tentativa falhou em ${candidate.host}:${candidate.port} (secure=${candidate.secure}):`,
          lastError
        );
        // Se for erro explícito de autenticação (535) no host correto, não precisa tentar outras portas do mesmo host se já tentou
      }
    }

    return {
      success: false,
      error: `Falha SMTP (${primaryHost}): ${lastError}`,
    };
  }
}

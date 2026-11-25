import type { MailAccount, MessageBody, MessageHeader } from '@/types/mail';
import { displayName, formatAddressList, formatFullDate } from './format';
import { htmlToText } from './html';

export type ComposeMode = 'new' | 'reply' | 'replyAll' | 'forward';

export interface ComposeDraft {
  mode: ComposeMode;
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string;
}

export const emptyDraft = (): ComposeDraft => ({ mode: 'new', to: '', cc: '', bcc: '', subject: '', body: '' });

function withPrefix(subject: string, prefix: 'Re' | 'Enc'): string {
  const clean = subject.trim();
  const re = prefix === 'Re' ? /^(re|res|resp)\s*:/i : /^(enc|fw|fwd)\s*:/i;
  return re.test(clean) ? clean : `${prefix}: ${clean || '(sem assunto)'}`;
}

function bodyText(body: MessageBody | null, header: MessageHeader): string {
  if (body?.text?.trim()) return body.text.trim();
  if (body?.html?.trim()) return htmlToText(body.html);
  return header.snippet || '';
}

const quote = (text: string) =>
  text
    .split('\n')
    .map((l) => `> ${l}`)
    .join('\n');

/** Monta resposta, responder a todos ou encaminhar a partir da mensagem aberta. */
export function buildDraft(
  mode: Exclude<ComposeMode, 'new'>,
  header: MessageHeader,
  body: MessageBody | null,
  account: MailAccount
): ComposeDraft {
  const original = bodyText(body, header);
  const when = formatFullDate(header.date);
  const sender = displayName(header.from);

  if (mode === 'forward') {
    const block = [
      '',
      '',
      '---------- Mensagem encaminhada ----------',
      `De: ${formatAddressList([header.from])}`,
      `Data: ${when}`,
      `Assunto: ${header.subject}`,
      `Para: ${formatAddressList(header.to)}`,
      '',
      original,
    ].join('\n');
    return { mode, to: '', cc: '', bcc: '', subject: withPrefix(header.subject, 'Enc'), body: block };
  }

  const me = account.email.toLowerCase();
  const to = header.from.email;
  let cc = '';
  if (mode === 'replyAll') {
    const others = [...header.to, ...header.cc].filter(
      (a) => a.email && a.email.toLowerCase() !== me && a.email.toLowerCase() !== to.toLowerCase()
    );
    cc = formatAddressList(others);
  }
  const references = [header.references, header.messageId].filter(Boolean).join(' ').trim();
  return {
    mode,
    to: formatAddressList([header.from]),
    cc,
    bcc: '',
    subject: withPrefix(header.subject, 'Re'),
    body: `\n\nEm ${when}, ${sender} escreveu:\n${quote(original)}`,
    inReplyTo: header.messageId || undefined,
    references: references || undefined,
  };
}

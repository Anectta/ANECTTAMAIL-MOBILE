import React, { useState } from 'react';
import { Send, X } from 'lucide-react';
import { Spinner } from '@/components/ui';
import { AnecttaMail, errorMessage } from '@/native/anecttaMail';
import type { MailAccount } from '@/types/mail';
import type { ComposeDraft } from '@/utils/compose';
import { isValidRecipient, splitRecipients } from '@/utils/format';
import { escapeHtml } from '@/utils/html';

interface Props {
  account: MailAccount;
  draft: ComposeDraft;
  onClose: () => void;
  onSent: (savedToSent: boolean) => void;
}

const TITLES: Record<ComposeDraft['mode'], string> = {
  new: 'Novo e-mail',
  reply: 'Responder',
  replyAll: 'Responder a todos',
  forward: 'Encaminhar',
};

/** Texto simples → HTML leve (parágrafos e citações), para o e-mail chegar bem formatado. */
function textToHtml(text: string): string {
  return text
    .split('\n')
    .map((line) =>
      line.startsWith('>')
        ? `<div style="border-left:3px solid #cbd5e1;padding-left:8px;color:#475569">${escapeHtml(line.replace(/^>\s?/, '')) || '&nbsp;'}</div>`
        : `<div>${escapeHtml(line) || '<br>'}</div>`
    )
    .join('');
}

export const ComposeScreen: React.FC<Props> = ({ account, draft, onClose, onSent }) => {
  const [to, setTo] = useState(draft.to);
  const [cc, setCc] = useState(draft.cc);
  const [bcc, setBcc] = useState(draft.bcc);
  const [showCc, setShowCc] = useState(Boolean(draft.cc || draft.bcc));
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    const toList = splitRecipients(to);
    const ccList = splitRecipients(cc);
    const bccList = splitRecipients(bcc);
    const all = [...toList, ...ccList, ...bccList];
    if (toList.length === 0) {
      setError('Informe ao menos um destinatário em "Para".');
      return;
    }
    const invalid = all.filter((r) => !isValidRecipient(r));
    if (invalid.length > 0) {
      setError(`Endereço inválido: ${invalid.join(', ')}`);
      return;
    }
    if (!subject.trim() && !window.confirm('Enviar sem assunto?')) return;
    setSending(true);
    setError(null);
    try {
      const res = await AnecttaMail.sendMessage({
        account,
        message: {
          to: toList,
          cc: ccList,
          bcc: bccList,
          subject: subject.trim(),
          text: body,
          html: textToHtml(body),
          inReplyTo: draft.inReplyTo,
          references: draft.references,
        },
      });
      onSent(res.savedToSent);
    } catch (err) {
      setError(errorMessage(err, 'Não foi possível enviar.'));
    } finally {
      setSending(false);
    }
  };

  const discard = () => {
    const changed = to !== draft.to || subject !== draft.subject || body !== draft.body || cc !== draft.cc;
    if (!changed || window.confirm('Descartar esta mensagem?')) onClose();
  };

  const row = 'flex items-center gap-2 px-4 border-b border-border-subtle';
  const input = 'flex-1 bg-transparent py-3 text-[15px] text-text-primary placeholder:text-text-muted focus:outline-none';

  return (
    <div className="fixed inset-0 z-50 bg-bg-app text-text-primary flex flex-col safe-top safe-bottom">
      <header className="flex items-center gap-2 px-2 py-2 bg-bg-sidebar border-b border-border-subtle">
        <button type="button" onClick={discard} className="p-2.5 rounded-xl text-text-secondary" aria-label="Fechar">
          <X className="w-5 h-5" />
        </button>
        <h1 className="flex-1 text-base font-bold">{TITLES[draft.mode]}</h1>
        <button
          type="button"
          onClick={() => void send()}
          disabled={sending}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-accent text-white text-sm font-semibold disabled:opacity-60"
        >
          {sending ? <Spinner className="w-4 h-4" /> : <Send className="w-4 h-4" />}
          <span>{sending ? 'Enviando...' : 'Enviar'}</span>
        </button>
      </header>

      {error && (
        <div className="mx-3 mt-3 px-3.5 py-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-sm text-rose-200">{error}</div>
      )}

      <div className="flex-1 flex flex-col overflow-y-auto">
        <div className={row}>
          <span className="text-sm text-text-muted w-10">De</span>
          <span className="flex-1 py-3 text-sm text-text-secondary truncate">{account.email}</span>
        </div>
        <div className={row}>
          <span className="text-sm text-text-muted w-10">Para</span>
          <input
            type="email"
            inputMode="email"
            autoCapitalize="none"
            multiple
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className={input}
            autoFocus={draft.mode === 'new' || draft.mode === 'forward'}
          />
          {!showCc && (
            <button type="button" onClick={() => setShowCc(true)} className="text-xs text-brand-400 px-2 py-1">
              Cc/Cco
            </button>
          )}
        </div>
        {showCc && (
          <>
            <div className={row}>
              <span className="text-sm text-text-muted w-10">Cc</span>
              <input type="email" inputMode="email" autoCapitalize="none" multiple value={cc} onChange={(e) => setCc(e.target.value)} className={input} />
            </div>
            <div className={row}>
              <span className="text-sm text-text-muted w-10">Cco</span>
              <input type="email" inputMode="email" autoCapitalize="none" multiple value={bcc} onChange={(e) => setBcc(e.target.value)} className={input} />
            </div>
          </>
        )}
        <div className={row}>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Assunto"
            className={`${input} font-semibold`}
          />
        </div>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Escreva sua mensagem..."
          autoFocus={draft.mode === 'reply' || draft.mode === 'replyAll'}
          onFocus={(e) => {
            if (draft.mode === 'reply' || draft.mode === 'replyAll') e.currentTarget.setSelectionRange(0, 0);
          }}
          className="flex-1 min-h-[45vh] w-full px-4 py-3 bg-transparent text-[15px] leading-relaxed text-text-primary placeholder:text-text-muted focus:outline-none resize-none"
        />
      </div>
    </div>
  );
};

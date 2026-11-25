import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Browser } from '@capacitor/browser';
import {
  Archive,
  ArrowLeft,
  Forward,
  ImageOff,
  Mail,
  Paperclip,
  Reply,
  ReplyAll,
  ShieldCheck,
  Star,
  Trash2,
} from 'lucide-react';
import { Avatar, Spinner } from '@/components/ui';
import { AnecttaMail, errorMessage } from '@/native/anecttaMail';
import type { MailAccount, MessageBody, MessageHeader } from '@/types/mail';
import type { ComposeMode } from '@/utils/compose';
import { displayName, formatAddressList, formatFullDate, formatSize, makeSnippet } from '@/utils/format';
import { htmlToText, sanitizeEmailHtml } from '@/utils/html';

interface Props {
  account: MailAccount;
  folderPath: string;
  header: MessageHeader;
  canArchive: boolean;
  onBack: () => void;
  onLoaded: (uid: number, patch: Partial<MessageHeader>) => void;
  onToggleFlag: (h: MessageHeader) => void;
  onMarkUnread: (h: MessageHeader) => void;
  onArchive: (h: MessageHeader) => void;
  onDelete: (h: MessageHeader) => void;
  onCompose: (mode: Exclude<ComposeMode, 'new'>, body: MessageBody | null) => void;
  onMailto: (address: string) => void;
}

/** Estilo base aplicado dentro do quadro do e-mail (fundo claro, como a maioria dos e-mails espera). */
const FRAME_STYLE = `
  <style>
    html, body { margin: 0; padding: 0; background: #ffffff; color: #111827; }
    body { padding: 14px; font: 15px/1.5 -apple-system, Roboto, 'Segoe UI', sans-serif; overflow-wrap: anywhere; }
    img { max-width: 100% !important; height: auto !important; }
    img:not([src]) { display: none; }
    table { max-width: 100% !important; }
    pre { white-space: pre-wrap; }
    a { color: #2563eb; }
  </style>`;

export const ReaderScreen: React.FC<Props> = (p) => {
  const { header } = p;
  const [body, setBody] = useState<MessageBody | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [allowImages, setAllowImages] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [frameHeight, setFrameHeight] = useState(120);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setBody(null);
    setAllowImages(false);
    AnecttaMail.fetchBody({ account: p.account, folder: p.folderPath, uid: header.uid, markSeen: true })
      .then((b) => {
        if (cancelled) return;
        setBody(b);
        const text = b.text?.trim() ? b.text : b.html ? htmlToText(b.html) : '';
        p.onLoaded(header.uid, { seen: true, snippet: makeSnippet(text) || header.snippet });
      })
      .catch((err) => !cancelled && setError(errorMessage(err, 'Não foi possível abrir a mensagem.')))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [header.uid, p.folderPath, p.account.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const safe = useMemo(
    () => (body?.html ? sanitizeEmailHtml(body.html, allowImages) : null),
    [body?.html, allowImages]
  );

  const openLink = (href: string) => {
    if (/^mailto:/i.test(href)) {
      p.onMailto(decodeURIComponent(href.replace(/^mailto:/i, '').split('?')[0]));
      return;
    }
    if (/^https?:/i.test(href)) void Browser.open({ url: href });
  };

  // Ajusta a altura do quadro ao conteúdo e intercepta cliques em links.
  const onFrameLoad = () => {
    const doc = frameRef.current?.contentDocument;
    if (!doc) return;
    const resize = () => setFrameHeight(Math.max(80, doc.documentElement.scrollHeight));
    resize();
    doc.querySelectorAll('img').forEach((img) => img.addEventListener('load', resize));
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(resize).observe(doc.body);
    doc.addEventListener('click', (e) => {
      const a = (e.target as Element | null)?.closest?.('a');
      const href = a?.getAttribute('href');
      if (!href) return;
      e.preventDefault();
      openLink(href);
    });
  };

  const attachments = (body?.attachments || []).filter((a) => !a.inline);
  const recipients = [...header.to, ...header.cc];

  const iconBtn = 'p-2.5 rounded-xl text-text-secondary active:bg-bg-hover';

  return (
    <div className="h-full flex flex-col bg-bg-app text-text-primary safe-top safe-bottom">
      <header className="flex items-center gap-1 px-2 py-2 bg-bg-sidebar border-b border-border-subtle">
        <button type="button" onClick={p.onBack} className={iconBtn} aria-label="Voltar">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1" />
        {p.canArchive && (
          <button type="button" onClick={() => p.onArchive(header)} className={iconBtn} aria-label="Arquivar">
            <Archive className="w-5 h-5 text-teal-400" />
          </button>
        )}
        <button type="button" onClick={() => p.onDelete(header)} className={iconBtn} aria-label="Excluir">
          <Trash2 className="w-5 h-5 text-rose-400" />
        </button>
        <button type="button" onClick={() => p.onMarkUnread(header)} className={iconBtn} aria-label="Marcar como não lida">
          <Mail className="w-5 h-5" />
        </button>
        <button type="button" onClick={() => p.onToggleFlag(header)} className={iconBtn} aria-label="Estrela">
          <Star className={`w-5 h-5 ${header.flagged ? 'text-amber-400 fill-amber-400' : ''}`} />
        </button>
      </header>

      <article className="flex-1 overflow-y-auto">
        <div className="px-4 pt-4 pb-3 space-y-3">
          <h1 className="text-lg font-bold leading-snug">{header.subject || '(sem assunto)'}</h1>
          <div className="flex items-start gap-3">
            <Avatar address={header.from} size={40} />
            <div className="flex-1 min-w-0">
              <p className="text-[15px] font-semibold truncate">{displayName(header.from)}</p>
              <p className="text-xs text-text-muted truncate">{header.from.email}</p>
              {recipients.length > 0 && (
                <p className="text-xs text-text-muted truncate mt-0.5">Para: {formatAddressList(recipients)}</p>
              )}
            </div>
            <span className="text-[11px] text-text-muted shrink-0 text-right">{formatFullDate(header.date)}</span>
          </div>
        </div>

        {safe && (safe.blockedImages > 0 || safe.blockedTrackers > 0) && (
          <div className="mx-4 mb-3 space-y-2">
            {safe.blockedTrackers > 0 && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-xs text-emerald-200">
                <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>
                  <strong>Escudo Anectta:</strong> Proteção Ativa (Rastreamento de leitura bloqueado)
                </span>
              </div>
            )}
            {safe.blockedImages > 0 && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-amber-500/30 bg-amber-500/10 text-xs text-amber-200">
                <ImageOff className="w-4 h-4 text-amber-400 shrink-0" />
                <span className="flex-1">
                  <strong>Escudo Anectta:</strong> Proteção Ativa (Exibição de imagens bloqueada)
                </span>
                <button
                  type="button"
                  onClick={() => setAllowImages(true)}
                  className="px-2.5 py-1.5 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-100 font-semibold shrink-0"
                >
                  Exibir imagens
                </button>
              </div>
            )}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-text-muted">
            <Spinner className="w-5 h-5 text-accent" />
            <span>Abrindo mensagem...</span>
          </div>
        ) : error ? (
          <div className="mx-4 px-3.5 py-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-sm text-rose-200">{error}</div>
        ) : safe ? (
          <div className="mx-3 mb-4 rounded-2xl overflow-hidden bg-white">
            <iframe
              ref={frameRef}
              title="Conteúdo do e-mail"
              sandbox="allow-same-origin"
              srcDoc={safe.html.replace(/<head>/i, `<head>${FRAME_STYLE}`)}
              onLoad={onFrameLoad}
              style={{ width: '100%', height: frameHeight, border: 0, display: 'block' }}
            />
          </div>
        ) : (
          <pre className="mx-4 mb-4 whitespace-pre-wrap break-words font-sans text-[15px] leading-relaxed text-text-primary">
            {body?.text || ''}
          </pre>
        )}

        {attachments.length > 0 && (
          <div className="mx-4 mb-6 space-y-2">
            <p className="text-xs font-bold uppercase tracking-wider text-text-muted">
              {attachments.length === 1 ? '1 anexo' : `${attachments.length} anexos`}
            </p>
            {attachments.map((a) => (
              <div key={a.partId} className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-bg-card border border-border-subtle">
                <Paperclip className="w-4 h-4 text-text-muted shrink-0" />
                <span className="flex-1 truncate text-sm">{a.name}</span>
                <span className="text-xs text-text-muted shrink-0">{formatSize(a.size)}</span>
              </div>
            ))}
            <p className="text-[11px] text-text-muted">Abrir anexos chega na próxima etapa.</p>
          </div>
        )}
      </article>

      <footer className="grid grid-cols-3 gap-2 px-3 py-2.5 bg-bg-sidebar border-t border-border-subtle">
        {(
          [
            ['reply', 'Responder', Reply],
            ['replyAll', 'Resp. todos', ReplyAll],
            ['forward', 'Encaminhar', Forward],
          ] as const
        ).map(([mode, label, Icon]) => (
          <button
            key={mode}
            type="button"
            disabled={loading}
            onClick={() => p.onCompose(mode, body)}
            className="flex flex-col items-center gap-1 py-1.5 rounded-xl text-[11px] text-text-secondary active:bg-bg-hover disabled:opacity-50"
          >
            <Icon className="w-5 h-5" />
            <span>{label}</span>
          </button>
        ))}
      </footer>
    </div>
  );
};

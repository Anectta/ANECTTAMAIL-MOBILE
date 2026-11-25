import React, { useMemo, useState } from 'react';
import { Menu, Paperclip, PenSquare, Plus, RefreshCw, Search, Settings, Star, X } from 'lucide-react';
import logoImg from '@/assets/logo.png';
import { Avatar, FOLDER_VISUAL, Spinner, folderLabel } from '@/components/ui';
import { isDemoMode } from '@/native/anecttaMail';
import type { MailAccount, MailFolderInfo, MessageHeader } from '@/types/mail';
import { displayName, formatListDate } from '@/utils/format';

interface Props {
  accounts: MailAccount[];
  account: MailAccount;
  folders: MailFolderInfo[];
  currentFolder?: MailFolderInfo;
  folderPath: string;
  headers: MessageHeader[];
  hasMore: boolean;
  refreshing: boolean;
  loadingMore: boolean;
  error: string | null;
  onRefresh: () => void;
  onLoadMore: () => void;
  onSelectFolder: (path: string) => void;
  onSelectAccount: (id: string) => void;
  onAddAccount: () => void;
  onOpenSettings: () => void;
  onOpen: (h: MessageHeader) => void;
  onToggleFlag: (h: MessageHeader) => void;
  onCompose: () => void;
}

export const MailboxScreen: React.FC<Props> = (p) => {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');

  const isSentLike = p.currentFolder?.role === 'sent' || p.currentFolder?.role === 'drafts';

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return p.headers;
    return p.headers.filter((h) =>
      [h.subject, h.from.name, h.from.email, h.snippet || '', ...h.to.map((t) => t.email)]
        .join(' ')
        .toLowerCase()
        .includes(q)
    );
  }, [p.headers, query]);

  const title = folderLabel(p.currentFolder || { role: 'inbox', name: 'INBOX', path: 'INBOX' });

  return (
    <div className="h-full flex flex-col bg-bg-app text-text-primary safe-top safe-bottom">
      <header className="px-2 pt-2 pb-2 bg-bg-sidebar border-b border-border-subtle">
        {searchOpen ? (
          <div className="flex items-center gap-1 px-1">
            <Search className="w-4 h-4 text-text-muted ml-2" />
            <input
              autoFocus
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Buscar em ${title}`}
              className="flex-1 bg-transparent px-2 py-2.5 text-[15px] focus:outline-none placeholder:text-text-muted"
            />
            <button
              type="button"
              onClick={() => {
                setSearchOpen(false);
                setQuery('');
              }}
              className="p-2.5 text-text-secondary"
              aria-label="Fechar busca"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setDrawerOpen(true)} className="p-2.5 rounded-xl text-text-secondary" aria-label="Menu">
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex-1 min-w-0 px-1">
              <h1 className="text-base font-bold truncate leading-tight">{title}</h1>
              <p className="text-[11px] text-text-muted truncate">{p.account.email}</p>
            </div>
            <button type="button" onClick={() => setSearchOpen(true)} className="p-2.5 rounded-xl text-text-secondary" aria-label="Buscar">
              <Search className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={p.onRefresh}
              disabled={p.refreshing}
              className="p-2.5 rounded-xl text-text-secondary"
              aria-label="Atualizar"
            >
              <RefreshCw className={`w-5 h-5 ${p.refreshing ? 'animate-spin text-accent' : ''}`} />
            </button>
          </div>
        )}
        {isDemoMode && (
          <p className="mx-2 mt-1 text-[11px] text-amber-300/90">Modo demonstração — no celular a conexão é real.</p>
        )}
      </header>

      {p.error && (
        <button
          type="button"
          onClick={p.onRefresh}
          className="mx-3 mt-3 px-3.5 py-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-left text-xs text-rose-200"
        >
          {p.error} <span className="underline">Tentar de novo</span>
        </button>
      )}

      <main className="flex-1 overflow-y-auto">
        {visible.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center p-8 text-center text-text-muted">
            {p.refreshing ? (
              <>
                <Spinner className="w-7 h-7 text-accent mb-3" />
                <p className="text-sm">Buscando mensagens no servidor...</p>
              </>
            ) : (
              <>
                <img src={logoImg} alt="" className="w-14 h-14 opacity-60 mb-3" />
                <p className="text-base font-bold text-text-primary">{query ? 'Nada encontrado' : 'Tudo pronto por aqui'}</p>
                <p className="text-xs mt-1 max-w-xs">
                  {query ? 'Nenhuma mensagem carregada corresponde à busca.' : 'Nenhuma mensagem nesta pasta.'}
                </p>
              </>
            )}
          </div>
        ) : (
          <ul>
            {visible.map((h) => {
              const person = isSentLike ? h.to[0] || h.from : h.from;
              return (
                <li key={h.uid} className="border-b border-border-subtle">
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => p.onOpen(h)}
                    onKeyDown={(e) => e.key === 'Enter' && p.onOpen(h)}
                    className="flex items-start gap-3 px-4 py-3 active:bg-bg-hover"
                  >
                    <Avatar address={person} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        {!h.seen && <span className="w-2 h-2 rounded-full bg-accent shrink-0" aria-label="Não lida" />}
                        <span className={`flex-1 truncate text-[15px] ${h.seen ? 'text-text-secondary' : 'font-bold'}`}>
                          {isSentLike ? `Para: ${displayName(person)}` : displayName(person)}
                        </span>
                        <span className={`text-[11px] shrink-0 ${h.seen ? 'text-text-muted' : 'text-accent font-semibold'}`}>
                          {formatListDate(h.date)}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <p className={`flex-1 truncate text-[13px] ${h.seen ? 'text-text-secondary' : 'font-semibold'}`}>
                          {h.subject || '(sem assunto)'}
                        </p>
                        {h.hasAttachments && <Paperclip className="w-3.5 h-3.5 text-text-muted shrink-0" />}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            p.onToggleFlag(h);
                          }}
                          className="p-1 -m-1"
                          aria-label={h.flagged ? 'Remover estrela' : 'Marcar com estrela'}
                        >
                          <Star className={`w-4 h-4 ${h.flagged ? 'text-amber-400 fill-amber-400' : 'text-text-muted'}`} />
                        </button>
                      </div>
                      {h.snippet && <p className="truncate text-xs text-text-muted mt-0.5">{h.snippet}</p>}
                    </div>
                  </div>
                </li>
              );
            })}
            {p.hasMore && !query && (
              <li className="p-4 flex justify-center">
                <button
                  type="button"
                  onClick={p.onLoadMore}
                  disabled={p.loadingMore}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-bg-surface border border-border-subtle text-sm text-text-secondary"
                >
                  {p.loadingMore && <Spinner className="w-4 h-4" />}
                  <span>{p.loadingMore ? 'Carregando...' : 'Carregar mais'}</span>
                </button>
              </li>
            )}
          </ul>
        )}
      </main>

      <button
        type="button"
        onClick={p.onCompose}
        aria-label="Escrever e-mail"
        className="fixed right-5 bottom-6 w-14 h-14 rounded-2xl bg-accent text-white shadow-lg shadow-blue-600/30 flex items-center justify-center active:scale-95 transition"
        style={{ marginBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <PenSquare className="w-6 h-6" />
      </button>

      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex">
          <nav className="w-[84%] max-w-xs h-full bg-bg-sidebar border-r border-border-subtle flex flex-col safe-top safe-bottom">
            <div className="flex items-center gap-2.5 px-4 py-4 border-b border-border-subtle">
              <img src={logoImg} alt="" className="w-8 h-8 object-contain" />
              <div>
                <p className="text-sm font-bold leading-none">Anectta MAIL</p>
                <p className="text-[11px] text-text-muted mt-1">Ágil · Seguro · Conectado</p>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto py-2">
              <p className="px-4 pt-2 pb-1 text-[11px] font-bold uppercase tracking-wider text-text-muted">Contas</p>
              {p.accounts.map((acc) => (
                <button
                  key={acc.id}
                  type="button"
                  onClick={() => {
                    p.onSelectAccount(acc.id);
                    setDrawerOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-left ${
                    acc.id === p.account.id ? 'bg-accent/10' : ''
                  }`}
                >
                  <Avatar address={{ name: acc.displayName, email: acc.email }} size={30} />
                  <span className={`flex-1 truncate text-sm ${acc.id === p.account.id ? 'font-bold' : 'text-text-secondary'}`}>
                    {acc.email}
                  </span>
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  setDrawerOpen(false);
                  p.onAddAccount();
                }}
                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-brand-400"
              >
                <Plus className="w-5 h-5 ml-1" />
                <span>Adicionar conta</span>
              </button>

              <p className="px-4 pt-4 pb-1 text-[11px] font-bold uppercase tracking-wider text-text-muted">Pastas</p>
              {(p.folders.length > 0
                ? p.folders
                : [{ path: 'INBOX', name: 'INBOX', role: 'inbox' as const, total: 0, unread: 0 }]
              ).map((f) => {
                const v = FOLDER_VISUAL[f.role] || FOLDER_VISUAL.other;
                const Icon = v.icon;
                const active = f.path === p.folderPath;
                return (
                  <button
                    key={f.path}
                    type="button"
                    onClick={() => {
                      p.onSelectFolder(f.path);
                      setDrawerOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 px-4 py-2.5 text-left ${active ? 'bg-accent/10' : ''}`}
                  >
                    <Icon className={`w-5 h-5 ml-1 ${v.color}`} />
                    <span className={`flex-1 truncate text-sm ${active ? 'font-bold' : 'text-text-secondary'}`}>
                      {folderLabel(f)}
                    </span>
                    {f.unread > 0 && f.role !== 'sent' && f.role !== 'trash' && (
                      <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-accent/20 text-brand-300">
                        {f.unread}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => {
                setDrawerOpen(false);
                p.onOpenSettings();
              }}
              className="flex items-center gap-3 px-5 py-4 border-t border-border-subtle text-sm text-text-secondary"
            >
              <Settings className="w-5 h-5" />
              <span>Configurações da conta</span>
            </button>
          </nav>
          <button type="button" className="flex-1 bg-black/50" aria-label="Fechar menu" onClick={() => setDrawerOpen(false)} />
        </div>
      )}
    </div>
  );
};

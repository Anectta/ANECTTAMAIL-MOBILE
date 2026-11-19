import React, { useEffect, useMemo, useState } from 'react';
import DOMPurify from 'dompurify';
import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import {
  Archive,
  ArrowLeft,
  CheckCircle2,
  Inbox,
  Mail,
  PenSquare,
  Plus,
  QrCode,
  RefreshCw,
  Reply,
  Search,
  Send,
  Settings,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import logoImg from '@/assets/logo.png';
import type { EmailItem, MailFolder } from '@/types/email';
import { mailGatewayClient } from '@/services/mailGatewayClient';
import {
  createEmptyAccount,
  secureStorage,
  type MobileAccountConfig,
} from '@/services/secureStorage';
import { bindAccountToPushRelay, initNativePush } from '@/services/pushNotifications';

type ActiveTab = 'inbox' | 'sent' | 'archive' | 'account';

export const App: React.FC = () => {
  const [accounts, setAccounts] = useState<MobileAccountConfig[]>([]);
  const [activeAccountId, setActiveAccountId] = useState<string>('');
  const [isHydrated, setIsHydrated] = useState(false);

  const [emails, setEmails] = useState<EmailItem[]>([]);
  const [activeTab, setActiveTab] = useState<ActiveTab>('account');
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const [pairingCode, setPairingCode] = useState('');
  const [isComposeOpen, setIsComposeOpen] = useState(false);
  const [composeTo, setComposeTo] = useState('');
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [isSending, setIsSending] = useState(false);

  // Hidrata contas do armazenamento seguro nativo (Capacitor Preferences)
  useEffect(() => {
    void (async () => {
      const savedAccounts = await secureStorage.loadAccounts();
      const savedActiveId = await secureStorage.loadActiveAccountId();
      if (savedAccounts.length > 0) {
        const chosen =
          savedAccounts.find((a) => a.id === savedActiveId) || savedAccounts[0];
        setAccounts(savedAccounts);
        setActiveAccountId(chosen.id);
        const cached = await secureStorage.loadCachedEmails(chosen.id);
        setEmails(cached);
        setActiveTab(chosen.email && chosen.imapHost ? 'inbox' : 'account');
      } else {
        const initial = createEmptyAccount();
        setAccounts([initial]);
        setActiveAccountId(initial.id);
        setActiveTab('account');
      }
      setIsHydrated(true);
    })();
  }, []);

  const activeAccount = useMemo(() => {
    return accounts.find((a) => a.id === activeAccountId) || accounts[0] || createEmptyAccount();
  }, [accounts, activeAccountId]);

  useEffect(() => {
    if (!isHydrated || accounts.length === 0) return;
    void secureStorage.saveAccounts(accounts);
  }, [accounts, isHydrated]);

  useEffect(() => {
    if (!isHydrated || !activeAccountId) return;
    void secureStorage.saveActiveAccountId(activeAccountId);
    void secureStorage.loadCachedEmails(activeAccountId).then(setEmails);
  }, [activeAccountId, isHydrated]);

  useEffect(() => {
    if (!isHydrated || !activeAccount.id) return;
    void secureStorage.saveCachedEmails(activeAccount.id, emails);
  }, [emails, activeAccount.id, isHydrated]);

  // Inicializa Push Nativo (Android/iOS) e listener de Deep Link OAuth 2.0
  useEffect(() => {
    void initNativePush(() => {
      void handleSync();
    });

    if (!Capacitor.isNativePlatform()) return;
    const listener = CapApp.addListener('appUrlOpen', ({ url }) => {
      try {
        if (!url.startsWith('anecttamail://oauth-callback')) return;
        const parsed = new URL(url);
        const provider = parsed.searchParams.get('provider') as 'google' | 'microsoft' | null;
        const accessToken = parsed.searchParams.get('accessToken') || '';
        const refreshToken = parsed.searchParams.get('refreshToken') || undefined;
        const imapHost = parsed.searchParams.get('imapHost') || '';
        const imapPort = Number(parsed.searchParams.get('imapPort') || 993);
        const smtpHost = parsed.searchParams.get('smtpHost') || '';
        const smtpPort = Number(parsed.searchParams.get('smtpPort') || 465);
        if (provider && accessToken) {
          updateActiveAccount({
            authProvider: provider,
            accessToken,
            refreshToken,
            imapHost,
            imapPort,
            smtpHost,
            smtpPort,
          });
          setStatusMessage(`Conta ${provider === 'google' ? 'Google' : 'Microsoft'} conectada via OAuth 2.0!`);
        }
      } catch {
        // ignore invalid deep link
      }
    });

    return () => {
      void listener.then((handle) => handle.remove());
    };
  }, []);

  const updateActiveAccount = (patch: Partial<MobileAccountConfig>) => {
    setAccounts((prev) =>
      prev.map((acc) => (acc.id === activeAccount.id ? { ...acc, ...patch } : acc))
    );
  };

  const handleAddAccount = () => {
    const next = createEmptyAccount(activeAccount.gatewayUrl || 'http://localhost:8787');
    setAccounts((prev) => [...prev, next]);
    setActiveAccountId(next.id);
    setEmails([]);
    setActiveTab('account');
  };

  const handleRemoveActiveAccount = () => {
    if (accounts.length <= 1) return;
    const remaining = accounts.filter((a) => a.id !== activeAccount.id);
    setAccounts(remaining);
    setActiveAccountId(remaining[0].id);
  };

  const selectedEmail = useMemo(
    () => emails.find((e) => e.id === selectedEmailId) || null,
    [emails, selectedEmailId]
  );

  const visibleEmails = useMemo(() => {
    if (activeTab === 'account') return [];
    const folder: MailFolder = activeTab;
    const q = searchQuery.trim().toLowerCase();
    return emails.filter((email) => {
      if (email.folder !== folder) return false;
      if (!q) return true;
      return (
        email.subject.toLowerCase().includes(q) ||
        email.sender.toLowerCase().includes(q) ||
        email.senderEmail.toLowerCase().includes(q) ||
        email.snippet.toLowerCase().includes(q)
      );
    });
  }, [emails, activeTab, searchQuery]);

  const handleSync = async (targetAccount: MobileAccountConfig = activeAccount) => {
    if (!targetAccount.email || !targetAccount.imapHost) {
      setActiveTab('account');
      setStatusMessage('Configure sua conta IMAP/SMTP e o endereço do Gateway primeiro.');
      return;
    }
    setIsSyncing(true);
    setStatusMessage(null);
    try {
      const res = await mailGatewayClient.syncAll(targetAccount, 30);
      if (res.success && Array.isArray(res.emails)) {
        setEmails(res.emails);
        setStatusMessage(`Sincronizado (${res.emails.length} mensagens).`);
        void bindAccountToPushRelay(targetAccount);
      } else {
        setStatusMessage(res.error || 'Não foi possível sincronizar.');
      }
    } catch (err: any) {
      setStatusMessage(err?.message || 'Erro ao conectar no Gateway.');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleTestConnection = async () => {
    setIsSyncing(true);
    setStatusMessage(null);
    try {
      const res = await mailGatewayClient.testConnection(activeAccount);
      setStatusMessage(res.message);
      if (res.success) {
        await handleSync(activeAccount);
        setActiveTab('inbox');
      }
    } catch (err: any) {
      setStatusMessage(err?.message || 'Falha ao conectar no Gateway.');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleClaimPairing = async () => {
    const cleanCode = pairingCode.replace(/\D/g, '');
    if (cleanCode.length !== 6) {
      setStatusMessage('Digite o código de 6 dígitos gerado no Anectta MAIL Desktop.');
      return;
    }
    setIsSyncing(true);
    setStatusMessage(null);
    try {
      const res = await mailGatewayClient.claimPairingCode(activeAccount.gatewayUrl, cleanCode);
      if (res.success && res.accounts && res.accounts.length > 0) {
        const imported = res.accounts[0];
        updateActiveAccount({
          displayName: imported.displayName,
          email: imported.email,
          protocol: imported.protocol,
          imapHost: imported.imapHost,
          imapPort: imported.imapPort,
          imapSecure: imported.imapSecure,
          smtpHost: imported.smtpHost,
          smtpPort: imported.smtpPort,
          smtpSecure: imported.smtpSecure,
        });
        setPairingCode('');
        setStatusMessage(
          `Conta ${imported.email} importada! Informe apenas sua senha para concluir a conexão.`
        );
      } else {
        setStatusMessage(res.error || 'Código inválido ou expirado.');
      }
    } catch (err: any) {
      setStatusMessage(err?.message || 'Erro ao resgatar código de pareamento.');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!composeTo.trim() || !composeSubject.trim()) return;
    setIsSending(true);
    setStatusMessage(null);
    try {
      const res = await mailGatewayClient.sendEmail(activeAccount, {
        to: composeTo.trim(),
        subject: composeSubject.trim(),
        text: composeBody,
      });
      if (res.success) {
        setIsComposeOpen(false);
        setComposeTo('');
        setComposeSubject('');
        setComposeBody('');
        setStatusMessage('E-mail enviado com sucesso!');
      } else {
        setStatusMessage(res.error || 'Erro ao enviar e-mail.');
      }
    } catch (err: any) {
      setStatusMessage(err?.message || 'Erro ao enviar e-mail pelo Gateway.');
    } finally {
      setIsSending(false);
    }
  };

  const toggleStar = (id: string) => {
    setEmails((prev) =>
      prev.map((item) => (item.id === id ? { ...item, isStarred: !item.isStarred } : item))
    );
  };

  const openEmail = (email: EmailItem) => {
    setSelectedEmailId(email.id);
    if (!email.isRead) {
      setEmails((prev) =>
        prev.map((item) => (item.id === email.id ? { ...item, isRead: true } : item))
      );
    }
  };

  if (selectedEmail) {
    const safeHtml = selectedEmail.bodyHtml ? DOMPurify.sanitize(selectedEmail.bodyHtml) : null;
    return (
      <div className="h-full flex flex-col bg-bg-app text-text-primary safe-top safe-bottom">
        <header className="flex items-center justify-between px-4 py-3 border-b border-border-subtle bg-bg-sidebar">
          <button
            type="button"
            onClick={() => setSelectedEmailId(null)}
            className="inline-flex items-center gap-2 text-sm font-medium text-text-secondary active:text-white"
          >
            <ArrowLeft className="w-5 h-5" />
            <span>Voltar</span>
          </button>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => toggleStar(selectedEmail.id)}
              aria-label="Favoritar"
              className="p-2 rounded-xl bg-bg-surface border border-border-subtle"
            >
              <Star
                className={`w-4 h-4 ${
                  selectedEmail.isStarred ? 'text-amber-400 fill-amber-400' : 'text-text-secondary'
                }`}
              />
            </button>
            <button
              type="button"
              onClick={() => {
                setComposeTo(selectedEmail.senderEmail);
                setComposeSubject(
                  selectedEmail.subject.startsWith('Re:')
                    ? selectedEmail.subject
                    : `Re: ${selectedEmail.subject}`
                );
                setComposeBody('');
                setIsComposeOpen(true);
                setSelectedEmailId(null);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-accent text-white text-xs font-semibold"
            >
              <Reply className="w-4 h-4" />
              <span>Responder</span>
            </button>
          </div>
        </header>

        <article className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          <h1 className="text-lg font-bold leading-snug">{selectedEmail.subject || '(Sem assunto)'}</h1>
          <div className="flex items-center justify-between gap-3 pb-3 border-b border-border-subtle">
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate">{selectedEmail.sender}</p>
              <p className="text-xs text-text-secondary truncate">{selectedEmail.senderEmail}</p>
            </div>
            <span className="text-xs text-text-muted shrink-0">{selectedEmail.timestamp}</span>
          </div>

          {safeHtml ? (
            <div
              className="prose prose-invert prose-sm max-w-none break-words"
              dangerouslySetInnerHTML={{ __html: safeHtml }}
            />
          ) : (
            <pre className="whitespace-pre-wrap font-sans text-sm text-text-secondary leading-relaxed">
              {selectedEmail.body}
            </pre>
          )}
        </article>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-bg-app text-text-primary safe-top safe-bottom">
      <header className="px-4 pt-3 pb-3 border-b border-border-subtle bg-bg-sidebar space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            <img src={logoImg} alt="Anectta MAIL" className="w-7 h-7 rounded-lg object-contain shrink-0" />
            <div className="min-w-0">
              <h1 className="text-sm font-bold tracking-tight leading-none">Anectta MAIL</h1>
              <p className="text-[11px] text-text-muted mt-0.5 truncate">
                {activeAccount.email || 'Mobile • Ágil, Seguro, Conectado'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void handleSync()}
            disabled={isSyncing}
            className="p-2.5 rounded-xl bg-bg-surface border border-border-subtle text-text-secondary active:scale-95 transition"
            aria-label="Sincronizar"
          >
            <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin text-accent' : ''}`} />
          </button>
        </div>

        {activeTab !== 'account' && (
          <div className="relative">
            <Search className="w-4 h-4 text-text-muted absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar e-mails..."
              className="w-full pl-9 pr-3 py-2 rounded-xl bg-bg-input border border-border-subtle text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
            />
          </div>
        )}

        {statusMessage && (
          <div className="text-xs px-3 py-2 rounded-xl bg-bg-surface border border-border-subtle text-text-secondary flex items-center justify-between gap-2">
            <span className="truncate">{statusMessage}</span>
            <button type="button" onClick={() => setStatusMessage(null)} aria-label="Fechar aviso">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </header>

      <main className="flex-1 overflow-y-auto">
        {activeTab === 'account' ? (
          <section className="p-4 space-y-4 max-w-md mx-auto">
            {/* Seletor de múltiplas contas */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 overflow-x-auto pb-1">
                {accounts.map((acc, idx) => (
                  <button
                    key={acc.id}
                    type="button"
                    onClick={() => setActiveAccountId(acc.id)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap border transition ${
                      acc.id === activeAccount.id
                        ? 'bg-accent text-white border-accent'
                        : 'bg-bg-surface text-text-secondary border-border-subtle'
                    }`}
                  >
                    {acc.email || `Conta ${idx + 1}`}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={handleAddAccount}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-semibold bg-bg-surface border border-border-subtle text-brand-400"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Nova</span>
                </button>
              </div>
              {accounts.length > 1 && (
                <button
                  type="button"
                  onClick={handleRemoveActiveAccount}
                  aria-label="Remover conta"
                  className="p-1.5 rounded-lg text-rose-400 bg-rose-500/10"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Pareamento rápido com Desktop */}
            <div className="bg-bg-card p-4 rounded-2xl border border-border-subtle space-y-2.5">
              <div className="flex items-center gap-2">
                <QrCode className="w-4 h-4 text-brand-400" />
                <h2 className="text-xs font-bold uppercase tracking-wider text-text-secondary">
                  Parear com Anectta Desktop
                </h2>
              </div>
              <p className="text-xs text-text-muted">
                Digite o código temporário de 6 dígitos para importar servidores IMAP/SMTP sem trafegar senhas.
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={pairingCode}
                  onChange={(e) => setPairingCode(e.target.value)}
                  placeholder="000000"
                  className="flex-1 px-3 py-2 rounded-xl bg-bg-input border border-border-subtle text-sm tracking-widest font-mono"
                />
                <button
                  type="button"
                  onClick={() => void handleClaimPairing()}
                  disabled={isSyncing}
                  className="px-4 py-2 rounded-xl bg-bg-surface border border-border-subtle text-xs font-semibold text-brand-400"
                >
                  Importar
                </button>
              </div>
            </div>

            {/* Login rápido via OAuth 2.0 */}
            <div className="bg-bg-card p-4 rounded-2xl border border-border-subtle space-y-2.5">
              <h2 className="text-xs font-bold uppercase tracking-wider text-text-secondary">
                Conectar sem senha (OAuth 2.0)
              </h2>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const url = mailGatewayClient.getOAuthStartUrl(
                      activeAccount.gatewayUrl,
                      'google'
                    );
                    window.open(url, '_blank');
                  }}
                  className="px-3 py-2 rounded-xl bg-bg-surface border border-border-subtle text-xs font-semibold text-text-primary active:bg-bg-hover"
                >
                  Google / Gmail
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const url = mailGatewayClient.getOAuthStartUrl(
                      activeAccount.gatewayUrl,
                      'microsoft'
                    );
                    window.open(url, '_blank');
                  }}
                  className="px-3 py-2 rounded-xl bg-bg-surface border border-border-subtle text-xs font-semibold text-text-primary active:bg-bg-hover"
                >
                  Microsoft 365
                </button>
              </div>
            </div>

            {/* Formulário de Conta */}
            <div className="space-y-3 bg-bg-card p-4 rounded-2xl border border-border-subtle">
              <h2 className="text-sm font-bold">Configuração Manual</h2>

              <label className="block space-y-1">
                <span className="text-xs font-medium text-text-secondary">URL do Gateway</span>
                <input
                  type="url"
                  value={activeAccount.gatewayUrl}
                  onChange={(e) => updateActiveAccount({ gatewayUrl: e.target.value })}
                  placeholder="https://gateway.suaempresa.com.br"
                  className="w-full px-3 py-2 rounded-xl bg-bg-input border border-border-subtle text-sm"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-xs font-medium text-text-secondary">Nome de exibição</span>
                <input
                  type="text"
                  value={activeAccount.displayName}
                  onChange={(e) => updateActiveAccount({ displayName: e.target.value })}
                  placeholder="Seu Nome"
                  className="w-full px-3 py-2 rounded-xl bg-bg-input border border-border-subtle text-sm"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-xs font-medium text-text-secondary">E-mail</span>
                <input
                  type="email"
                  value={activeAccount.email}
                  onChange={(e) => updateActiveAccount({ email: e.target.value })}
                  placeholder="voce@empresa.com.br"
                  className="w-full px-3 py-2 rounded-xl bg-bg-input border border-border-subtle text-sm"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-xs font-medium text-text-secondary">Senha / Senha de App</span>
                <input
                  type="password"
                  value={activeAccount.password}
                  onChange={(e) => updateActiveAccount({ password: e.target.value })}
                  placeholder="••••••••"
                  className="w-full px-3 py-2 rounded-xl bg-bg-input border border-border-subtle text-sm"
                />
              </label>

              <div className="grid grid-cols-3 gap-2">
                <label className="col-span-2 block space-y-1">
                  <span className="text-xs font-medium text-text-secondary">Servidor IMAP</span>
                  <input
                    type="text"
                    value={activeAccount.imapHost}
                    onChange={(e) => updateActiveAccount({ imapHost: e.target.value })}
                    placeholder="imap.empresa.com.br"
                    className="w-full px-3 py-2 rounded-xl bg-bg-input border border-border-subtle text-sm"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-text-secondary">Porta</span>
                  <input
                    type="number"
                    value={activeAccount.imapPort}
                    onChange={(e) => updateActiveAccount({ imapPort: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded-xl bg-bg-input border border-border-subtle text-sm"
                  />
                </label>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <label className="col-span-2 block space-y-1">
                  <span className="text-xs font-medium text-text-secondary">Servidor SMTP</span>
                  <input
                    type="text"
                    value={activeAccount.smtpHost}
                    onChange={(e) => updateActiveAccount({ smtpHost: e.target.value })}
                    placeholder="smtp.empresa.com.br"
                    className="w-full px-3 py-2 rounded-xl bg-bg-input border border-border-subtle text-sm"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-text-secondary">Porta</span>
                  <input
                    type="number"
                    value={activeAccount.smtpPort}
                    onChange={(e) => updateActiveAccount({ smtpPort: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded-xl bg-bg-input border border-border-subtle text-sm"
                  />
                </label>
              </div>

              <button
                type="button"
                onClick={() => void handleTestConnection()}
                disabled={isSyncing}
                className="w-full mt-2 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-accent hover:bg-accent-hover text-white text-sm font-semibold transition"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>{isSyncing ? 'Conectando...' : 'Testar e Sincronizar'}</span>
              </button>
            </div>
          </section>
        ) : visibleEmails.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center p-8 text-center">
            <Mail className="w-12 h-12 text-text-muted mb-3 opacity-60" />
            <h2 className="text-base font-bold text-text-primary">Tudo pronto por aqui</h2>
            <p className="text-xs text-text-muted max-w-xs mt-1 mb-5">
              Nenhuma mensagem nesta pasta ainda. Toque em sincronizar ou escreva um novo e-mail.
            </p>
            <button
              type="button"
              onClick={() => setIsComposeOpen(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-accent text-white text-xs font-semibold"
            >
              <PenSquare className="w-4 h-4" />
              <span>Escrever novo e-mail</span>
            </button>
          </div>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {visibleEmails.map((email) => (
              <li key={email.id}>
                <button
                  type="button"
                  onClick={() => openEmail(email)}
                  className="w-full text-left px-4 py-3.5 flex items-start gap-3 active:bg-bg-hover transition"
                >
                  <div className="w-9 h-9 rounded-full bg-accent/20 text-brand-400 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                    {(email.sender || email.senderEmail || '?').charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`text-sm truncate ${
                          email.isRead ? 'font-medium text-text-secondary' : 'font-bold text-text-primary'
                        }`}
                      >
                        {email.sender || email.senderEmail}
                      </span>
                      <span className="text-[11px] text-text-muted shrink-0">{email.timestamp}</span>
                    </div>
                    <p
                      className={`text-xs truncate mt-0.5 ${
                        email.isRead ? 'text-text-secondary' : 'font-semibold text-text-primary'
                      }`}
                    >
                      {email.subject || '(Sem assunto)'}
                    </p>
                    <p className="text-xs text-text-muted truncate mt-0.5">{email.snippet}</p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>

      {activeTab !== 'account' && (
        <button
          type="button"
          onClick={() => setIsComposeOpen(true)}
          aria-label="Escrever novo e-mail"
          className="fixed right-4 bottom-20 w-14 h-14 rounded-2xl bg-accent hover:bg-accent-hover text-white shadow-lg shadow-blue-600/30 flex items-center justify-center active:scale-95 transition"
        >
          <PenSquare className="w-5 h-5" />
        </button>
      )}

      <nav className="border-t border-border-subtle bg-bg-sidebar px-2 py-1.5 grid grid-cols-4">
        {[
          { id: 'inbox' as const, label: 'Entrada', icon: Inbox },
          { id: 'sent' as const, label: 'Enviados', icon: Send },
          { id: 'archive' as const, label: 'Arquivo', icon: Archive },
          { id: 'account' as const, label: 'Conta', icon: Settings },
        ].map(({ id, label, icon: Icon }) => {
          const isActive = activeTab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              className={`flex flex-col items-center justify-center py-1.5 rounded-xl text-[11px] font-medium transition ${
                isActive ? 'text-brand-400 bg-accent/10' : 'text-text-muted'
              }`}
            >
              <Icon className="w-5 h-5 mb-0.5" />
              <span>{label}</span>
            </button>
          );
        })}
      </nav>

      {isComposeOpen && (
        <div className="fixed inset-0 z-50 bg-bg-app flex flex-col safe-top safe-bottom">
          <form onSubmit={handleSend} className="h-full flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle bg-bg-sidebar">
              <button
                type="button"
                onClick={() => setIsComposeOpen(false)}
                className="text-sm text-text-secondary"
              >
                Cancelar
              </button>
              <span className="text-sm font-bold">Novo e-mail</span>
              <button
                type="submit"
                disabled={isSending}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-accent text-white text-xs font-semibold"
              >
                <Send className="w-3.5 h-3.5" />
                <span>{isSending ? 'Enviando...' : 'Enviar'}</span>
              </button>
            </div>

            <div className="p-4 space-y-3 flex-1 flex flex-col">
              <input
                type="email"
                required
                value={composeTo}
                onChange={(e) => setComposeTo(e.target.value)}
                placeholder="Para"
                className="w-full px-3 py-2.5 rounded-xl bg-bg-input border border-border-subtle text-sm"
              />
              <input
                type="text"
                required
                value={composeSubject}
                onChange={(e) => setComposeSubject(e.target.value)}
                placeholder="Assunto"
                className="w-full px-3 py-2.5 rounded-xl bg-bg-input border border-border-subtle text-sm"
              />
              <textarea
                value={composeBody}
                onChange={(e) => setComposeBody(e.target.value)}
                placeholder="Escreva sua mensagem..."
                className="w-full flex-1 px-3 py-2.5 rounded-xl bg-bg-input border border-border-subtle text-sm resize-none"
              />
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

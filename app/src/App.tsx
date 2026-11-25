import React, { useCallback, useEffect, useRef, useState } from 'react';
import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { Toast, Spinner } from '@/components/ui';
import { useMailbox } from '@/hooks/useMailbox';
import { accountStore } from '@/services/accountStore';
import type { MailAccount, MessageBody, MessageHeader } from '@/types/mail';
import { buildDraft, emptyDraft, type ComposeDraft, type ComposeMode } from '@/utils/compose';
import { AccountSettingsScreen } from '@/screens/AccountSettingsScreen';
import { ComposeScreen } from '@/screens/ComposeScreen';
import { MailboxScreen } from '@/screens/MailboxScreen';
import { ReaderScreen } from '@/screens/ReaderScreen';
import { SetupScreen } from '@/screens/SetupScreen';

type Screen =
  | { name: 'loading' }
  | { name: 'setup'; editing?: MailAccount }
  | { name: 'mailbox' }
  | { name: 'settings' };

/**
 * Anectta MAIL Mobile — cliente de e-mail com conexão direta IMAP/SMTP (sem servidor
 * intermediário), no mesmo modelo de clientes como Thunderbird e BlueMail.
 */
export const App: React.FC = () => {
  const [accounts, setAccounts] = useState<MailAccount[]>([]);
  const [activeId, setActiveId] = useState<string>('');
  const [screen, setScreen] = useState<Screen>({ name: 'loading' });
  const [reading, setReading] = useState<MessageHeader | null>(null);
  const [draft, setDraft] = useState<ComposeDraft | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const notify = useCallback((msg: string) => setToast(msg), []);
  const account = accounts.find((a) => a.id === activeId) || null;
  const mailbox = useMailbox(screen.name === 'loading' ? null : account, notify);

  // Carrega as contas (migrando as da versão anterior, que guardava a senha sem criptografia).
  useEffect(() => {
    void (async () => {
      let list = await accountStore.loadAccounts();
      if (list.length === 0) {
        list = await accountStore.migrateLegacy();
        if (list.length > 0) await accountStore.saveAccounts(list);
      }
      const savedActive = await accountStore.loadActiveId();
      setAccounts(list);
      if (list.length > 0) {
        setActiveId(list.find((a) => a.id === savedActive)?.id || list[0].id);
        setScreen({ name: 'mailbox' });
      } else {
        setScreen({ name: 'setup' });
      }
    })();
  }, []);

  const selectAccount = useCallback((id: string) => {
    setActiveId(id);
    setReading(null);
    void accountStore.saveActiveId(id);
  }, []);

  const handleSaved = useCallback(
    async (saved: MailAccount) => {
      const exists = accounts.some((a) => a.id === saved.id);
      const next = exists ? accounts.map((a) => (a.id === saved.id ? saved : a)) : [...accounts, saved];
      setAccounts(next);
      await accountStore.saveAccounts(next);
      selectAccount(saved.id);
      setScreen({ name: 'mailbox' });
      notify(exists ? 'Conta atualizada.' : 'Conta conectada!');
      if (exists) void mailbox.refresh();
    },
    [accounts, mailbox, notify, selectAccount]
  );

  const removeAccount = useCallback(async () => {
    if (!account) return;
    await accountStore.removeAccountData(account.id);
    const next = accounts.filter((a) => a.id !== account.id);
    setAccounts(next);
    await accountStore.saveAccounts(next);
    notify('Conta removida deste aparelho.');
    if (next.length > 0) {
      selectAccount(next[0].id);
      setScreen({ name: 'mailbox' });
    } else {
      setActiveId('');
      setScreen({ name: 'setup' });
    }
  }, [account, accounts, notify, selectAccount]);

  const openCompose = useCallback(
    (mode: Exclude<ComposeMode, 'new'>, body: MessageBody | null) => {
      if (!reading || !account) return;
      setDraft(buildDraft(mode, reading, body, account));
    },
    [account, reading]
  );

  // Botão Voltar do Android: fecha o que estiver aberto, na ordem certa.
  const stateRef = useRef({ draft, reading, screen });
  stateRef.current = { draft, reading, screen };
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const handle = CapApp.addListener('backButton', () => {
      const s = stateRef.current;
      if (s.draft) setDraft(null);
      else if (s.reading) setReading(null);
      else if (s.screen.name === 'settings' || (s.screen.name === 'setup' && accounts.length > 0)) setScreen({ name: 'mailbox' });
      else void CapApp.minimizeApp();
    });
    return () => {
      void handle.then((h) => h.remove());
    };
  }, [accounts.length]);

  const currentReading = reading ? mailbox.headers.find((h) => h.uid === reading.uid) || reading : null;

  let content: React.ReactNode;
  if (screen.name === 'loading') {
    content = (
      <div className="h-full flex items-center justify-center bg-bg-app text-accent">
        <Spinner className="w-8 h-8" />
      </div>
    );
  } else if (screen.name === 'setup' || !account) {
    content = (
      <SetupScreen
        key={screen.name === 'setup' ? screen.editing?.id || 'new' : 'new'}
        existing={screen.name === 'setup' ? screen.editing : undefined}
        canCancel={accounts.length > 0}
        onCancel={() =>
          setScreen(screen.name === 'setup' && screen.editing ? { name: 'settings' } : { name: 'mailbox' })
        }
        onSaved={(a) => void handleSaved(a)}
      />
    );
  } else if (screen.name === 'settings') {
    content = (
      <AccountSettingsScreen
        account={account}
        onBack={() => setScreen({ name: 'mailbox' })}
        onEdit={() => setScreen({ name: 'setup', editing: account })}
        onRemove={() => void removeAccount()}
      />
    );
  } else if (currentReading) {
    content = (
      <ReaderScreen
        account={account}
        folderPath={mailbox.folderPath}
        header={currentReading}
        canArchive={Boolean(mailbox.folderByRole('archive')) && mailbox.currentFolder?.role !== 'archive'}
        onBack={() => setReading(null)}
        onLoaded={mailbox.patchHeader}
        onToggleFlag={(h) => void mailbox.toggleFlag(h)}
        onMarkUnread={(h) => {
          void mailbox.setSeen(h, false);
          setReading(null);
        }}
        onArchive={(h) => {
          setReading(null);
          void mailbox.archive(h);
        }}
        onDelete={(h) => {
          setReading(null);
          void mailbox.remove(h);
        }}
        onCompose={openCompose}
        onMailto={(address) => setDraft({ ...emptyDraft(), to: address })}
      />
    );
  } else {
    content = (
      <MailboxScreen
        accounts={accounts}
        account={account}
        folders={mailbox.folders}
        currentFolder={mailbox.currentFolder}
        folderPath={mailbox.folderPath}
        headers={mailbox.headers}
        hasMore={mailbox.hasMore}
        refreshing={mailbox.refreshing}
        loadingMore={mailbox.loadingMore}
        error={mailbox.error}
        onRefresh={() => void mailbox.refresh()}
        onLoadMore={() => void mailbox.loadMore()}
        onSelectFolder={(path) => void mailbox.selectFolder(path)}
        onSelectAccount={selectAccount}
        onAddAccount={() => setScreen({ name: 'setup' })}
        onOpenSettings={() => setScreen({ name: 'settings' })}
        onOpen={setReading}
        onToggleFlag={(h) => void mailbox.toggleFlag(h)}
        onCompose={() => setDraft(emptyDraft())}
      />
    );
  }

  return (
    <>
      {content}
      {draft && account && (
        <ComposeScreen
          account={account}
          draft={draft}
          onClose={() => setDraft(null)}
          onSent={(savedToSent) => {
            setDraft(null);
            notify(savedToSent ? 'E-mail enviado.' : 'E-mail enviado (o servidor guarda a cópia em Enviados).');
            if (mailbox.currentFolder?.role === 'sent') void mailbox.refresh();
          }}
        />
      )}
      <Toast message={toast} onClose={() => setToast(null)} />
    </>
  );
};

import React from 'react';
import { ArrowLeft, KeyRound, ShieldCheck, Trash2 } from 'lucide-react';
import { Avatar } from '@/components/ui';
import type { MailAccount } from '@/types/mail';

interface Props {
  account: MailAccount;
  onBack: () => void;
  onEdit: () => void;
  onRemove: () => void;
}

const securityLabel = (s: MailAccount['imapSecurity']) => (s === 'ssl' ? 'SSL/TLS' : s === 'starttls' ? 'STARTTLS' : 'sem criptografia');

export const AccountSettingsScreen: React.FC<Props> = ({ account, onBack, onEdit, onRemove }) => (
  <div className="h-full flex flex-col bg-bg-app text-text-primary safe-top safe-bottom">
    <header className="flex items-center gap-2 px-2 py-2 bg-bg-sidebar border-b border-border-subtle">
      <button type="button" onClick={onBack} className="p-2.5 rounded-xl text-text-secondary" aria-label="Voltar">
        <ArrowLeft className="w-5 h-5" />
      </button>
      <h1 className="text-base font-bold">Configurações da conta</h1>
    </header>

    <main className="flex-1 overflow-y-auto p-4 space-y-4 max-w-md w-full mx-auto">
      <div className="flex items-center gap-3 p-4 rounded-2xl bg-bg-card border border-border-subtle">
        <Avatar address={{ name: account.displayName, email: account.email }} size={44} />
        <div className="min-w-0">
          <p className="font-bold truncate">{account.displayName || account.email}</p>
          <p className="text-xs text-text-muted truncate">{account.email}</p>
        </div>
      </div>

      <div className="p-4 rounded-2xl bg-bg-card border border-border-subtle text-sm space-y-2">
        <p className="text-xs font-bold uppercase tracking-wider text-text-muted">Servidores</p>
        <p>
          <span className="text-text-muted">Recebimento (IMAP): </span>
          {account.imapHost}:{account.imapPort} · {securityLabel(account.imapSecurity)}
        </p>
        <p>
          <span className="text-text-muted">Envio (SMTP): </span>
          {account.smtpHost}:{account.smtpPort} · {securityLabel(account.smtpSecurity)}
        </p>
        <p className="flex items-start gap-2 pt-2 text-xs text-text-muted">
          <ShieldCheck className="w-4 h-4 shrink-0 text-emerald-400" />
          <span>Conexão direta com o seu provedor. A senha fica cifrada no cofre do aparelho.</span>
        </p>
      </div>

      <button
        type="button"
        onClick={onEdit}
        className="w-full flex items-center gap-3 p-4 rounded-2xl bg-bg-card border border-border-subtle text-sm text-left"
      >
        <KeyRound className="w-5 h-5 text-brand-400" />
        <span className="flex-1">Atualizar senha ou servidores</span>
      </button>

      <button
        type="button"
        onClick={() => {
          if (window.confirm(`Remover a conta ${account.email} deste aparelho? Os e-mails continuam no servidor.`)) onRemove();
        }}
        className="w-full flex items-center gap-3 p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-sm text-rose-200 text-left"
      >
        <Trash2 className="w-5 h-5 text-rose-400" />
        <span className="flex-1">Remover conta deste aparelho</span>
      </button>
    </main>
  </div>
);

import React, { useMemo, useState } from 'react';
import { ArrowLeft, ChevronDown, ChevronUp, Eye, EyeOff, Lock, ShieldCheck } from 'lucide-react';
import logoImg from '@/assets/logo.png';
import { AnecttaMail, errorMessage, isDemoMode } from '@/native/anecttaMail';
import { newAccountId } from '@/services/accountStore';
import { applyPreset, suggestServers } from '@/services/providers';
import type { MailAccount, Security } from '@/types/mail';
import { Spinner } from '@/components/ui';

interface Props {
  /** Conta existente (para trocar a senha ou ajustar servidores). */
  existing?: MailAccount;
  canCancel: boolean;
  onCancel: () => void;
  onSaved: (account: MailAccount) => void;
}

const SECURITY_OPTIONS: Array<{ value: Security; label: string }> = [
  { value: 'ssl', label: 'SSL/TLS' },
  { value: 'starttls', label: 'STARTTLS' },
  { value: 'none', label: 'Nenhuma' },
];

const field =
  'w-full px-3.5 py-3 rounded-xl bg-bg-input border border-border-subtle text-[15px] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent';

/**
 * Adicionar conta: e-mail + senha. Provedores conhecidos são configurados sozinhos; para
 * domínios próprios, os servidores sugeridos podem ser ajustados em "Configuração avançada".
 */
export const SetupScreen: React.FC<Props> = ({ existing, canCancel, onCancel, onSaved }) => {
  const [email, setEmail] = useState(existing?.email || '');
  const [displayName, setDisplayName] = useState(existing?.displayName || '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [manual, setManual] = useState<MailAccount | null>(existing || null);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const suggestion = useMemo(() => suggestServers(email), [email]);

  // Servidores efetivos: os ajustados à mão, ou a sugestão do provedor.
  const servers: MailAccount = useMemo(() => {
    const base: MailAccount = manual || {
      id: existing?.id || newAccountId(),
      email,
      displayName,
      imapHost: '',
      imapPort: 993,
      imapSecurity: 'ssl',
      smtpHost: '',
      smtpPort: 465,
      smtpSecurity: 'ssl',
    };
    const withPreset = manual ? base : applyPreset(base, suggestion.preset);
    return { ...withPreset, email: email.trim(), displayName: displayName.trim() };
  }, [manual, existing?.id, email, displayName, suggestion]);

  const editServers = (patch: Partial<MailAccount>) => setManual({ ...servers, ...patch });

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const canSubmit = emailOk && password.length > 0 && servers.imapHost.trim() && servers.smtpHost.trim() && !testing;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setTesting(true);
    setError(null);
    try {
      await AnecttaMail.testConnection({ account: { ...servers, password } });
      await AnecttaMail.saveAccountPassword({ accountId: servers.id, password });
      onSaved(servers);
    } catch (err) {
      setError(errorMessage(err, 'Não foi possível conectar. Confira os dados.'));
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="h-full flex flex-col bg-bg-app text-text-primary safe-top safe-bottom">
      <header className="flex items-center gap-2 px-2 py-2">
        {canCancel ? (
          <button type="button" onClick={onCancel} className="p-2.5 rounded-xl text-text-secondary" aria-label="Voltar">
            <ArrowLeft className="w-5 h-5" />
          </button>
        ) : (
          <span className="w-10" />
        )}
      </header>

      <form onSubmit={submit} className="flex-1 overflow-y-auto px-5 pb-8 max-w-md w-full mx-auto">
        <div className="flex flex-col items-center text-center mb-6">
          <img src={logoImg} alt="" className="w-16 h-16 object-contain mb-3" />
          <h1 className="text-xl font-bold">{existing ? 'Atualizar conta' : 'Adicionar conta de e-mail'}</h1>
          <p className="text-sm text-text-secondary mt-1">
            O Anectta MAIL conecta direto no seu servidor. Sua senha fica protegida no cofre do aparelho.
          </p>
        </div>

        {isDemoMode && (
          <div className="mb-4 px-3.5 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200">
            Modo demonstração (navegador): use qualquer e-mail e senha. No celular, a conexão é real.
          </div>
        )}

        <div className="space-y-3">
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (!existing) setManual(null);
            }}
            placeholder="seu@email.com.br"
            className={field}
            disabled={Boolean(existing)}
          />
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={existing ? 'Senha (digite novamente)' : 'Senha'}
              className={`${field} pr-12`}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-text-muted"
              aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
            >
              {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
            </button>
          </div>
          <input
            type="text"
            autoComplete="name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Seu nome (aparece para quem recebe)"
            className={field}
          />
        </div>

        {emailOk && (
          <div className="mt-3 px-3.5 py-2.5 rounded-xl bg-bg-card border border-border-subtle text-xs text-text-secondary space-y-1">
            <p>
              <span className="text-text-primary font-semibold">{servers.providerName || 'Servidor personalizado'}</span>
              {' · '}
              {servers.imapHost || '—'}
            </p>
            {servers.needsAppPassword && (
              <p className="text-amber-300">
                Se a conta usa verificação em duas etapas, crie uma "senha de app" no provedor e use-a aqui.
              </p>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={() => setAdvancedOpen((v) => !v)}
          className="mt-4 w-full flex items-center justify-between px-1 py-2 text-sm text-text-secondary"
        >
          <span>Configuração avançada</span>
          {advancedOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>

        {advancedOpen && (
          <div className="space-y-4 mt-1 p-4 rounded-2xl bg-bg-card border border-border-subtle">
            <label className="block space-y-1">
              <span className="text-xs text-text-secondary">Usuário de login (se diferente do e-mail)</span>
              <input
                type="text"
                autoCapitalize="none"
                value={servers.username || ''}
                onChange={(e) => editServers({ username: e.target.value })}
                placeholder={email || 'usuario'}
                className={field}
              />
            </label>
            {(['imap', 'smtp'] as const).map((kind) => (
              <div key={kind} className="space-y-2">
                <p className="text-xs font-bold uppercase tracking-wider text-text-muted">
                  {kind === 'imap' ? 'Recebimento (IMAP)' : 'Envio (SMTP)'}
                </p>
                <input
                  type="text"
                  autoCapitalize="none"
                  value={kind === 'imap' ? servers.imapHost : servers.smtpHost}
                  onChange={(e) => editServers(kind === 'imap' ? { imapHost: e.target.value } : { smtpHost: e.target.value })}
                  placeholder={kind === 'imap' ? 'imap.seudominio.com.br' : 'smtp.seudominio.com.br'}
                  className={field}
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="number"
                    inputMode="numeric"
                    value={kind === 'imap' ? servers.imapPort : servers.smtpPort}
                    onChange={(e) =>
                      editServers(kind === 'imap' ? { imapPort: Number(e.target.value) } : { smtpPort: Number(e.target.value) })
                    }
                    className={field}
                    aria-label="Porta"
                  />
                  <select
                    value={kind === 'imap' ? servers.imapSecurity : servers.smtpSecurity}
                    onChange={(e) =>
                      editServers(
                        kind === 'imap'
                          ? { imapSecurity: e.target.value as Security }
                          : { smtpSecurity: e.target.value as Security }
                      )
                    }
                    className={field}
                    aria-label="Segurança"
                  >
                    {SECURITY_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="mt-4 px-3.5 py-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-sm text-rose-200">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={!canSubmit}
          className="mt-6 w-full inline-flex items-center justify-center gap-2 px-4 py-3.5 rounded-xl bg-accent text-white text-[15px] font-semibold disabled:opacity-50"
        >
          {testing ? <Spinner className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
          <span>{testing ? 'Conectando ao servidor...' : existing ? 'Salvar e conectar' : 'Conectar'}</span>
        </button>

        <p className="mt-4 flex items-start gap-2 text-xs text-text-muted">
          <ShieldCheck className="w-4 h-4 shrink-0 text-emerald-400" />
          <span>
            Sem servidor intermediário: seus e-mails vão direto entre este aparelho e o seu provedor.
          </span>
        </p>
      </form>
    </div>
  );
};

import React from 'react';
import {
  AlertOctagon,
  Archive,
  FileText,
  Folder,
  Inbox,
  SendHorizontal,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import type { FolderRole, MailAddress, MailFolderInfo } from '@/types/mail';
import { avatarColor, initials } from '@/utils/format';

/** Ícone, cor e nome de cada tipo de pasta (mesmo padrão de cores do Anectta MAIL Desktop). */
export const FOLDER_VISUAL: Record<FolderRole, { icon: LucideIcon; color: string; label: string }> = {
  inbox: { icon: Inbox, color: 'text-sky-400', label: 'Caixa de Entrada' },
  sent: { icon: SendHorizontal, color: 'text-indigo-400', label: 'Itens Enviados' },
  drafts: { icon: FileText, color: 'text-violet-400', label: 'Rascunhos' },
  archive: { icon: Archive, color: 'text-teal-400', label: 'Arquivados' },
  junk: { icon: AlertOctagon, color: 'text-orange-400', label: 'Lixo eletrônico' },
  trash: { icon: Trash2, color: 'text-rose-400', label: 'Itens Excluídos' },
  other: { icon: Folder, color: 'text-brand-400', label: '' },
};

export function folderLabel(f: Pick<MailFolderInfo, 'role' | 'name' | 'path'> | undefined): string {
  if (!f) return 'Caixa de Entrada';
  return FOLDER_VISUAL[f.role]?.label || f.name || f.path;
}

export const Avatar: React.FC<{ address: MailAddress; size?: number }> = ({ address, size = 40 }) => (
  <div
    className="rounded-full flex items-center justify-center text-white font-bold shrink-0"
    style={{
      width: size,
      height: size,
      fontSize: Math.round(size * 0.36),
      backgroundColor: avatarColor(address.email || address.name || '?'),
    }}
    aria-hidden
  >
    {initials(address)}
  </div>
);

export const Toast: React.FC<{ message: string | null; onClose: () => void }> = ({ message, onClose }) => {
  React.useEffect(() => {
    if (!message) return;
    const t = setTimeout(onClose, 3500);
    return () => clearTimeout(t);
  }, [message, onClose]);
  if (!message) return null;
  return (
    <div className="fixed left-4 right-4 bottom-24 z-[60] flex justify-center pointer-events-none">
      <div
        role="status"
        className="pointer-events-auto max-w-md px-4 py-3 rounded-2xl bg-slate-800 text-white text-sm shadow-xl border border-white/10"
        onClick={onClose}
      >
        {message}
      </div>
    </div>
  );
};

export const Spinner: React.FC<{ className?: string }> = ({ className = 'w-5 h-5' }) => (
  <span
    className={`inline-block rounded-full border-2 border-current border-t-transparent animate-spin ${className}`}
    aria-hidden
  />
);

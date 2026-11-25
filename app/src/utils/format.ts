import type { MailAddress, MessageHeader } from '@/types/mail';

const pad = (n: number) => String(n).padStart(2, '0');

/** Data curta para a lista: "14:32", "Ontem", "seg.", "05/12" ou "05/12/24". */
export function formatListDate(ms: number, now = new Date()): string {
  if (!ms) return '';
  const d = new Date(ms);
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const DAY = 86_400_000;
  if (ms >= startToday) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (ms >= startToday - DAY) return 'Ontem';
  if (ms >= startToday - 6 * DAY) return d.toLocaleDateString('pt-BR', { weekday: 'short' });
  if (d.getFullYear() === now.getFullYear()) return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)}`;
}

/** Data completa para a leitura: "sex., 27/11/2026 às 14:05". */
export function formatFullDate(ms: number): string {
  if (!ms) return '';
  const d = new Date(ms);
  const weekday = d.toLocaleDateString('pt-BR', { weekday: 'short' });
  return `${weekday}, ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} às ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function displayName(a: MailAddress | undefined): string {
  if (!a) return '';
  return (a.name || '').trim() || (a.email || '').trim();
}

export function initials(a: MailAddress | undefined): string {
  // Sem nome, usa só a parte antes do @ (ex.: "cliente@exemplo.com" → "CL").
  const base = (a?.name || '').trim() || (a?.email || '').split('@')[0];
  const name = base.replace(/[^\p{L}\p{N} ]/gu, ' ').trim();
  if (!name) return '?';
  const parts = name.split(/\s+/);
  const first = parts[0]?.[0] || '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] : parts[0]?.[1] || '';
  return (first + last).toUpperCase();
}

const AVATAR_COLORS = ['#2563eb', '#0d9488', '#7c3aed', '#db2777', '#ea580c', '#16a34a', '#0284c7', '#9333ea'];

export function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

export function formatAddressList(list: MailAddress[]): string {
  return list.map((a) => (a.name ? `${a.name} <${a.email}>` : a.email)).join(', ');
}

export function formatSize(bytes: number): string {
  if (!bytes || bytes < 1024) return `${Math.max(0, bytes || 0)} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

/** Trecho curto do texto, para a lista. */
export function makeSnippet(text: string, max = 140): string {
  const clean = text
    .replace(/\r/g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('>'))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** Separa "a@x.com, B <b@y.com>; c@z" em uma lista de endereços. */
export function splitRecipients(raw: string): string[] {
  return raw
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isValidRecipient(raw: string): boolean {
  const m = raw.match(/<([^>]+)>/);
  const email = (m ? m[1] : raw).trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function headerKey(h: Pick<MessageHeader, 'uid'>): string {
  return String(h.uid);
}

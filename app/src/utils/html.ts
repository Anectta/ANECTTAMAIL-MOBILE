import DOMPurify from 'dompurify';

/** Converte HTML em texto simples (usado para trechos e citações). */
export function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('style,script,head,title').forEach((el) => el.remove());
  doc.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
  doc.querySelectorAll('p,div,tr,li,h1,h2,h3,h4,h5,h6,blockquote').forEach((el) => el.append('\n'));
  return (doc.body.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
}

export interface SafeHtmlResult {
  html: string;
  /** Imagens externas bloqueadas (podem revelar ao remetente que o e-mail foi aberto). */
  blockedImages: number;
  /** Pixels de rastreamento removidos (imagens minúsculas ou invisíveis). */
  blockedTrackers: number;
}

const isRemote = (src: string) => /^(https?:)?\/\//i.test(src.trim());

function isTrackingPixel(img: HTMLImageElement): boolean {
  const w = Number(img.getAttribute('width') || 0);
  const h = Number(img.getAttribute('height') || 0);
  const style = (img.getAttribute('style') || '').replace(/\s/g, '').toLowerCase();
  return (w > 0 && w <= 2 && h > 0 && h <= 2) || style.includes('display:none') || style.includes('visibility:hidden');
}

/**
 * HTML seguro para exibir: sem scripts, formulários nem eventos, links abrindo fora do app.
 * Pixels de rastreamento são sempre removidos; demais imagens externas só aparecem se
 * `allowRemoteImages` for true (Escudo Anectta).
 */
export function sanitizeEmailHtml(raw: string, allowRemoteImages: boolean): SafeHtmlResult {
  const clean = DOMPurify.sanitize(raw, {
    WHOLE_DOCUMENT: true,
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select', 'meta', 'link', 'base'],
    FORBID_ATTR: ['srcset'],
    ADD_ATTR: ['target'],
  });
  const doc = new DOMParser().parseFromString(clean, 'text/html');
  let blockedImages = 0;
  let blockedTrackers = 0;
  doc.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src') || '';
    if (!isRemote(src)) return;
    if (isTrackingPixel(img)) {
      img.remove();
      blockedTrackers += 1;
      return;
    }
    if (!allowRemoteImages) {
      img.setAttribute('data-blocked-src', src);
      img.removeAttribute('src');
      img.setAttribute('alt', img.getAttribute('alt') || '');
      blockedImages += 1;
    }
  });
  // Fundos remotos em estilos inline também carregam imagens externas.
  if (!allowRemoteImages) {
    doc.querySelectorAll<HTMLElement>('[style*="url("]').forEach((el) => {
      el.style.backgroundImage = 'none';
    });
    doc.querySelectorAll('[background]').forEach((el) => el.removeAttribute('background'));
  }
  doc.querySelectorAll('a[href]').forEach((a) => {
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
  });
  return { html: doc.documentElement.outerHTML, blockedImages, blockedTrackers };
}

/** Escapa texto simples para HTML. */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

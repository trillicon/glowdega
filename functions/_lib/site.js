// Rendering shared by the public pages and the admin preview.
// Card and archive markup mirror tools/build.py so new posts look identical to archived ones.
import { Marked } from './marked.esm.js';

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' })[c]);

const SITE_TZ = 'America/Los_Angeles';

// Archive dates are naive local strings ("2025-08-20T19:34:54"); admin dates are UTC ISO ("...Z").
function dateParts(iso) {
  if (/[zZ]|[+-]\d\d:\d\d$/.test(iso)) {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', { timeZone: SITE_TZ, year: 'numeric', month: 'numeric', day: 'numeric' })
        .formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
    return { y: +p.year, m: +p.month, d: +p.day };
  }
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return { y, m, d };
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const fdate = (iso) => { const { y, m, d } = dateParts(iso); return `${MONTHS[m - 1]} ${d}, ${y}`; };
export const isoDay = (iso) => { const { y, m, d } = dateParts(iso); return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`; };
export const year = (iso) => dateParts(iso).y;

export function card(p, label = '') {
  const meta = (label ? label + ' • ' : '') + fdate(p.date) + (p.category ? ' • ' + esc(p.category) : '');
  return `<a class="card" href="/blog/${esc(p.slug)}"><div><div class="meta">${meta}</div>`
    + `<h2>${esc(p.title)}</h2></div><div class="excerpt">${esc(p.excerpt)}</div></a>`;
}

// ---------- Markdown → safe HTML ----------
const SAFE_LINK = /^(https?:\/\/|mailto:|\/(?!\/)|#)/i;
const marked = new Marked({ gfm: true, async: false });
marked.use({
  renderer: {
    html({ text }) { return esc(text); },                         // raw HTML in drafts is shown as text, never run
    link(token) { return SAFE_LINK.test(token.href) ? false : this.parser.parseInline(token.tokens); },
    image(token) { return /^https:\/\//i.test(token.href) ? false : esc(token.text); },
  },
});

export function renderMarkdown(md) {
  return marked.parse(String(md ?? ''))
    .replace(/<a href="(https?:\/\/[^"]*)"/g, '<a href="$1" target="_blank" rel="noopener"')
    .replace(/<img /g, '<img loading="lazy" ')
    .replace(/<h1>/g, '<h2>').replace(/<\/h1>/g, '</h2>');           // the page title is the only h1
}

export const plainText = (html) =>
  html.replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim();

export function excerptFrom(md) {
  const text = plainText(renderMarkdown(md));
  return text.length <= 220 ? text : text.slice(0, 220).replace(/\s+\S*$/, '').replace(/[,.;:—-]+$/, '') + '…';
}

// ---------- article page from assets/templates/article.html ----------
export function articlePage(template, post, { newer, older } = {}) {
  const html = renderMarkdown(post.body_md);
  const minutes = Math.max(1, Math.round(plainText(html).split(' ').length / 225));
  const cats = post.category ? esc(post.category) : '';
  const pager = [newer && card(newer, 'Newer'), older && card(older, 'Older')].filter(Boolean).join('');
  const values = {
    TITLE: esc(post.title),
    DESC: esc(post.excerpt || excerptFrom(post.body_md)),
    DATE_ISO: isoDay(post.date),
    DATE: fdate(post.date),
    MINUTES: String(minutes),
    META_CATS: cats ? `<span>${cats}</span>` : '',
    SIDE_CATS: cats ? `<div class="side-label">Filed under</div><p>${cats}</p>` : '',
    HERO_FIGURE: /^(https:\/\/|\/assets\/img\/)/i.test(post.hero_image || '')
      ? `<figure class="article-image"><img src="${esc(post.hero_image)}" alt="" fetchpriority="high"></figure>` : '',
    BODY: html,
    PAGER: pager,
  };
  return template.replace(/%%([A-Z_]+)%%/g, (m, k) => (k in values ? values[k] : m));
}

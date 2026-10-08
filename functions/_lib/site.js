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

export function card(p, { dated = true } = {}) {
  const meta = [dated && fdate(p.date), p.category && esc(p.category)].filter(Boolean).join(' • ');
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

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) =>
  e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1)) : (ENTITIES[e.toLowerCase()] ?? m));
export const plainText = (html) =>
  decode(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

export function excerptFrom(md) {
  const text = plainText(renderMarkdown(md));
  return text.length <= 220 ? text : text.slice(0, 220).replace(/\s+\S*$/, '').replace(/[,.;:—-]+$/, '') + '…';
}

// ---------- structured data (schema.org) ----------
const AUTHOR = { '@type': 'Person', name: 'Hadiyah Daché', jobTitle: 'Licensed Esthetician', url: 'https://www.fairyglowmother.com/' };
const stripMd = (md) => plainText(renderMarkdown(md));

// "## FAQ" section with "### Question" headings → [{q, a}]
export function faqFrom(md) {
  const section = String(md ?? '').split(/^##\s+FAQ\s*$/m)[1];
  if (!section) return [];
  const body = section.split(/^##\s+/m)[0];
  return body.split(/^###\s+/m).slice(1).map((chunk) => {
    const [q, ...rest] = chunk.split('\n');
    return { q: q.trim(), a: stripMd(rest.join('\n')) };
  }).filter((x) => x.q && x.a);
}

export function jsonLd(post, dateIso) {
  const ld = [{
    '@context': 'https://schema.org', '@type': 'BlogPosting', headline: post.title,
    description: post.excerpt || excerptFrom(post.body_md), datePublished: dateIso, inLanguage: 'en-US',
    author: AUTHOR, publisher: { '@type': 'Organization', name: 'GLOWDEGA®' },
    ...(post.category ? { articleSection: post.category } : {}),
    ...(/^https:\/\//i.test(post.hero_image || '') ? { image: post.hero_image } : {}),
  }];
  const faq = faqFrom(post.body_md);
  if (faq.length) {
    ld.push({ '@context': 'https://schema.org', '@type': 'FAQPage',
      mainEntity: faq.map(({ q, a }) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) });
  }
  return ld.map((x) => `<script type="application/ld+json">${JSON.stringify(x).replace(/</g, '\\u003c')}</script>`).join('');
}

// Keep reading: same category first, then nearest in time (tools/build.py also weighs tags, which D1 posts lack).
export const RELATED = 4;
export function relatedPosts(post, posts) {
  const t = (p) => Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(p.date) ? p.date : p.date + 'Z');
  const at = t(post);
  return posts.filter((p) => p.slug !== post.slug)
    .map((p) => ({ p, same: post.category && p.category === post.category ? 0 : 1, gap: Math.abs(t(p) - at) }))
    .sort((a, b) => a.same - b.same || a.gap - b.gap)
    .slice(0, RELATED).map((x) => x.p);
}

// ---------- ads (functions/_lib/ads.js chooses them; tools/build.py writes the same markers) ----------
// Shown in the right column when no ad runs there. Must match RAIL_PLACEHOLDER in tools/build.py.
export const RAIL_PLACEHOLDER = '<div class="ad-slot ad-slot--rail"><span>Advertisement</span><small>300 × 600</small></div>';

// "Skin Care & Acne" -> "skin-care-and-acne": the same slugs tools/build.py makes from WordPress categories and tags.
export const termSlug = (s) =>
  String(s ?? '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80).replace(/-+$/, '');

// Ad targeting terms of a post published from the admin: its category.
export const postTerms = (post) => [termSlug(post.category)].filter(Boolean);

// ---------- article page from assets/templates/article.html ----------
// `ads` = { rail, inline }: markup from ads.js railInner()/inlineSlot(); without them the rail shows the placeholder
// and there is no inline slot.
export function articlePage(template, post, related = [], ads = {}) {
  const html = renderMarkdown(post.body_md);
  const minutes = Math.max(1, Math.round(plainText(html).split(' ').length / 225));
  const cats = post.category ? esc(post.category) : '';
  const values = {
    TITLE: esc(post.title),
    DESC: esc(post.excerpt || excerptFrom(post.body_md)),
    DATE_ISO: isoDay(post.date),
    DATE: fdate(post.date),
    MINUTES: String(minutes),
    SIDE_CATS: cats ? `<div class="side-label">Filed under</div><p>${cats}</p>` : '',
    HERO_FIGURE: /^(https:\/\/|\/assets\/img\/)/i.test(post.hero_image || '')
      ? `<figure class="article-image"><img src="${esc(post.hero_image)}" alt="" fetchpriority="high"></figure>` : '',
    BODY: html,
    PAGER: related.map((p) => card(p)).join(''),
    JSONLD: jsonLd(post, isoDay(post.date)),
    AD_TERMS: esc(postTerms(post).join(' ')),
    AD_RAIL: ads.rail || RAIL_PLACEHOLDER,
    AD_INLINE: ads.inline || '',
  };
  return template.replace(/%%([A-Z_]+)%%/g, (m, k) => (k in values ? values[k] : m));
}

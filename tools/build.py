"""Rebuild GLOWDEGA Gazette (home, blog index, article pages) from the Squarespace WXR export.

usage: python3 -I tools/build.py <export.xml> .
"""
import csv, hashlib, html, json, os, re, sys, unicodedata, urllib.parse, urllib.request, xml.etree.ElementTree as ET
from datetime import datetime
from html.parser import HTMLParser

XML, SITE = sys.argv[1], sys.argv[2]
NS = {'wp': 'http://wordpress.org/export/1.2/', 'content': 'http://purl.org/rss/1.0/modules/content/'}
IMG_DIR = os.path.join(SITE, 'assets', 'img')
CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'img_cache.json')
os.makedirs(IMG_DIR, exist_ok=True)

# Search Console export (Performance → Pages → Export → CSV, the Pages.csv inside the zip). Orders the home page.
POPULARITY = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'popularity.csv')
# Ads: every article carries two empty ad slots that functions/blog/[slug].js fills from the D1 `ads` table
# (see functions/_lib/ads.js): a 300x600 rail beside the text and a 728x90 banner between photo/meta and text.
# The <article> lists the page's targeting terms (category + tag slugs) in data-ad-terms.

items = ET.parse(XML).getroot().find('channel').findall('item')
by_id = {i.findtext('wp:post_id', namespaces=NS): i for i in items}
raw_posts = [i for i in items if i.findtext('wp:post_type', namespaces=NS) == 'post'
             and i.findtext('wp:status', namespaces=NS) == 'publish']
SLUGS = {p.findtext('wp:post_name', namespaces=NS) for p in raw_posts}
PAGES = {os.path.splitext(f)[0] for f in os.listdir(os.path.join(SITE, 'pages'))}

# ---------- images: download once, serve locally ----------
cache = json.load(open(CACHE)) if os.path.exists(CACHE) else {}

def local_image(url):
    """Return site-relative path of a downloaded copy, or None if the image is dead."""
    url = html.unescape(url.strip())
    if url in cache:
        return cache[url]
    fetch = re.sub(r'^http://images\.squarespace-cdn', 'https://images.squarespace-cdn', url)
    if 'squarespace-cdn.com' in fetch:
        fetch += ('&' if '?' in fetch else '?') + 'format=1500w'
    result = None
    try:
        req = urllib.request.Request(fetch, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=20) as r:
            ctype = r.headers.get('Content-Type', '')
            data = r.read()
        ext = {'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp'}.get(ctype.split(';')[0])
        if ext and data:
            name = hashlib.sha1(url.encode()).hexdigest()[:12] + ext
            open(os.path.join(IMG_DIR, name), 'wb').write(data)
            result = 'assets/img/' + name
    except Exception as e:
        print('  dead image:', url, '-', e.__class__.__name__)
    cache[url] = result
    json.dump(cache, open(CACHE, 'w'), indent=1)
    return result

# ---------- links ----------
def rewrite_href(href):
    """Map old site links to the static archive. Returns new href, or None to unwrap the link."""
    h = html.unescape(href.strip())
    if h.startswith('#') or re.match(r'^(mailto|tel|sms):', h, re.I):
        return h
    m = re.match(r'^(?:https?://(?:www\.)?(?:glowdega|fairyglowmother)\.com)?/?(.*)$', h)
    if not re.match(r'^https?://', h) or re.match(r'^https?://(?:www\.)?(?:glowdega|fairyglowmother)\.com', h):
        path = m.group(1)
        if re.match(r'^https?://(?:www\.)?fairyglowmother\.com', h) and not re.match(r'(fairy-glow-mother|blog)/', path):
            return h  # Hadiyah's live site
        if '/s/' in '/' + path or path.startswith('s/') or path.startswith('shop/') or path.startswith('products/') or path == 'join':
            return None  # Squarespace export artifacts / closed shop
        s = re.match(r'^(?:fairy-glow-mother|blog)/([^/?#]+)', path)
        if s:
            # keep the original path (/blog/<slug> or /fairy-glow-mother/<slug>); _redirects maps the latter
            return '/' + path if s.group(1) in SLUGS else None
        if path.startswith('blog'):
            return '/' + path
        if path in ('', '#book', 'home') or path.startswith('#'):
            return '{root}book.html' if 'book' in path else '{root}index.html'
        if path.rstrip('/') == 'book':
            return '{root}book.html'
        if path.rstrip('/') in PAGES:
            return '{root}pages/' + path.rstrip('/') + '.html'
        return None
    if not re.match(r'^https?://[^/?#]*\.[a-z]{2,}', h, re.I):
        return None  # malformed external URL (e.g. "https://fibr")
    return h

# Text for links whose only content was an image that no longer exists
LINK_LABELS = {
    'http://www.mydarlingvegan.com/2015/03/raw-vanilla-caramel-lumuca-ice-cream/': 'Lucuma Ice Cream Recipe →',
    'http://www.thegreenlife.ca/creamy-matcha-moringa-latte/': 'Moringa Latte Recipe →',
    'https://minimalistbaker.com/mediterranean-baked-sweet-potatoes/': 'Mediterranean Baked Sweet Potatoes Recipe →',
}

def label_or_drop(m):
    label = LINK_LABELS.get(html.unescape(m.group(1)))
    return f'<a href="{m.group(1)}"{m.group(2)}>{esc(label)}</a> ' if label else ''

# ---------- HTML sanitizer ----------
KEEP = {'p', 'h2', 'h3', 'h4', 'strong', 'em', 'u', 's', 'sup', 'sub', 'small', 'a', 'ul', 'ol', 'li',
        'blockquote', 'figure', 'figcaption', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'br', 'hr',
        'pre', 'code', 'iframe'}
RENAME = {'b': 'strong', 'i': 'em', 'h1': 'h2', 'h5': 'h4', 'h6': 'h4'}
VOID = {'img', 'br', 'hr'}
BLOCK = {'p', 'h2', 'h3', 'h4', 'ul', 'ol', 'table', 'figure', 'blockquote', 'pre', 'hr'}
DROP_CONTENT = {'script', 'style', 'noscript'}
YT = re.compile(r'(?:youtu\.be/|youtube\.com/(?:watch\?v=|embed/))([\w-]{11})')

class Clean(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.out, self.stack, self.skip, self.embed, self.images = [], [], 0, 0, []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag in DROP_CONTENT:
            self.skip += 1; return
        if self.skip: return
        if tag == 'div' and 'wp-block-embed__wrapper' in (a.get('class') or ''):
            self.embed += 1
        tag = RENAME.get(tag, tag)
        if tag not in KEEP:
            if tag not in VOID: self.stack.append(None)
            return
        attr = ''
        if tag == 'a':
            href = a.get('href') or ''
            new = rewrite_href(href) if href else None
            if new is None or re.search(r'\.(jpe?g|png|gif|webp)(\?|$)', new, re.I) or 'attachment_id' in new:
                self.stack.append(None); return
            attr = ' href="%s"' % html.escape(new, quote=True)
            if new.startswith('http'): attr += ' target="_blank" rel="noopener"'
        elif tag == 'img':
            src = local_image(a.get('src') or '') if a.get('src') else None
            if not src: return
            self.images.append(src)
            attr = ' src="{root}%s" alt="%s" loading="lazy"' % (src, html.escape(html.unescape(a.get('alt') or ''), quote=True))
        elif tag == 'iframe':
            src = a.get('src') or ''
            if not re.match(r'https://(open\.spotify\.com|www\.youtube(-nocookie)?\.com)/', src):
                self.skip += 1; return
            self.out.append('<div class="embed%s"><iframe src="%s" title="Embedded media" loading="lazy" allowfullscreen></iframe></div>'
                            % (' embed--audio' if 'spotify' in src else '', html.escape(src, quote=True)))
            self.skip += 1; return  # ignore iframe children/closing
        elif tag in ('td', 'th'):
            for k in ('colspan', 'rowspan'):
                if a.get(k): attr += ' %s="%s"' % (k, html.escape(a[k]))
        if tag in BLOCK and 'p' in self.stack:
            self.close_to('p')
        self.out.append('<%s%s>' % (tag, attr))
        if tag not in VOID: self.stack.append(tag)

    def close_to(self, tag):
        """Close open elements down to and including the innermost `tag`."""
        while self.stack:
            t = self.stack.pop()
            if t: self.out.append('</%s>' % t)
            if t == tag: return

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOID and RENAME.get(tag, tag) not in VOID: self.handle_endtag(tag)

    def handle_endtag(self, tag):
        if tag in DROP_CONTENT or tag == 'iframe':
            self.skip = max(0, self.skip - 1); return
        if self.skip or tag in VOID or RENAME.get(tag, tag) in VOID: return
        tag = RENAME.get(tag, tag)
        if tag in KEEP:
            if tag in self.stack: self.close_to(tag)
        elif self.stack and self.stack[-1] is None:
            self.stack.pop()

    def handle_data(self, d):
        if self.skip: return
        if self.embed:
            m = YT.search(d)
            if m:
                self.out.append('<div class="embed"><iframe src="https://www.youtube-nocookie.com/embed/%s" title="YouTube video" loading="lazy" allowfullscreen></iframe></div>' % m.group(1))
                self.embed -= 1
                return
            if not d.strip(): return
        self.out.append(d)

    def handle_entityref(self, n):
        if not self.skip: self.out.append('&%s;' % n)

    def handle_charref(self, n):
        if not self.skip: self.out.append('&#%s;' % n)

def clean(body):
    p = Clean(); p.feed(body); p.close()
    while p.stack: p.close_to(p.stack[-1] or '')
    out = ''.join(p.out)
    out = re.sub(r'<a href="([^"]*)"([^>]*)>\s*</a>\s*', label_or_drop, out)
    for _ in range(3):
        out = re.sub(r'<(p|h2|h3|h4|li|strong|em|figure|figcaption|blockquote)>(?:\s|&nbsp;|&#160;| |<br>)*</\1>', '', out)
        out = re.sub(r'<figure>\s*<figcaption>(.*?)</figcaption>\s*</figure>', r'<p class="note">\1</p>', out, flags=re.S)
        out = re.sub(r'<figure>\s*</figure>', '', out)
    out = re.sub(r'(<br>\s*){3,}', '<br><br>', out)
    out = re.sub(r'\n\s*\n+', '\n', out).strip()
    return out, p.images

def text_of(h):
    t = re.sub(r'<[^>]+>', ' ', h)
    return re.sub(r'\s+', ' ', html.unescape(t)).strip()

def esc(s):
    return html.escape(s, quote=True)

def term_slug(s):
    """WordPress nicename (or a display name) -> the slug used for ad targeting, e.g. "Skin Care" -> "skin-care"."""
    s = urllib.parse.unquote(s or '').lower()
    s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode()
    return re.sub(r'[^a-z0-9]+', '-', s.replace('&', ' and ')).strip('-')[:80].rstrip('-')

def terms_of(item, domain):
    """[(slug, display name)] of an item's categories or tags, in export order, without duplicates."""
    out = []
    for c in item.findall('category'):
        if c.get('domain') != domain or not c.text: continue
        name = html.unescape(c.text.strip())
        slug = term_slug(c.get('nicename') or name)
        if slug and slug not in [s for s, _ in out]: out.append((slug, name))
    return out

def ad_terms(p):
    """Space-separated targeting terms of an archive post: its category slugs, then its tag slugs."""
    terms = []
    for slug, _ in p['cat_terms'] + p['tag_terms']:
        if slug not in terms: terms.append(slug)
    return ' '.join(terms)

# ---------- collect posts ----------
posts = []
for it in raw_posts:
    slug = it.findtext('wp:post_name', namespaces=NS)
    title = html.unescape(it.findtext('title') or slug).strip()
    date = datetime.strptime(it.findtext('wp:post_date', namespaces=NS), '%Y-%m-%d %H:%M:%S')
    cat_terms = terms_of(it, 'category')
    tag_terms = terms_of(it, 'post_tag')
    cats = [name for _, name in cat_terms]
    tags = [name for _, name in tag_terms]
    print('·', slug)
    body, imgs = clean(it.findtext('content:encoded', namespaces=NS) or '')
    hero = None
    for pm in it.findall('wp:postmeta', NS):
        if pm.findtext('wp:meta_key', namespaces=NS) == '_thumbnail_id':
            att = by_id.get(pm.findtext('wp:meta_value', namespaces=NS))
            if att is not None:
                hero = local_image(att.findtext('wp:attachment_url', namespaces=NS) or '')
    if hero in imgs: hero = None  # already shown in the body
    text = text_of(body)
    excerpt = text if len(text) <= 220 else text[:220].rsplit(' ', 1)[0].rstrip(',.;:—-') + '…'
    posts.append(dict(slug=slug, title=title, date=date, cats=cats, tags=tags, cat_terms=cat_terms, tag_terms=tag_terms,
                      body=body, hero=hero,
                      excerpt=excerpt, minutes=max(1, round(len(text.split()) / 225))))

posts.sort(key=lambda p: p['date'], reverse=True)

# ---------- categories: one per post from assets/taxonomy.json; old WordPress categories become tags ----------
TAXONOMY = json.load(open(os.path.join(SITE, 'assets', 'taxonomy.json')))
CATEGORY_SLUG = {c['name']: c['slug'] for c in TAXONOMY}
assert all(term_slug(c['name']) == c['slug'] for c in TAXONOMY), 'assets/taxonomy.json: a slug does not match its name'
MAPPING = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'categories.json')))
bad = [v for v in list(MAPPING['map'].values()) + list(MAPPING['posts'].values()) if v not in CATEGORY_SLUG]
if bad: sys.exit(f'tools/categories.json: not in assets/taxonomy.json: {sorted(set(bad))}')
unknown = set(MAPPING['posts']) - SLUGS
if unknown: sys.exit(f'tools/categories.json: no such post: {sorted(unknown)}')
missing = []
for p in posts:
    cat = MAPPING['posts'].get(p['slug']) or next((MAPPING['map'][c] for c in p['cats'] if c in MAPPING['map']), None)
    if not cat:
        missing.append(p['slug']); continue
    tags = []
    for slug, name in p['tag_terms'] + p['cat_terms']:
        if slug != CATEGORY_SLUG[cat] and slug not in MAPPING['drop_tags'] and slug not in [s for s, _ in tags]:
            tags.append((slug, name))
    p['old_cats'] = p['cats']
    p['cats'], p['cat_terms'] = [cat], [(CATEGORY_SLUG[cat], cat)]
    p['tags'], p['tag_terms'] = [n for _, n in tags], tags
if missing: sys.exit(f'no category for {len(missing)} posts (add them to tools/categories.json): {missing}')

def fdate(d): return d.strftime('%b %-d, %Y')

# ---------- shared chrome (matches existing site) ----------
def page(root, title, desc, main, extra_head=''):
    return ('<!doctype html><html lang="en"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width,initial-scale=1">'
            f'<title>{esc(title)}</title><meta name="description" content="{esc(desc)}">'
            f'<meta property="og:title" content="{esc(title)}"><meta property="og:description" content="{esc(desc)}">'
            f'<meta property="og:site_name" content="GLOWDEGA®">{extra_head}'
            f'<link rel="preload" href="{root}assets/fonts/BricolageGrotesque.woff2" as="font" type="font/woff2" crossorigin>'
            f'<link rel="stylesheet" href="{root}assets/style.css"></head><body><div class="site">'
            f'<div class="bookbar"><a href="{root}book.html">NEW BOOK • PRE-ORDER / BOOK UPDATES →</a></div>'
            f'{header(root)}<main>{main}</main>{footer(root)}</div></body></html>\n')

# Header and footer for every page; static pages (index, book, policies, pages/*) are synced at the end of the build.
def header(root):
    return (f'<header><a class="logo" href="{root}index.html"><img src="{root}assets/img/brand/glowdega-logo.png" alt="GLOWDEGA®" width="766" height="114"></a><nav class="nav">'
            f'<a href="{root}blog.html">The Glow Gazette</a><a href="https://www.fairyglowmother.com/">About Hadiyah</a>'
            f'<a href="{root}esthetician-directory.html">Esthetician Directory</a><a href="{root}resources/">Resources</a></nav>'
            f'<div class="right"><a class="book-pill" href="{root}book.html">GET THE BOOK</a></div></header>')

def footer(root):
    return (f'<footer><div>GLOWDEGA®<br>Oakland, California</div><div><a href="{root}blog.html">The Glow Gazette</a>'
            f'<a href="{root}book.html">The Book</a><a href="{root}resources/">Resources</a></div><div><a href="https://www.fairyglowmother.com/">Fairy Glow Mother</a>'
            f'<a href="{root}privacy.html">Privacy</a><a href="{root}affiliate-disclosure.html">Affiliate Disclosure</a></div></footer>')

def card(p, root='', dated=True):
    meta = ' • '.join(([fdate(p['date'])] if dated else []) + [esc(c) for c in p['cats'][:1]])
    return (f'<a class="card" href="/blog/{p["slug"]}"><div><div class="meta">{meta}</div>'
            f'<h2>{esc(p["title"])}</h2></div><div class="excerpt">{esc(p["excerpt"])}</div></a>')

# ---------- articles ----------
art_dir = os.path.join(SITE, 'blog')
os.makedirs(art_dir, exist_ok=True)
for f in os.listdir(art_dir):
    if f.endswith('.html'): os.remove(os.path.join(art_dir, f))

AUTHOR = 'Hadiyah Daché'
# Shown under "Written by" and as schema.org jobTitle (functions/_lib/site.js AUTHOR must match).
AUTHOR_CREDENTIAL = 'Licensed Cosmetologist & Esthetician'

def article_ld(title, desc, date_iso):
    """schema.org BlogPosting for an article (functions/_lib/site.js builds the same shape for admin posts)."""
    return {'@context': 'https://schema.org', '@type': 'BlogPosting', 'headline': title, 'description': desc,
            'datePublished': date_iso, 'inLanguage': 'en-US',
            'author': {'@type': 'Person', 'name': AUTHOR, 'alternateName': 'Fairy Glow Mother',
                       'jobTitle': AUTHOR_CREDENTIAL, 'url': 'https://www.fairyglowmother.com/'},
            'publisher': {'@type': 'Organization', 'name': 'GLOWDEGA®'}}

def ld_json(data):
    return '<script type="application/ld+json">' + json.dumps(data, ensure_ascii=False).replace('</', '<\\/') + '</script>'

# Both ad slots always show something: the house ads for the book ship in the page and functions/_lib/ads.js swaps in a
# real ad (targeted, else a default) per request. functions/_lib/site.js has the same HOUSE_RAIL and HOUSE_INLINE.
HOUSE_RAIL = ('<div class="ad-slot ad-slot--rail ad-slot--house"><a class="house-ad house-ad--rail" href="/book">'
              '<span class="house-ad__label">Advertisement</span><span class="house-ad__main"><span class="house-ad__kicker">The book</span>'
              '<strong class="house-ad__title">Under Your Skin</strong><span class="house-ad__by">by Hadiyah Daché</span></span>'
              '<span class="house-ad__cta">Get the book →</span></a></div>')
HOUSE_INLINE = ('<div class="ad-slot ad-slot--inline ad-slot--house" data-ad-slot="inline" aria-label="Advertisement">'
                '<a class="house-ad house-ad--inline" href="/book"><span class="house-ad__label">Advertisement</span>'
                '<strong class="house-ad__title">Under Your Skin</strong><span class="house-ad__by">the book by Hadiyah Daché</span>'
                '<span class="house-ad__cta">Get the book →</span></a></div>')
AD_RAIL = '<aside class="ad-rail" aria-label="Advertisement" data-ad-slot="rail">' + HOUSE_RAIL + '</aside>'
AD_INLINE = HOUSE_INLINE
# First line of every article's text (functions/_lib/site.js AFFILIATE_NOTE must match).
AFFILIATE_NOTE = ('Friendly reminder: this post contains affiliate links, which help support the Glowdega Archive. '
                  'If you buy through them, I may earn a commission at no extra cost to you.')

def filed_under(category, tags):
    """'Filed under' in the article details: the category, then the tags (functions/_lib/site.js filedUnder())."""
    return (f'<div class="side-label">Filed under</div><p data-terms="category">{esc(category)}</p>'
            f'<p class="article-tags" data-terms="tags">{" · ".join(esc(t) for t in tags)}</p>')

def article_page(title, date_iso, date_txt, filed, minutes, hero_src, body, pager, desc, root='../', jsonld=None,
                 terms=''):
    """Article page. `filed` (see filed_under), `body` and `pager` (the related-post cards) are HTML; the rest is text."""
    hero = (f'<figure class="article-image"><img src="{hero_src}" alt="" fetchpriority="high"></figure>'
            if hero_src else '')
    info = (f'<div class="article-info"><div class="side-label">Written by</div><p>{AUTHOR}, {esc(AUTHOR_CREDENTIAL.lower())}</p>'
            f'<div class="side-label">Published</div><p><time datetime="{date_iso}">{date_txt}</time></p>'
            + filed
            + f'<div class="side-label">Reading time</div><p>{minutes} min</p>'
            + f'<a href="{root}blog.html">← All articles</a><a href="{root}book.html">The Book →</a></div>')
    main = (f'<article data-ad-terms="{esc(terms)}"><div class="article-hero"><div class="eyebrow"><a href="{root}blog.html">GLOWDEGA® / THE GLOW GAZETTE</a></div>'
            f'<h1>{esc(title)}</h1></div>'
            f'<div class="article-top">{hero}{info}</div><hr class="article-rule">'
            + AD_INLINE
            + f'<div class="article-layout"><div class="prose"><p class="affiliate-note">{esc(AFFILIATE_NOTE)}</p>{body}</div>{AD_RAIL}</div></article>'
            f'<section class="grid"><div class="grid-head"><span>Keep reading</span><a href="{root}blog.html">All articles →</a></div>'
            f'<div class="post-grid post-grid--four">{pager}</div></section>')
    head = (f'<meta property="og:type" content="article"><meta property="article:published_time" content="{date_iso}">'
            + (jsonld if jsonld is not None else ld_json(article_ld(title, desc, date_iso))))
    return page(root, f'{title} — GLOWDEGA®', desc, main, head)

RELATED = 4

def related(p):
    """The RELATED posts sharing the most categories (weighted) and tags with p; ties go to the nearest in time."""
    cats, tags = set(p['cats']), set(p['tags'])
    others = [q for q in posts if q is not p]
    return sorted(others, key=lambda q: (-(3 * len(cats & set(q['cats'])) + len(tags & set(q['tags']))),
                                         abs((q['date'] - p['date']).total_seconds())))[:RELATED]

for p in posts:
    root = '../'
    pager = ''.join(card(q, root) for q in related(p))
    open(os.path.join(art_dir, p['slug'] + '.html'), 'w').write(article_page(
        p['title'], f"{p['date']:%Y-%m-%d}", fdate(p['date']), filed_under(p['cats'][0], p['tags']), p['minutes'],
        root + p['hero'] if p['hero'] else None, p['body'].replace('{root}', root), pager, p['excerpt'],
        terms=ad_terms(p)))

# ---------- data + template for posts published from the admin (functions/) ----------
os.makedirs(os.path.join(SITE, 'assets', 'templates'), exist_ok=True)
json.dump([dict(slug=p['slug'], title=p['title'], date=f"{p['date']:%Y-%m-%dT%H:%M:%S}",
                category=p['cats'][0], excerpt=p['excerpt'],
                categories=[dict(slug=s, name=n) for s, n in p['cat_terms']],
                tags=[dict(slug=s, name=n) for s, n in p['tag_terms']]) for p in posts],
          open(os.path.join(SITE, 'assets', 'posts.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
open(os.path.join(SITE, 'assets', 'templates', 'article.html'), 'w').write(article_page(
    '%%TITLE%%', '%%DATE_ISO%%', '%%DATE%%', '%%SIDE_CATS%%', '%%MINUTES%%', '%%HERO%%', '%%BODY%%', '%%PAGER%%', '%%DESC%%',
    root='/', jsonld='%%JSONLD%%', terms='%%AD_TERMS%%')
    .replace('<figure class="article-image"><img src="%%HERO%%" alt="" fetchpriority="high"></figure>', '%%HERO_FIGURE%%')
    .replace(HOUSE_RAIL, '%%AD_RAIL%%').replace(HOUSE_INLINE, '%%AD_INLINE%%'))

# ---------- blog index (newest first, grouped by year) ----------
years = sorted({p['date'].year for p in posts}, reverse=True)
nav = ''.join(f'<a class="pill" href="#y{y}">{y}</a>' for y in years)
groups = ''.join(
    f'<section class="grid" id="y{y}"><div class="grid-head"><span>{y}</span><span>{sum(1 for p in posts if p["date"].year == y)} posts</span></div>'
    f'<div class="post-grid">' + ''.join(card(p) for p in posts if p['date'].year == y) + '</div></section>'
    for y in years)
main = (f'<section class="page-shell"><div class="eyebrow">GLOWDEGA® / THE ARCHIVE</div><h1>THE GLOW<br>GAZETTE</h1>'
        f'<p class="archive-count">{len(posts)} articles, newest first.</p><nav class="archive-nav" aria-label="Jump to year">{nav}</nav></section>{groups}')
open(os.path.join(SITE, 'blog.html'), 'w').write(
    page('', 'The Glow Gazette — GLOWDEGA®', f'The Glow Gazette archive: {len(posts)} articles on skin care, acne, ingredients, and studio life.', main))

# ---------- 404 (also stops Pages serving the home page for unknown URLs) ----------
open(os.path.join(SITE, '404.html'), 'w').write(page('/', 'Page not found — GLOWDEGA®', 'This page does not exist.',
    '<section class="page-shell"><div class="eyebrow">GLOWDEGA® / 404</div><h1>NOT<br>FOUND</h1>'
    '<div class="page-copy"><p>This page doesn’t exist, or it has moved.</p></div>'
    '<p><a class="cta" href="/blog">Browse The Glow Gazette →</a></p></section>'))

# ---------- esthetician directory (placeholder until it launches) ----------
open(os.path.join(SITE, 'esthetician-directory.html'), 'w').write(page('', 'Esthetician Directory — GLOWDEGA®',
    'A directory of licensed estheticians, from GLOWDEGA®. Coming soon.',
    '<section class="page-shell"><div class="eyebrow">GLOWDEGA® / DIRECTORY</div><h1>ESTHETICIAN<br>DIRECTORY</h1>'
    '<p><span class="soon-pill">Coming soon</span></p>'
    '<div class="page-copy"><p>A directory of licensed estheticians is on the way. Check back soon.</p></div>'
    '<p><a class="cta" href="/blog">Read The Glow Gazette →</a></p></section>',
    '<meta name="robots" content="noindex">'))

# ---------- affiliate disclosure (linked from every footer) ----------
open(os.path.join(SITE, 'affiliate-disclosure.html'), 'w').write(page('', 'Affiliate Disclosure — GLOWDEGA®',
    'How the Glowdega Archive uses affiliate links, gifted products and partnerships.',
    '<section class="page-shell"><div class="eyebrow">GLOWDEGA® / PAGE</div><h1>Affiliate Disclosure</h1><div class="page-copy">'
    '<p>The Glowdega™ Archive is supported by affiliate links. If you click one and buy something, I may earn a small '
    'commission at no extra cost to you. It helps keep this site running and the advice free.</p>'
    '<p>I don\'t recommend products because they pay. I recommend them because I\'ve used them myself or with my clients '
    'over the years. Not every link here earns me anything, either. If the best product for the job has no affiliate '
    'program, I\'ll still send you to it.</p>'
    '<p>A few things you should know:</p><ul>'
    '<li>Brands sometimes send me products for free. When a review or mention involves a gifted product or a paid '
    'partnership, I\'ll say so right there in the post.</li>'
    '<li>Commissions and freebies never buy a positive review. If I didn\'t like it, you\'ll hear that too.</li>'
    '<li>Nothing here replaces a visit with your dermatologist or doctor, especially for persistent acne, pigmentation '
    'changes, or anything that\'s getting worse.</li></ul>'
    '<p>Questions about a recommendation or a partnership? Email '
    '<a href="mailto:book@fairyglowmother.com">book@fairyglowmother.com</a>.</p>'
    '<p><em>Last updated: October 2026</em></p></div></section>'))

# ---------- home: the 12 most-searched posts (Search Console clicks, then impressions), no dates ----------
def popularity():
    """Slugs from POPULARITY, most popular first. The CSV stays local (git-ignored; the repo is public), so without it
    the last ranking saved in assets/popular.json is reused; with neither, the home page falls back to newest first."""
    if not os.path.exists(POPULARITY):
        saved = os.path.join(SITE, 'assets', 'popular.json')
        if os.path.exists(saved):
            ranked = [s for s in json.load(open(saved)) if s in SLUGS]
            print(f'\npopularity: {POPULARITY} not found; reusing saved ranking of {len(ranked)} posts')
            return ranked
        print(f'\nWARNING: {POPULARITY} not found; home page ordered newest first')
        return []
    score = {}
    for r in csv.DictReader(open(POPULARITY, encoding='utf-8-sig')):
        m = re.search(r'/(?:blog|fairy-glow-mother)/([^/?#]+)', r.get('Top pages') or r.get('Page') or '')
        if not m or m.group(1) not in SLUGS: continue
        num = lambda k: float((r.get(k) or '0').replace(',', ''))
        c, i = score.get(m.group(1), (0, 0))
        score[m.group(1)] = (c + num('Clicks'), i + num('Impressions'))
    ranked = sorted(score, key=lambda s: score[s], reverse=True)
    print(f'\npopularity: {len(ranked)} of {len(posts)} posts ranked from {os.path.basename(POPULARITY)}')
    return ranked

ranked = popularity()
rank = {s: i for i, s in enumerate(ranked)}
# Home: the 6 newest posts, then the 6 best-ranked of the rest (functions/_lib/posts.js homeCards() does the same).
HOME_NEWEST, HOME_TRENDING = 6, 6
newest_first = sorted(posts, key=lambda p: p['date'], reverse=True)
home_posts = newest_first[:HOME_NEWEST] + sorted(newest_first[HOME_NEWEST:], key=lambda p: rank.get(p['slug'], len(rank)))[:HOME_TRENDING]
json.dump(ranked, open(os.path.join(SITE, 'assets', 'popular.json'), 'w'))
idx_path = os.path.join(SITE, 'index.html')
idx = open(idx_path).read()
start = idx.index('<div class="post-grid">')
end = idx.index('<p style="margin-top:24px">', start)
idx = idx[:start] + '<div class="post-grid">' + ''.join(card(p, dated=False) for p in home_posts) + '</div>' + idx[end:]
idx = re.sub(r'(\d+)( published posts| POSTS)', lambda m: f'{len(posts)}{m.group(2)}', idx)
open(idx_path, 'w').write(idx)

# ---------- static pages share the generated header and footer ----------
for root, names in (('', ['index', 'book', 'policies', 'privacy', 'tos']), ('../', [f'pages/{n}' for n in sorted(PAGES)])):
    for n in names:
        path = os.path.join(SITE, n + '.html')
        doc = open(path).read()
        doc = re.sub(r'<header>.*?</header>', lambda m: header(root), doc, count=1, flags=re.S)
        doc = re.sub(r'<footer>.*?</footer>', lambda m: footer(root), doc, count=1, flags=re.S)
        open(path, 'w').write(doc)

# ---------- /resources/: beauty business calculators (tools/resources_site.py; engine in assets/calc/core) ----------
# Loaded by path because `python3 -I` leaves the script's folder off sys.path.
import importlib.util
_spec = importlib.util.spec_from_file_location('resources_site', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'resources_site.py'))
resources_site = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(resources_site)
print('resources: ' + ', '.join(resources_site.build(SITE, page, ld_json)))

# ---------- favicon ----------
# Every page (generated, synced static pages, the article template, hand-made pages) links the brand icons.
ICON_LINKS = ('<link rel="icon" href="/favicon.ico" sizes="48x48">'
              '<link rel="icon" type="image/png" sizes="32x32" href="/assets/img/brand/favicon-32.png">'
              '<link rel="apple-touch-icon" href="/assets/img/brand/apple-touch-icon.png">')
for dirpath, dirnames, filenames in os.walk(SITE):
    dirnames[:] = [d for d in dirnames if not d.startswith('.') and d not in ('admin', 'node_modules')]
    for fn in filenames:
        if not fn.endswith('.html'): continue
        path = os.path.join(dirpath, fn)
        doc = open(path).read()
        new = re.sub(r'<link rel="(?:icon|apple-touch-icon)"[^>]*>', '', doc)
        new = new.replace('<meta charset="utf-8">', '<meta charset="utf-8">' + ICON_LINKS, 1)
        if new != doc: open(path, 'w').write(new)

# ---------- stylesheet version ----------
# Browsers keep assets/style.css for hours, so every page links it as style.css?v=<content hash>: a CSS change gives
# a new address and returning visitors get it at once. Covers every page, the article template and hand-made pages.
import hashlib
CSS_VERSION = hashlib.sha256(open(os.path.join(SITE, 'assets', 'style.css'), 'rb').read()).hexdigest()[:10]
for dirpath, dirnames, filenames in os.walk(SITE):
    dirnames[:] = [d for d in dirnames if not d.startswith('.') and d not in ('admin', 'node_modules')]
    for fn in filenames:
        if not fn.endswith('.html'): continue
        path = os.path.join(dirpath, fn)
        doc = open(path).read()
        new = re.sub(r'(assets/style\.css)(\?v=[0-9a-f]+)?"', rf'\1?v={CSS_VERSION}"', doc)
        if new != doc: open(path, 'w').write(new)
print(f'stylesheet version {CSS_VERSION}')

print(f'\nbuilt {len(posts)} articles; {sum(1 for v in cache.values() if v)} images saved, {sum(1 for v in cache.values() if not v)} dead')

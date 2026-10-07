"""Rebuild GLOWDEGA Gazette (home, blog index, article pages) from the Squarespace WXR export.

usage: python3 -I tools/build.py <export.xml> .
"""
import hashlib, html, json, os, re, sys, urllib.request, xml.etree.ElementTree as ET
from datetime import datetime
from html.parser import HTMLParser

XML, SITE = sys.argv[1], sys.argv[2]
NS = {'wp': 'http://wordpress.org/export/1.2/', 'content': 'http://purl.org/rss/1.0/modules/content/'}
IMG_DIR = os.path.join(SITE, 'assets', 'img')
CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'img_cache.json')
os.makedirs(IMG_DIR, exist_ok=True)

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

# ---------- collect posts ----------
posts = []
for it in raw_posts:
    slug = it.findtext('wp:post_name', namespaces=NS)
    title = html.unescape(it.findtext('title') or slug).strip()
    date = datetime.strptime(it.findtext('wp:post_date', namespaces=NS), '%Y-%m-%d %H:%M:%S')
    cats = [html.unescape(c.text.strip()) for c in it.findall('category') if c.get('domain') == 'category' and c.text]
    tags = [html.unescape(c.text.strip()) for c in it.findall('category') if c.get('domain') == 'post_tag' and c.text]
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
    posts.append(dict(slug=slug, title=title, date=date, cats=cats, tags=tags, body=body, hero=hero,
                      excerpt=excerpt, minutes=max(1, round(len(text.split()) / 225))))

posts.sort(key=lambda p: p['date'], reverse=True)

def fdate(d): return d.strftime('%b %-d, %Y')

# ---------- shared chrome (matches existing site) ----------
def page(root, title, desc, main, extra_head=''):
    return ('<!doctype html><html lang="en"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width,initial-scale=1">'
            f'<title>{esc(title)}</title><meta name="description" content="{esc(desc)}">'
            f'<meta property="og:title" content="{esc(title)}"><meta property="og:description" content="{esc(desc)}">'
            f'<meta property="og:site_name" content="GLOWDEGA®">{extra_head}'
            f'<link rel="stylesheet" href="{root}assets/style.css"></head><body><div class="site">'
            f'<div class="bookbar"><a href="{root}book.html">NEW BOOK • PRE-ORDER / BOOK UPDATES →</a></div>'
            f'<header><a class="logo" href="{root}index.html">GLOWDEGA®</a><nav class="nav">'
            f'<a href="{root}blog.html">Gazette</a><a href="{root}book.html">The Book</a>'
            '<a href="https://www.fairyglowmother.com/">Hadiyah</a></nav><div class="right">Oakland, CA</div></header>'
            f'<main>{main}</main>'
            f'<footer><div>GLOWDEGA®<br>Oakland, California</div><div><a href="{root}blog.html">Gazette Archive</a>'
            f'<a href="{root}book.html">The Book</a></div><div><a href="https://www.fairyglowmother.com/">Fairy Glow Mother</a>'
            f'<a href="{root}privacy.html">Privacy</a></div></footer></div></body></html>\n')

def card(p, root=''):
    meta = fdate(p['date']) + (' • ' + esc(p['cats'][0]) if p['cats'] else '')
    return (f'<a class="card" href="/blog/{p["slug"]}"><div><div class="meta">{meta}</div>'
            f'<h2>{esc(p["title"])}</h2></div><div class="excerpt">{esc(p["excerpt"])}</div></a>')

# ---------- articles ----------
art_dir = os.path.join(SITE, 'blog')
os.makedirs(art_dir, exist_ok=True)
for f in os.listdir(art_dir):
    if f.endswith('.html'): os.remove(os.path.join(art_dir, f))

AUTHOR = 'Hadiyah Daché'

def article_ld(title, desc, date_iso):
    """schema.org BlogPosting for an article (functions/_lib/site.js builds the same shape for admin posts)."""
    return {'@context': 'https://schema.org', '@type': 'BlogPosting', 'headline': title, 'description': desc,
            'datePublished': date_iso, 'inLanguage': 'en-US',
            'author': {'@type': 'Person', 'name': AUTHOR, 'jobTitle': 'Licensed Esthetician',
                       'url': 'https://www.fairyglowmother.com/'},
            'publisher': {'@type': 'Organization', 'name': 'GLOWDEGA®'}}

def ld_json(data):
    return '<script type="application/ld+json">' + json.dumps(data, ensure_ascii=False).replace('</', '<\\/') + '</script>'

def article_page(title, date_iso, date_txt, cats, minutes, hero_src, body, pager, desc, root='../', jsonld=None):
    """Article page. `cats`, `body` and `pager` are HTML; everything else is plain text."""
    hero = (f'<figure class="article-image"><img src="{hero_src}" alt="" fetchpriority="high"></figure>'
            if hero_src else '')
    side = (f'<aside class="side"><div class="side-label">Written by</div><p>{AUTHOR}, licensed esthetician</p>'
            f'<div class="side-label">Published</div><p>{date_txt}</p>'
            + (f'<div class="side-label">Filed under</div><p>{cats}</p>' if cats else '')
            + f'<div class="side-label">Reading time</div><p>{minutes} min</p>'
            + f'<a href="{root}blog.html">← All articles</a><a href="{root}book.html">The Book →</a></aside>')
    main = (f'<article><div class="article-hero"><div class="eyebrow"><a href="{root}blog.html">GLOWDEGA® / THE GAZETTE</a></div>'
            f'<h1>{esc(title)}</h1><div class="article-meta"><time datetime="{date_iso}">{date_txt}</time>'
            + (f'<span>{cats}</span>' if cats else '') + f'<span>{minutes} min read</span></div></div>'
            f'{hero}<div class="article-layout"><div class="prose">{body}</div>{side}</div></article>'
            f'<section class="grid"><div class="grid-head"><span>Keep reading</span><a href="{root}blog.html">All articles →</a></div>'
            f'<div class="post-grid post-grid--pair">{pager}</div></section>')
    head = (f'<meta property="og:type" content="article"><meta property="article:published_time" content="{date_iso}">'
            + (jsonld if jsonld is not None else ld_json(article_ld(title, desc, date_iso))))
    return page(root, f'{title} — GLOWDEGA®', desc, main, head)

for i, p in enumerate(posts):
    root = '../'
    newer = posts[i - 1] if i > 0 else None
    older = posts[i + 1] if i + 1 < len(posts) else None
    pager = ''.join(card(q, root).replace('<div class="meta">', f'<div class="meta">{label} • ', 1)
                    for label, q in (('Newer', newer), ('Older', older)) if q)
    open(os.path.join(art_dir, p['slug'] + '.html'), 'w').write(article_page(
        p['title'], f"{p['date']:%Y-%m-%d}", fdate(p['date']), ' • '.join(esc(c) for c in p['cats']), p['minutes'],
        root + p['hero'] if p['hero'] else None, p['body'].replace('{root}', root), pager, p['excerpt']))

# ---------- data + template for posts published from the admin (functions/) ----------
os.makedirs(os.path.join(SITE, 'assets', 'templates'), exist_ok=True)
json.dump([dict(slug=p['slug'], title=p['title'], date=f"{p['date']:%Y-%m-%dT%H:%M:%S}",
                category=(p['cats'] or [''])[0], excerpt=p['excerpt']) for p in posts],
          open(os.path.join(SITE, 'assets', 'posts.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
open(os.path.join(SITE, 'assets', 'templates', 'article.html'), 'w').write(article_page(
    '%%TITLE%%', '%%DATE_ISO%%', '%%DATE%%', '%%CATS%%', '%%MINUTES%%', '%%HERO%%', '%%BODY%%', '%%PAGER%%', '%%DESC%%',
    jsonld='%%JSONLD%%')
    .replace('<figure class="article-image"><img src="%%HERO%%" alt="" fetchpriority="high"></figure>', '%%HERO_FIGURE%%')
    .replace('<div class="side-label">Filed under</div><p>%%CATS%%</p>', '%%SIDE_CATS%%')
    .replace('<span>%%CATS%%</span>', '%%META_CATS%%'))

# ---------- blog index (newest first, grouped by year) ----------
years = sorted({p['date'].year for p in posts}, reverse=True)
nav = ''.join(f'<a class="pill" href="#y{y}">{y}</a>' for y in years)
groups = ''.join(
    f'<section class="grid" id="y{y}"><div class="grid-head"><span>{y}</span><span>{sum(1 for p in posts if p["date"].year == y)} posts</span></div>'
    f'<div class="post-grid">' + ''.join(card(p) for p in posts if p['date'].year == y) + '</div></section>'
    for y in years)
main = (f'<section class="page-shell"><div class="eyebrow">GLOWDEGA® / THE GAZETTE</div><h1>THE<br>ARCHIVE</h1>'
        f'<p class="archive-count">{len(posts)} articles, newest first.</p><nav class="archive-nav" aria-label="Jump to year">{nav}</nav></section>{groups}')
open(os.path.join(SITE, 'blog.html'), 'w').write(
    page('', 'The Gazette — GLOWDEGA®', f'The GLOWDEGA® Gazette archive: {len(posts)} articles on skin care, acne, ingredients, and studio life.', main))

# ---------- 404 (also stops Pages serving the home page for unknown URLs) ----------
open(os.path.join(SITE, '404.html'), 'w').write(page('/', 'Page not found — GLOWDEGA®', 'This page does not exist.',
    '<section class="page-shell"><div class="eyebrow">GLOWDEGA® / 404</div><h1>NOT<br>FOUND</h1>'
    '<div class="page-copy"><p>This page doesn’t exist, or it has moved.</p></div>'
    '<p><a class="cta" href="/blog">Browse the Gazette →</a></p></section>'))

# ---------- home: replace the post grid with the 12 newest ----------
idx_path = os.path.join(SITE, 'index.html')
idx = open(idx_path).read()
start = idx.index('<div class="post-grid">')
end = idx.index('<p style="margin-top:24px">', start)
idx = idx[:start] + '<div class="post-grid">' + ''.join(card(p) for p in posts[:12]) + '</div>' + idx[end:]
idx = re.sub(r'(\d+)( published posts| POSTS)', lambda m: f'{len(posts)}{m.group(2)}', idx)
open(idx_path, 'w').write(idx)

print(f'\nbuilt {len(posts)} articles; {sum(1 for v in cache.values() if v)} images saved, {sum(1 for v in cache.values() if not v)} dead')

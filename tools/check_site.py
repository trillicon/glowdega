"""Check the built site keeps its layout rules. Exits 1 and names each failure.

usage: python3 -I tools/check_site.py .
"""
import glob, json, os, re, sys

SITE = sys.argv[1]
fails = []

def read(p): return open(os.path.join(SITE, p), encoding='utf-8').read()
def check(ok, msg):
    if not ok: fails.append(msg)

pages = [os.path.relpath(p, SITE) for p in glob.glob(os.path.join(SITE, '*.html'))
         + glob.glob(os.path.join(SITE, 'pages', '*.html')) + glob.glob(os.path.join(SITE, 'blog', '*.html'))]
NAV = ['The Glow Gazette', 'About Hadiyah', 'Esthetician Directory']
DATE = re.compile(r'class="meta">[A-Z][a-z]{2} \d{1,2}, \d{4}')

for p in pages:
    head = re.search(r'<header>.*?</header>', read(p), re.S)
    check(head and re.findall(r'<nav class="nav">(.*?)</nav>', head.group(0)) and
          re.findall(r'>([^<]+)</a>', re.search(r'<nav class="nav">(.*?)</nav>', head.group(0)).group(1)) == NAV,
          f'{p}: header nav is not {NAV}')
    foot = re.search(r'<footer>.*?</footer>', read(p), re.S)
    check(foot and re.search(r'<a href="(\.\./|/)?affiliate-disclosure\.html">Affiliate Disclosure</a>', foot.group(0)),
          f'{p}: footer lacks the Affiliate Disclosure link')
    check(head and 'class="book-pill"' in head.group(0) and 'GET THE BOOK' in head.group(0) and 'Oakland' not in head.group(0),
          f'{p}: header lacks the GET THE BOOK pill')

home = read('index.html')
grid = re.search(r'<div class="post-grid">(.*?)</div><p style', home, re.S).group(1)
WELCOME = ('GLOWDEGA® was an inclusive skin studio created by Hadiyah Daché in Oakland, CA and open to all humans '
           'with skin. We officially closed our doors on April 30, 2026.',
           '<strong>THIS IS THE GLOWDEGA ARCHIVE</strong>. Over 100 articles and advice on skin health including acne, '
           'hyperpigmentation, skincare routine help and more! While the physical location is no more, help will always '
           'be here just one click away!')
check(re.search(r'<div class="hero-copy">(.*?)</div>', home, re.S).group(1) == ''.join(f'<p>{w}</p>' for w in WELCOME),
      'home: welcome text is not the approved copy')
check(re.search(r'<meta name="description" content="([^"]*)"', home).group(1) == 'The Glowdega® archive by Hadiyah Daché.',
      'home: search description is not the approved copy')
check(grid.count('class="card"') == 12, 'home: expected 12 cards')
check(not DATE.search(grid), 'home: cards show dates')
check(len(DATE.findall(read('blog.html'))) >= 100, 'blog.html: archive cards lost their dates')
check('THE GLOW<br>GAZETTE' in read('blog.html'), 'blog.html: not titled The Glow Gazette')
check('Coming soon' in read('esthetician-directory.html'), 'esthetician-directory: not marked coming soon')

disc = read('affiliate-disclosure.html')
check('<h1>Affiliate Disclosure</h1>' in disc and 'href="mailto:book@fairyglowmother.com"' in disc
      and '<em>Last updated: October 2026</em>' in disc, 'affiliate-disclosure.html: missing title, email link or date')

# Ad slots: house ads for the book ship in the page; functions/blog/[slug].js swaps in real ads (functions/_lib/ads.js).
# Must match tools/build.py and functions/_lib/site.js.
HOUSE_RAIL = ('<div class="ad-slot ad-slot--rail ad-slot--house"><a class="house-ad house-ad--rail" href="/book">'
              '<span class="house-ad__label">Advertisement</span><span class="house-ad__main"><span class="house-ad__kicker">The book</span>'
              '<strong class="house-ad__title">Under Your Skin</strong><span class="house-ad__by">by Hadiyah Daché</span></span>'
              '<span class="house-ad__cta">Get the book →</span></a></div>')
HOUSE_INLINE = ('<div class="ad-slot ad-slot--inline ad-slot--house" data-ad-slot="inline" aria-label="Advertisement">'
                '<a class="house-ad house-ad--inline" href="/book"><span class="house-ad__label">Advertisement</span>'
                '<strong class="house-ad__title">Under Your Skin</strong><span class="house-ad__by">the book by Hadiyah Daché</span>'
                '<span class="house-ad__cta">Get the book →</span></a></div>')
AD_RAIL = '<aside class="ad-rail" aria-label="Advertisement" data-ad-slot="rail">' + HOUSE_RAIL + '</aside>'
AFFILIATE_NOTE = ('Friendly reminder: this post contains affiliate links, which help support the Glowdega Archive. '
                  'If you buy through them, I may earn a commission at no extra cost to you.')
NOTE_P = f'<p class="affiliate-note">{AFFILIATE_NOTE}</p>'
TAXONOMY = {c['name']: c['slug'] for c in json.loads(read('assets/taxonomy.json'))}
check(len(TAXONOMY) == 13, 'assets/taxonomy.json: expected the 13 approved categories')
TERM = re.compile(r'^[a-z0-9]+(?:-[a-z0-9]+)*$')
archive = {p['slug']: p for p in json.loads(read('assets/posts.json'))}

for p in [p for p in pages if p.startswith('blog' + os.sep)]:
    doc = read(p)
    keep = re.search(r'post-grid--four">(.*?)</section>', doc, re.S)
    check(keep and keep.group(1).count('class="card"') >= 4, f'{p}: fewer than 4 related posts')
    top = re.search(r'<div class="article-top">(.*?)</div><hr class="article-rule">', doc, re.S)
    check(top and 'class="article-info"' in top.group(1), f'{p}: metadata not beside the photo')
    check(top and ('<figure' not in top.group(1) or top.group(1).index('<figure') < top.group(1).index('article-info')),
          f'{p}: photo is not left of the metadata')
    check(re.search(r'<hr class="article-rule">' + re.escape(HOUSE_INLINE) + r'<div class="article-layout"><div class="prose">'
                    + re.escape(NOTE_P), doc),
          f'{p}: text does not start under the separator and inline house ad, with the affiliate note first')
    check(doc.count('data-ad-slot="inline"') == 1 and doc.count('data-ad-slot="rail"') == 1, f'{p}: expected one inline and one rail ad slot')
    check(AD_RAIL in doc, f'{p}: right column is not the ad rail with the house ad')
    slug = os.path.splitext(os.path.basename(p))[0]
    terms = re.findall(r'<article data-ad-terms="([^"]*)">', doc)
    check(len(terms) == 1 and all(TERM.match(t) for t in terms[0].split()), f'{p}: <article> lacks valid data-ad-terms')
    check(slug in archive and archive[slug]['category'] in TAXONOMY and len(archive[slug]['categories']) == 1
          and archive[slug]['categories'][0] == {'slug': TAXONOMY[archive[slug]['category']], 'name': archive[slug]['category']},
          f'{p}: not filed under exactly one approved category')
    filed = re.search(r'<div class="side-label">Filed under</div><p data-terms="category">([^<]*)</p><p class="article-tags" data-terms="tags">', doc)
    check(filed and slug in archive and filed.group(1) == archive[slug]['category'].replace('&', '&amp;'),
          f'{p}: "Filed under" is not its category')
    if slug in archive and terms:
        want = []
        for t in archive[slug].get('categories', []) + archive[slug].get('tags', []):
            if t['slug'] not in want: want.append(t['slug'])
        check(terms[0].split() == want, f'{p}: data-ad-terms do not match the categories and tags in posts.json')

tpl = read('assets/templates/article.html')
check('../' not in tpl, 'templates/article.html: relative ../ links break /admin/preview; use root-absolute paths')
check(re.search(r'href="/assets/style\.css\?v=[0-9a-f]{10}"', tpl), 'templates/article.html: stylesheet is not /assets/style.css?v=<hash>')
check('<div class="prose">' + NOTE_P + '%%BODY%%' in tpl, 'templates/article.html: affiliate note is not first in the text')
check('%%SIDE_CATS%%' in tpl, 'templates/article.html: missing %%SIDE_CATS%%')
for marker in ('data-ad-terms="%%AD_TERMS%%"', '<aside class="ad-rail" aria-label="Advertisement" data-ad-slot="rail">%%AD_RAIL%%</aside>',
               '<hr class="article-rule">%%AD_INLINE%%<div class="article-layout">'):
    check(marker in tpl, f'templates/article.html: missing {marker}')
check(all(isinstance(p.get('tags'), list) and isinstance(p.get('categories'), list) for p in archive.values()),
      'posts.json: every post needs categories and tags lists')
check(sum(len(p['tags']) for p in archive.values()) >= 100, 'posts.json: tags were not read from the export')
check(all(TERM.match(t['slug']) and t['name'] for p in archive.values() for t in p['categories'] + p['tags']),
      'posts.json: a category or tag has a bad slug or no name')
site_js = read('functions/_lib/site.js')
for name, value in (('HOUSE_RAIL', HOUSE_RAIL), ('HOUSE_INLINE', HOUSE_INLINE), ('AFFILIATE_NOTE', AFFILIATE_NOTE)):
    check(f"{name} = '{value}'" in site_js.replace("'\n  + '", ''), f'site.js: {name} differs from the archive pages')

check('href="/cdn-cgi/access/logout"' in read('admin/index.html'), 'admin: no Log out link')

css = read('assets/style.css')
for font in re.findall(r'url\((fonts/[^)]+)\)', css):
    check(os.path.exists(os.path.join(SITE, 'assets', font)), f'style.css: missing {font}')
check('"Bricolage Grotesque"' in css and '"Spectral"' in css, 'style.css: fonts not declared')

for f in fails: print('FAIL', f)
print(f'{len(pages)} pages checked, {len(fails)} failures')
sys.exit(1 if fails else 0)

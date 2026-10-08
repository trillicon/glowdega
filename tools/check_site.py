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

# Ad slots, filled per request by functions/blog/[slug].js (functions/_lib/ads.js); must match tools/build.py.
RAIL_PLACEHOLDER = '<div class="ad-slot ad-slot--rail"><span>Advertisement</span><small>300 × 600</small></div>'
AD_RAIL = '<aside class="ad-rail" aria-label="Advertisement" data-ad-slot="rail">' + RAIL_PLACEHOLDER + '</aside>'
AD_INLINE = '<div class="ad-slot ad-slot--inline" data-ad-slot="inline" aria-label="Advertisement" hidden></div>'
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
    check(re.search(r'<hr class="article-rule">' + re.escape(AD_INLINE) + r'<div class="article-layout"><div class="prose">', doc),
          f'{p}: text does not start under the separator, after the hidden inline ad slot')
    check(doc.count('data-ad-slot="inline"') == 1 and doc.count('data-ad-slot="rail"') == 1, f'{p}: expected one inline and one rail ad slot')
    check(AD_RAIL in doc, f'{p}: right column is not the ad rail with its placeholder')
    slug = os.path.splitext(os.path.basename(p))[0]
    terms = re.findall(r'<article data-ad-terms="([^"]*)">', doc)
    check(len(terms) == 1 and all(TERM.match(t) for t in terms[0].split()), f'{p}: <article> lacks valid data-ad-terms')
    if slug in archive and terms:
        want = []
        for t in archive[slug].get('categories', []) + archive[slug].get('tags', []):
            if t['slug'] not in want: want.append(t['slug'])
        check(terms[0].split() == want, f'{p}: data-ad-terms do not match the categories and tags in posts.json')

tpl = read('assets/templates/article.html')
for marker in ('data-ad-terms="%%AD_TERMS%%"', '<aside class="ad-rail" aria-label="Advertisement" data-ad-slot="rail">%%AD_RAIL%%</aside>',
               '<hr class="article-rule">%%AD_INLINE%%<div class="article-layout">'):
    check(marker in tpl, f'templates/article.html: missing {marker}')
check(all(isinstance(p.get('tags'), list) and isinstance(p.get('categories'), list) for p in archive.values()),
      'posts.json: every post needs categories and tags lists')
check(sum(len(p['tags']) for p in archive.values()) >= 100, 'posts.json: tags were not read from the export')
check(all(TERM.match(t['slug']) and t['name'] for p in archive.values() for t in p['categories'] + p['tags']),
      'posts.json: a category or tag has a bad slug or no name')
site_js = read('functions/_lib/site.js')
check("RAIL_PLACEHOLDER = '" + RAIL_PLACEHOLDER + "'" in site_js, 'site.js: RAIL_PLACEHOLDER differs from the archive pages')

check('href="/cdn-cgi/access/logout"' in read('admin/index.html'), 'admin: no Log out link')

css = read('assets/style.css')
for font in re.findall(r'url\((fonts/[^)]+)\)', css):
    check(os.path.exists(os.path.join(SITE, 'assets', font)), f'style.css: missing {font}')
check('"Bricolage Grotesque"' in css and '"Spectral"' in css, 'style.css: fonts not declared')

for f in fails: print('FAIL', f)
print(f'{len(pages)} pages checked, {len(fails)} failures')
sys.exit(1 if fails else 0)

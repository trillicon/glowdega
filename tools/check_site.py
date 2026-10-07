"""Check the built site keeps its layout rules. Exits 1 and names each failure.

usage: python3 -I tools/check_site.py .
"""
import glob, os, re, sys

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
check(grid.count('class="card"') == 12, 'home: expected 12 cards')
check(not DATE.search(grid), 'home: cards show dates')
check(len(DATE.findall(read('blog.html'))) >= 100, 'blog.html: archive cards lost their dates')
check('THE GLOW<br>GAZETTE' in read('blog.html'), 'blog.html: not titled The Glow Gazette')
check('Coming soon' in read('esthetician-directory.html'), 'esthetician-directory: not marked coming soon')

for p in [p for p in pages if p.startswith('blog' + os.sep)]:
    doc = read(p)
    keep = re.search(r'post-grid--four">(.*?)</section>', doc, re.S)
    check(keep and keep.group(1).count('class="card"') >= 4, f'{p}: fewer than 4 related posts')
    top = re.search(r'<div class="article-top">(.*?)</div><hr class="article-rule">', doc, re.S)
    check(top and 'class="article-info"' in top.group(1), f'{p}: metadata not beside the photo')
    check(top and ('<figure' not in top.group(1) or top.group(1).index('<figure') < top.group(1).index('article-info')),
          f'{p}: photo is not left of the metadata')
    check(re.search(r'<hr class="article-rule">(<div class="ad-slot ad-slot--inline"[^>]*>.*?</div>)?<div class="article-layout">'
                    r'<div class="prose">', doc, re.S), f'{p}: text does not start under the separator')
    check('class="ad-rail"' in doc, f'{p}: right column is not the ad placeholder')

css = read('assets/style.css')
for font in re.findall(r'url\((fonts/[^)]+)\)', css):
    check(os.path.exists(os.path.join(SITE, 'assets', font)), f'style.css: missing {font}')
check('"Bricolage Grotesque"' in css and '"Spectral"' in css, 'style.css: fonts not declared')

for f in fails: print('FAIL', f)
print(f'{len(pages)} pages checked, {len(fails)} failures')
sys.exit(1 if fails else 0)

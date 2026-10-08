// Sharing without a server: the Web Share API where the browser has it; otherwise a downloadable share card
// (1080×1920 story, 1200×675 social), Copy link and email. Websites cannot post to Instagram, TikTok or Threads
// for someone, so the page hands over the image and the person posts it themselves.

const INK = '#111111', PAPER = '#f7f5ef', ACID = '#dfff00', MUTED = '#6c6b65';
export const CARD_SIZES = { story: [1080, 1920], social: [1200, 675] };

/** The short, non-sensitive text that is shared: calculator name, primary result, one-line insight, link. */
export function shareText({ name, url, view }) {
  return `${name}: ${view.share?.value ?? view.primary.value} ${view.share?.label ?? view.primary.label}. ${view.share?.insight ?? ''}`.trim() + `\n${url}`;
}

export function emailHref({ name, url, view }) {
  const lines = [`${name}`, '', `${view.primary.label}: ${view.primary.value}`];
  if (view.primary.note) lines.push(view.primary.note);
  for (const c of view.cards || []) lines.push(`${c.label}: ${c.value}`);
  if (view.insight) lines.push('', view.insight);
  lines.push('', `Calculator: ${url}`, '', 'Estimates are for educational purposes and are not tax, accounting, or legal advice.');
  return `mailto:?subject=${encodeURIComponent('My Beauty Business Calculator Results')}&body=${encodeURIComponent(lines.join('\n'))}`;
}

async function fontsReady() {
  try {
    await Promise.all(['700 80px "Bricolage Grotesque"', '300 40px "Spectral"', '700 30px "DM Sans"'].map((f) => document.fonts.load(f)));
  } catch { /* fall back to system fonts */ }
}

function wrap(ctx, text, maxWidth) {
  const words = String(text).split(/\s+/), lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = w; } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

/** Draw a share card; returns a canvas. Shows the calculator, the main result, the insight, the link and branding only. */
export async function drawCard(kind, { name, url, view }) {
  await fontsReady();
  const [W, H] = CARD_SIZES[kind];
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  const story = kind === 'story';
  const pad = story ? 90 : 64;
  const display = '"Bricolage Grotesque","DM Sans",Arial,sans-serif';
  x.fillStyle = PAPER; x.fillRect(0, 0, W, H);
  // brand band
  const band = story ? 190 : 96;
  x.fillStyle = ACID; x.fillRect(0, 0, W, band);
  x.fillStyle = INK; x.fillRect(0, band, W, 3);
  x.font = `700 ${story ? 72 : 44}px ${display}`; x.textBaseline = 'middle';
  x.fillText('GLOWDEGA®', pad, band / 2);
  x.font = `700 ${story ? 26 : 18}px "DM Sans",Arial,sans-serif`; x.textAlign = 'right';
  x.fillText('FREE BEAUTY BUSINESS TOOLS', W - pad, band / 2);
  x.textAlign = 'left'; x.textBaseline = 'alphabetic';

  const width = story ? W - pad * 2 : W * 0.56 - pad;
  let y = band + (story ? 170 : 90);
  x.fillStyle = MUTED; x.font = `700 ${story ? 30 : 20}px "DM Sans",Arial,sans-serif`;
  x.fillText(name.toUpperCase(), pad, y, W - pad * 2);
  y += story ? 250 : 130;
  x.fillStyle = INK;
  const value = view.share?.value ?? view.primary.value;
  let size = story ? 230 : 130;
  x.font = `700 ${size}px ${display}`;
  while (x.measureText(value).width > width && size > 40) { size -= 8; x.font = `700 ${size}px ${display}`; }
  x.fillText(value, pad, y);
  y += story ? 90 : 56;
  x.font = `500 ${story ? 50 : 30}px ${display}`;
  for (const l of wrap(x, view.share?.label ?? view.primary.label, width).slice(0, 2)) { x.fillText(l, pad, y); y += story ? 62 : 38; }

  const insight = view.share?.insight ?? view.insight ?? '';
  x.font = `300 ${story ? 46 : 26}px "Spectral",Georgia,serif`;
  let iy = story ? y + 120 : band + 90;
  const ix = story ? pad : W * 0.6;
  const iw = story ? W - pad * 2 : W * 0.4 - pad;
  if (!story) { x.fillStyle = INK; x.fillRect(ix - 28, band + 50, 2, H - band - 160); }
  x.fillStyle = INK;
  for (const l of wrap(x, insight, iw).slice(0, story ? 7 : 8)) { x.fillText(l, ix, iy); iy += story ? 64 : 36; }

  // footer: link
  x.fillStyle = INK; x.fillRect(0, H - (story ? 170 : 74), W, 2);
  x.font = `700 ${story ? 32 : 20}px "DM Sans",Arial,sans-serif`;
  x.fillText(url.replace(/^https?:\/\//, ''), pad, H - (story ? 80 : 30), W - pad * 2);
  return c;
}

const toBlob = (canvas) => new Promise((res) => canvas.toBlob(res, 'image/png'));

export async function downloadCard(kind, data) {
  const blob = await toBlob(await drawCard(kind, data));
  if (!blob) return false;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `glowdega-${data.url.split('/').filter(Boolean).pop() || 'results'}-${kind}.png`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return true;
}

/** Native share sheet when the browser has one. Returns true if the sheet handled it (or was dismissed by the user). */
export async function shareResults(data) {
  if (!navigator.share) return false;
  const base = { title: data.name, text: shareText(data).replace(`\n${data.url}`, ''), url: data.url };
  try {
    let files;
    try {
      const blob = await toBlob(await drawCard('story', data));
      if (blob) files = [new File([blob], 'glowdega-results.png', { type: 'image/png' })];
    } catch { files = undefined; }
    if (files && navigator.canShare?.({ ...base, files })) await navigator.share({ ...base, files });
    else await navigator.share(base);
    return true;
  } catch (e) {
    return e?.name === 'AbortError';
  }
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
  const t = document.createElement('textarea');
  t.value = text; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
  document.body.append(t); t.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  t.remove();
  return ok;
}

export function wirePanel(panel, getData) {
  const status = panel.querySelector('.calc-share-status');
  const say = (m) => { if (status) status.textContent = m; };
  panel.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-share]');
    if (!b) return;
    const data = getData();
    if (!data.view) return;
    const kind = b.dataset.share;
    if (kind === 'story' || kind === 'social') {
      say((await downloadCard(kind, data)) ? `${kind === 'story' ? 'Story' : 'Social'} card downloaded. Add it from your photos in the app.` : 'Your browser could not create the image.');
    } else if (kind === 'copy') {
      say((await copyText(data.url)) ? 'Link copied.' : `Copy this link: ${data.url}`);
    } else if (kind === 'email') {
      b.href = emailHref(data);
    }
  });
}
export { wirePanel as wireSharePanel };

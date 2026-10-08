// Ads view (#ads). Talks to /api/admin/ads; images go to R2 under ads/. Serving rules: functions/_lib/ads.js.
const $ = (s) => document.querySelector(s);
const MAX_BYTES = 10 * 1024 * 1024;
const TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const SIZE_LABEL = { rail: 'Rail 300 × 600', inline: 'Banner 728 × 90' };
const STATE_LABEL = { running: 'Running', scheduled: 'Scheduled', ended: 'Ended', paused: 'Paused' };

let deps;            // { toast, confirmStep } from admin.js
let loaded = false;
let ads = [];
let terms = [];      // [{slug, name, kinds, count}]
let picked = new Set();
let editing = null;  // ad being edited, or null for a new one

async function call(path = '', { method = 'GET', body, json } = {}) {
  const headers = { 'x-glowdega-admin': '1' };
  if (json) { headers['content-type'] = 'application/json'; body = JSON.stringify(json); }
  const res = await fetch('/api/admin/ads' + path, { method, body, headers, credentials: 'same-origin' });
  let data = {};
  try { data = await res.json(); } catch { /* non-JSON error page */ }
  if (res.status === 403 && !data.error) throw new Error('Your admin login has expired. Reload the page to sign in again.');
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// Dates: the form uses whole days in the browser's time zone. An end date is the last day shown, so the ad
// stops at the following midnight.
const pad = (n) => String(n).padStart(2, '0');
const localDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const startIso = (v) => v ? new Date(v + 'T00:00').toISOString() : '';
const endIso = (v) => { if (!v) return ''; const d = new Date(v + 'T00:00'); d.setDate(d.getDate() + 1); return d.toISOString(); };
const startDay = (iso) => iso ? localDay(new Date(iso)) : '';
const endDay = (iso) => iso ? localDay(new Date(Date.parse(iso) - 1)) : '';
const nice = (day) => day ? new Date(day + 'T00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';

function schedule(ad) {
  const s = nice(startDay(ad.starts_at)), e = nice(endDay(ad.ends_at));
  if (s && e) return `${s} – ${e}`;
  if (s) return `From ${s}`;
  if (e) return `Until ${e}`;
  return 'No end date';
}

const termName = (slug) => (terms.find((t) => t.slug === slug) || { name: slug }).name;
const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };

// ---------- list ----------
function row(ad) {
  const li = el('li', { className: 'ad-item' });
  li.dataset.id = ad.id;
  const thumb = el('a', { href: ad.image_url, target: '_blank', rel: 'noopener', className: 'ad-thumb ' + ad.size },
    el('img', { src: ad.image_url, alt: '', loading: 'lazy', decoding: 'async' }));
  const badge = el('span', { className: 'badge ' + ad.state, textContent: STATE_LABEL[ad.state] || ad.state });
  const title = el('div', { className: 'ad-title' }, el('strong', { textContent: ad.name }), badge);
  const where = [ad.is_default && 'Default', ...ad.targets.map(termName)].filter(Boolean).join(', ') || 'Nowhere';
  const link = el('a', { href: ad.link_url, target: '_blank', rel: 'noopener', className: 'ad-url', textContent: ad.link_url });
  const meta = el('p', { className: 'ad-meta' },
    el('span', { textContent: SIZE_LABEL[ad.size] }), el('span', { textContent: schedule(ad) }));
  const on = el('p', { className: 'ad-targets', textContent: 'Shows on: ' + where });
  const ctr = ad.views ? `${((ad.clicks / ad.views) * 100).toFixed(2)}%` : '—';
  const stats = el('dl', { className: 'ad-stats' },
    el('div', {}, el('dt', { textContent: 'Views' }), el('dd', { textContent: ad.views.toLocaleString() })),
    el('div', {}, el('dt', { textContent: 'Clicks' }), el('dd', { textContent: ad.clicks.toLocaleString() })),
    el('div', {}, el('dt', { textContent: 'CTR' }), el('dd', { textContent: ctr })));
  const btn = (act, text, cls = '') => { const b = el('button', { type: 'button', textContent: text, className: cls }); b.dataset.act = act; return b; };
  const actions = el('div', { className: 'tile-actions' },
    btn('toggle', ad.status === 'paused' ? 'Resume' : 'Pause'), btn('edit', 'Edit'), btn('delete', 'Delete', 'danger'));
  li.append(thumb, el('div', { className: 'ad-body' }, title, link, meta, on, stats, actions));
  return li;
}

function renderList() {
  $('#adList').replaceChildren(...ads.map(row));
  $('#adEmpty').hidden = ads.length > 0;
  const running = ads.filter((a) => a.state === 'running').length;
  $('#adCount').textContent = ads.length ? `${ads.length} ad${ads.length === 1 ? '' : 's'} • ${running} running` : '';
}

// ---------- targets picker ----------
function renderTerms() {
  const q = $('#termSearch').value.trim().toLowerCase();
  const known = new Set(terms.map((t) => t.slug));
  const all = [...terms, ...[...picked].filter((s) => !known.has(s)).map((slug) => ({ slug, name: slug, kinds: [], count: 0 }))];
  const shown = all.filter((t) => !q || t.name.toLowerCase().includes(q) || t.slug.includes(q));
  $('#termList').replaceChildren(...shown.slice(0, 300).map((t) => {
    const box = el('input', { type: 'checkbox', value: t.slug, checked: picked.has(t.slug) });
    const kind = t.kinds.includes('category') ? 'Category' : t.kinds.length ? 'Tag' : 'Unused';
    return el('li', {}, el('label', { className: 'check' }, box, el('span', { textContent: t.name }),
      el('small', { textContent: `${kind} • ${t.count} post${t.count === 1 ? '' : 's'}` })));
  }));
  if (!shown.length) $('#termList').replaceChildren(el('li', { className: 'empty', textContent: 'No category or tag matches.' }));
  $('#picked').textContent = picked.size ? `Selected: ${[...picked].map(termName).join(', ')}` : 'Nothing selected.';
}

// ---------- form ----------
const IMG_TEXT = '<strong>Drop the ad image here</strong> or click to choose. JPG, PNG, WebP or GIF, up to 10 MB.';

function resetForm(ad = null) {
  editing = ad;
  const f = $('#adForm');
  const F = f.elements;   // form.name would be the form's own name, so read fields from .elements
  f.reset();
  picked = new Set(ad ? ad.targets : []);
  $('#adFormTitle').textContent = ad ? `Edit “${ad.name}”` : 'New ad';
  $('#adCancel').hidden = !ad;
  $('#adSave').textContent = ad ? 'Save changes' : 'Create ad';
  $('#adImgText').innerHTML = ad ? '<strong>Replace the image</strong> (optional). Drop a file or click to choose.' : IMG_TEXT;
  const prev = $('#adImgPreview');
  prev.hidden = !ad;
  if (ad) prev.src = ad.image_url;
  if (ad) {
    F.name.value = ad.name; F.link_url.value = ad.link_url; F.alt.value = ad.alt; F.size.value = ad.size;
    F.is_default.checked = ad.is_default; F.starts.value = startDay(ad.starts_at); F.ends.value = endDay(ad.ends_at);
  }
  $('#termSearch').value = '';
  renderTerms();
}

function checkFile(file) {
  if (!TYPES.includes(file.type)) throw new Error(`${file.name} is not a JPG, PNG, WebP or GIF image.`);
  if (file.size > MAX_BYTES) throw new Error(`${file.name} is larger than 10 MB.`);
}

async function submit() {
  const f = $('#adForm');
  const F = f.elements;
  const file = F.image.files[0];
  if (!editing && !file) throw new Error('Choose an image for the ad.');
  if (file) checkFile(file);
  if (!/^https:\/\//i.test(F.link_url.value.trim())) throw new Error('The link must start with https://.');
  if (F.starts.value && F.ends.value && F.ends.value < F.starts.value) throw new Error('The end date must be on or after the start date.');
  if (!picked.size && !F.is_default.checked) throw new Error('Pick at least one category or tag, or make it a default ad.');
  const body = new FormData();
  body.append('name', F.name.value);
  body.append('link_url', F.link_url.value.trim());
  body.append('alt', F.alt.value);
  body.append('size', F.size.value);
  body.append('targets', JSON.stringify([...picked]));
  body.append('is_default', F.is_default.checked ? '1' : '0');
  body.append('starts_at', startIso(F.starts.value));
  body.append('ends_at', endIso(F.ends.value));
  if (file) body.append('image', file, file.name);
  const btn = $('#adSave');
  btn.disabled = true;
  try {
    const { ad } = editing
      ? await call('/' + editing.id, { method: 'PUT', body })
      : await call('', { method: 'POST', body });
    deps.toast(editing ? 'Ad saved.' : 'Ad created.');
    resetForm();
    await refresh();
    document.querySelector(`.ad-item[data-id="${ad.id}"]`)?.classList.add('fresh');
  } finally {
    btn.disabled = false;
  }
}

async function refresh() {
  ads = (await call()).ads;
  renderList();
}

export function initAds(d) {
  deps = d;
  const f = $('#adForm');
  const F = f.elements;
  $('#adImgText').innerHTML = IMG_TEXT;
  f.addEventListener('submit', (e) => { e.preventDefault(); submit().catch((err) => deps.toast(err.message, true)); });
  F.image.addEventListener('change', () => {
    const file = F.image.files[0];
    if (!file) return;
    try { checkFile(file); } catch (err) { F.image.value = ''; deps.toast(err.message, true); return; }
    const prev = $('#adImgPreview');
    prev.src = URL.createObjectURL(file);
    prev.hidden = false;
    $('#adImgText').textContent = file.name;
    if (!F.name.value) F.name.value = file.name.replace(/\.[^.]+$/, '');
  });
  const drop = $('#adDrop');
  for (const ev of ['dragenter', 'dragover']) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); });
  for (const ev of ['dragleave', 'drop']) drop.addEventListener(ev, () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    if (!e.dataTransfer.files.length) return;
    F.image.files = e.dataTransfer.files;
    F.image.dispatchEvent(new Event('change'));
  });
  $('#adCancel').addEventListener('click', () => resetForm());
  $('#termSearch').addEventListener('input', renderTerms);
  $('#termSearch').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });
  $('#termList').addEventListener('change', (e) => {
    const box = e.target.closest('input[type=checkbox]');
    if (!box) return;
    if (box.checked) picked.add(box.value); else picked.delete(box.value);
    $('#picked').textContent = picked.size ? `Selected: ${[...picked].map(termName).join(', ')}` : 'Nothing selected.';
  });

  $('#adList').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const ad = ads.find((a) => String(a.id) === btn.closest('li').dataset.id);
    if (!ad) return;
    try {
      if (btn.dataset.act === 'edit') {
        resetForm(ad);
        $('#adForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      if (btn.dataset.act === 'toggle') {
        btn.disabled = true;
        await call('/' + ad.id, { method: 'PUT', json: { status: ad.status === 'paused' ? 'active' : 'paused' } });
        deps.toast(ad.status === 'paused' ? 'Ad resumed.' : 'Ad paused.');
        return await refresh();
      }
      if (!deps.confirmStep(btn, 'Click again to delete')) return;
      btn.disabled = true;
      await call('/' + ad.id, { method: 'DELETE' });
      if (editing && editing.id === ad.id) resetForm();
      deps.toast('Ad deleted.');
      await refresh();
    } catch (err) {
      btn.disabled = false;
      deps.toast(err.message, true);
    }
  });
  resetForm();
}

export async function showAds() {
  if (loaded) return;
  try {
    const [list, t] = await Promise.all([call(), call('/terms')]);
    ads = list.ads;
    terms = t.terms;
    loaded = true;
    renderList();
    renderTerms();
  } catch (err) {
    deps.toast(err.message, true);
  }
}

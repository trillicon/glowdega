// Photo library view (#images). Uploads go to /api/admin/images, which stores them in R2.
const $ = (s) => document.querySelector(s);
const MAX_BYTES = 10 * 1024 * 1024;
const TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

let deps;          // { toast, confirmStep } from admin.js
let loaded = false;

async function call(path = '', { method = 'GET', body } = {}) {
  const res = await fetch('/api/admin/images' + path, { method, body, headers: { 'x-glowdega-admin': '1' }, credentials: 'same-origin' });
  let data = {};
  try { data = await res.json(); } catch { /* non-JSON error page */ }
  if (res.status === 403 && !data.error) throw new Error('Your admin login has expired. Reload the page to sign in again.');
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

const kb = (n) => n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
const day = (iso) => iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';

function tile(img, fresh = false) {
  const li = document.createElement('li');
  if (fresh) li.className = 'fresh';
  const a = document.createElement('a');
  a.href = img.url; a.target = '_blank'; a.rel = 'noopener';
  const pic = document.createElement('img');
  pic.src = img.url; pic.alt = ''; pic.loading = 'lazy'; pic.decoding = 'async';
  a.append(pic);
  const name = document.createElement('strong');
  name.textContent = img.name;
  const meta = document.createElement('small');
  meta.textContent = `${kb(img.size)} • ${day(img.uploaded)}`;
  const link = document.createElement('input');
  link.type = 'text'; link.readOnly = true; link.value = img.url; link.className = 'tile-link';
  link.setAttribute('aria-label', `Link to ${img.name}`);
  link.addEventListener('focus', () => link.select());
  const actions = document.createElement('div');
  actions.className = 'tile-actions';
  const copy = document.createElement('button');
  copy.type = 'button'; copy.dataset.act = 'copy'; copy.textContent = 'Copy link';
  const del = document.createElement('button');
  del.type = 'button'; del.dataset.act = 'delete'; del.dataset.key = img.key; del.className = 'danger'; del.textContent = 'Delete';
  actions.append(copy, del);
  li.append(a, name, meta, link, actions);
  return li;
}

function render(images, freshKeys = new Set()) {
  $('#grid').replaceChildren(...images.map((i) => tile(i, freshKeys.has(i.key))));
  $('#libEmpty').hidden = images.length > 0;
  $('#libCount').textContent = images.length ? `${images.length} photo${images.length === 1 ? '' : 's'}` : '';
}

async function refresh(freshKeys) {
  const data = await call();
  render(data.images, freshKeys);
}

async function upload(fileList) {
  const files = [...fileList];
  if (!files.length) return;
  const bad = files.find((f) => !TYPES.includes(f.type));
  if (bad) throw new Error(`${bad.name} is not a JPG, PNG, WebP or GIF image.`);
  const big = files.find((f) => f.size > MAX_BYTES);
  if (big) throw new Error(`${big.name} is larger than 10 MB.`);
  const drop = $('#drop');
  drop.classList.add('busy');
  $('#dropText').textContent = `Uploading ${files.length} photo${files.length === 1 ? '' : 's'}…`;
  try {
    const saved = [];
    for (let i = 0; i < files.length; i += 20) {           // the API takes up to 20 per request
      const body = new FormData();
      for (const f of files.slice(i, i + 20)) body.append('file', f, f.name);
      saved.push(...(await call('', { method: 'POST', body })).images);
    }
    await refresh(new Set(saved.map((s) => s.key)));
    deps.toast(`Uploaded ${saved.length} photo${saved.length === 1 ? '' : 's'}. Use Copy link on the highlighted ${saved.length === 1 ? 'photo' : 'photos'}.`);
  } finally {
    drop.classList.remove('busy');
    $('#dropText').innerHTML = DROP_TEXT;
    $('#files').value = '';
  }
}

// No browser dialogs here: a prompt() would freeze the page. If the clipboard is blocked, select the link instead.
async function copyLink(btn) {
  const field = btn.closest('li').querySelector('.tile-link');
  try {
    await navigator.clipboard.writeText(field.value);
    deps.toast('Link copied.');
  } catch {
    field.focus();
    field.select();
    deps.toast('Link selected. Press Cmd+C (Ctrl+C on Windows) to copy it.');
  }
}

const DROP_TEXT = '<strong>Drop photos here</strong> or click to choose. JPG, PNG, WebP or GIF, up to 10 MB each.';

export function initLibrary(d) {
  deps = d;
  $('#dropText').innerHTML = DROP_TEXT;
  const drop = $('#drop');
  const run = (files) => upload(files).catch((err) => deps.toast(err.message, true));
  $('#files').addEventListener('change', (e) => run(e.target.files));
  for (const ev of ['dragenter', 'dragover']) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); });
  for (const ev of ['dragleave', 'drop']) drop.addEventListener(ev, () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); run(e.dataTransfer.files); });

  $('#grid').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    try {
      if (btn.dataset.act === 'copy') return await copyLink(btn);
      if (!deps.confirmStep(btn, 'Click again to delete')) return;
      btn.disabled = true;
      await call('?key=' + encodeURIComponent(btn.dataset.key), { method: 'DELETE' });
      deps.toast('Photo deleted. Posts that used its link will show a broken image.');
      await refresh();
    } catch (err) {
      btn.disabled = false;
      deps.toast(err.message, true);
    }
  });
}

export async function showLibrary() {
  if (loaded) return;
  try {
    await refresh();
    loaded = true;
  } catch (err) {
    deps.toast(err.message, true);
  }
}

// Gazette review queue. Talks to /api/admin/* (Cloudflare Access protects both).
import { initLibrary, showLibrary } from './images.js';
import { initAds, showAds } from './ads.js';
import { loadTaxonomy, categoryOptions, tagInput, initTerms, showTerms, refreshTags } from './terms.js';
const $ = (s) => document.querySelector(s);
const STATES = ['draft', 'scheduled', 'published', 'rejected'];
const FIELDS = ['title', 'slug', 'category', 'excerpt', 'hero_image', 'body_md'];
const VIEWS = ['images', 'ads', 'categories'];
const tagList = (v) => { try { const a = Array.isArray(v) ? v : JSON.parse(v || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };

let posts = [];
let tab = 'draft';
let current = null;   // full post being edited
let dirty = false;
let editorTags;       // tag chips in the editor (admin/terms.js)

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch('/api/admin' + path, {
    method,
    headers: { 'x-glowdega-admin': '1', ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  let data = {};
  try { data = await res.json(); } catch { /* non-JSON error page */ }
  if (res.status === 403 && !data.error) throw new Error('Your admin login has expired. Reload the page to sign in again.');
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

let toastTimer;
function toast(msg, error = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show' + (error ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast'; }, error ? 6000 : 3000);
}

const fmt = (iso) => iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';

function renderList() {
  for (const b of document.querySelectorAll('.tabs button')) {
    b.setAttribute('aria-selected', String(b.dataset.state === tab));
    b.querySelector('b').textContent = posts.filter((p) => p.state === b.dataset.state).length;
  }
  const items = posts.filter((p) => p.state === tab);
  const list = $('#list');
  list.replaceChildren(...items.map((p) => {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = '#' + p.id;
    if (current && current.id === p.id) a.setAttribute('aria-current', 'true');
    const strong = document.createElement('strong');
    strong.textContent = p.title || '(untitled)';
    const small = document.createElement('small');
    small.textContent = {
      draft: `From ${p.source || 'unknown'} • ${fmt(p.created_at)}`,
      scheduled: `Goes live ${fmt(p.publish_at)}`,
      published: `Live since ${fmt(p.publish_at)}`,
      rejected: `Rejected ${fmt(p.reviewed_at)}`,
    }[p.state];
    a.append(strong, small);
    li.append(a);
    return li;
  }));
  const empty = $('#empty');
  empty.hidden = items.length > 0;
  empty.textContent = { draft: 'No drafts waiting for review.', scheduled: 'Nothing scheduled.', published: 'No posts published from the admin yet.', rejected: 'No rejected drafts.' }[tab];
}

function renderEditor() {
  const show = !!current;
  $('#editor').hidden = !show;
  $('#welcome').hidden = show;
  if (!show) return;
  const s = current.state;
  const badge = $('#badge');
  badge.textContent = s;
  badge.className = 'badge ' + s;
  $('#meta').textContent = [
    current.source && `From ${current.source}`,
    `Created ${fmt(current.created_at)}`,
    current.reviewed_by && `${s === 'rejected' ? 'Rejected' : 'Reviewed'} by ${current.reviewed_by}`,
    s === 'scheduled' && `Goes live ${fmt(current.publish_at)}`,
    s === 'published' && `Live since ${fmt(current.publish_at)}`,
  ].filter(Boolean).join(' • ');
  const form = $('#form');
  categoryOptions(form.elements.category, current.category || '');   // an old category stays selected until changed
  for (const f of FIELDS) if (f !== 'category') form.elements[f].value = current[f] || '';
  editorTags.set(tagList(current.tags));
  const note = $('#reviewNote');
  note.hidden = !(s === 'rejected' && current.review_note);
  note.textContent = current.review_note ? `Rejection note: ${current.review_note}` : '';
  $('#previewLink').href = `/admin/preview/${encodeURIComponent(current.id)}`;
  $('#liveLink').href = `/blog/${encodeURIComponent(current.slug)}`;
  for (const el of document.querySelectorAll('[data-show]')) el.hidden = !el.dataset.show.split(' ').includes(s);
  const when = $('#when');
  when.min = toLocalInput(new Date());
  if (!when.value) when.value = toLocalInput(new Date(Date.now() + 864e5));
  dirty = false;
}

const toLocalInput = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16);

async function loadList() {
  const data = await api('/posts');
  posts = data.posts;
  $('#who').textContent = data.admin;
  renderList();
}

// "#images" shows the photo library, "#ads" the ads, "#categories" every post's category and tags; any other hash is
// a post id.
function showView(view) {
  $('.layout').hidden = view !== 'posts';
  $('#library').hidden = view !== 'images';
  $('#adsView').hidden = view !== 'ads';
  $('#termsView').hidden = view !== 'categories';
  for (const a of document.querySelectorAll('.views a')) a.setAttribute('aria-current', String(a.dataset.view === view));
  if (view === 'images') showLibrary();
  if (view === 'ads') showAds();
  if (view === 'categories') showTerms();
}

async function open(id) {
  const view = VIEWS.includes(id) ? id : 'posts';
  showView(view);
  if (view !== 'posts') return;
  if (!id) { current = null; renderEditor(); renderList(); return; }
  try {
    current = (await api('/posts/' + encodeURIComponent(id))).post;
    tab = current.state;
  } catch (err) {
    current = null;
    toast(err.message, true);
  }
  renderList();
  renderEditor();
}

function formValues() {
  const form = $('#form');
  return { ...Object.fromEntries(FIELDS.map((f) => [f, form.elements[f].value])), tags: editorTags.get() };
}

async function save({ quiet = false } = {}) {
  const form = $('#form');
  if (!form.reportValidity()) throw new Error('Fix the highlighted fields first.');
  current = (await api('/posts/' + current.id, { method: 'PUT', body: formValues() })).post;
  dirty = false;
  refreshTags();
  if (!quiet) toast('Saved.');
}

function confirmStep(button, label) {
  if (button.dataset.armed) return true;
  button.dataset.armed = '1';
  const original = button.textContent;
  button.textContent = label;
  setTimeout(() => { delete button.dataset.armed; button.textContent = original; }, 4000);
  return false;
}

const ACTIONS = {
  save: () => save(),
  async approve() {
    if (dirty) await save({ quiet: true });
    current = (await api(`/posts/${current.id}/approve`, { method: 'POST', body: {} })).post;
    toast(`Published at /blog/${current.slug}`);
  },
  async schedule() {
    const v = $('#when').value;
    if (!v) throw new Error('Pick a date and time to schedule.');
    const t = new Date(v);
    if (t <= new Date()) throw new Error('Pick a time in the future, or use “Approve & publish now”.');
    if (dirty) await save({ quiet: true });
    current = (await api(`/posts/${current.id}/approve`, { method: 'POST', body: { publish_at: t.toISOString() } })).post;
    toast(`Scheduled for ${fmt(current.publish_at)}`);
  },
  async reject() {
    const note = prompt('Why are you rejecting this draft? (optional — saved with the post)');
    if (note === null) return;
    if (dirty) await save({ quiet: true });
    current = (await api(`/posts/${current.id}/reject`, { method: 'POST', body: { note } })).post;
    toast('Rejected.');
  },
  async unpublish(btn) {
    if (!confirmStep(btn, 'Click again to unpublish')) return;
    current = (await api(`/posts/${current.id}/unpublish`, { method: 'POST', body: {} })).post;
    toast('Unpublished. It is a draft again.');
  },
  async delete(btn) {
    if (!confirmStep(btn, 'Click again to delete forever')) return;
    await api('/posts/' + current.id, { method: 'DELETE' });
    toast('Deleted.');
    current = null;
    history.replaceState(null, '', '#');
  },
};

$('#actions').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn || !current) return;
  const buttons = [...document.querySelectorAll('#actions button')];
  buttons.forEach((b) => { b.disabled = true; });
  try {
    await ACTIONS[btn.dataset.act](btn);
    if (current) tab = current.state;
    await loadList();
    renderEditor();
  } catch (err) {
    toast(err.message, true);
  } finally {
    buttons.forEach((b) => { b.disabled = false; });
  }
});

$('#previewLink').addEventListener('click', async (e) => {
  if (!dirty) return;
  e.preventDefault();
  try { await save({ quiet: true }); window.open($('#previewLink').href, '_blank', 'noopener'); }
  catch (err) { toast(err.message, true); }
});

$('#form').addEventListener('input', () => { dirty = true; });
$('#form').addEventListener('submit', (e) => e.preventDefault());

document.querySelector('.tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-state]');
  if (!b) return;
  tab = b.dataset.state;
  renderList();
});

initLibrary({ toast, confirmStep });
initAds({ toast, confirmStep });
initTerms({ toast });
editorTags = tagInput($('#tagBox'), { onChange: () => { dirty = true; } });

window.addEventListener('hashchange', () => {
  if (dirty && !confirm('You have unsaved changes. Leave this post?')) return;
  open(location.hash.slice(1));
});
window.addEventListener('beforeunload', (e) => { if (dirty) e.preventDefault(); });

(async () => {
  // The photo library must still open if the post list fails to load.
  try { await loadTaxonomy(); } catch (err) { toast(err.message, true); }
  refreshTags();
  try { await loadList(); } catch (err) { toast(err.message, true); }
  try { await open(location.hash.slice(1)); } catch (err) { toast(err.message, true); }
})();

export { STATES };

// Categories and tags in the admin: the approved list (/assets/taxonomy.json), a tag input with autocomplete, and the
// Categories view (#categories) that re-files any post. API: /api/admin/terms (functions/api/admin/terms/).
const $ = (s) => document.querySelector(s);
const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };

let deps;               // { toast } from admin.js
let taxonomyList;       // [{slug, name, description?}]
let listing = null;     // GET /api/admin/terms
let loading = null;

export async function loadTaxonomy() {
  if (!taxonomyList) {
    const res = await fetch('/assets/taxonomy.json', { credentials: 'same-origin' });
    if (!res.ok) throw new Error('Could not load the category list.');
    taxonomyList = await res.json();
  }
  return taxonomyList;
}

async function call(path = '', { method = 'GET', json } = {}) {
  const headers = { 'x-glowdega-admin': '1' };
  if (json) headers['content-type'] = 'application/json';
  const res = await fetch('/api/admin/terms' + path, { method, headers, body: json ? JSON.stringify(json) : undefined, credentials: 'same-origin' });
  let data = {};
  try { data = await res.json(); } catch { /* non-JSON error page */ }
  if (res.status === 403 && !data.error) throw new Error('Your admin login has expired. Reload the page to sign in again.');
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

async function loadListing(force = false) {
  if (listing && !force) return listing;
  if (!loading || force) loading = call().then((d) => { listing = d; renderSuggestions(); return d; }).finally(() => { loading = null; });
  return loading;
}

// All tags in use, for autocomplete (one shared <datalist>).
function renderSuggestions() {
  let list = document.getElementById('tagSuggestions');
  if (!list) { list = el('datalist', { id: 'tagSuggestions' }); document.body.append(list); }
  list.replaceChildren(...(listing?.tags || []).map((t) => el('option', { value: t.name })));
}
export const refreshTags = () => loadListing(true).catch(() => {});

// <select> options: the approved categories, plus the post's old category (if any) so it still shows.
export function categoryOptions(select, current = '') {
  const list = taxonomyList || [];
  const names = list.map((c) => c.name);
  const opts = [el('option', { value: '', textContent: 'Choose a category…' })];
  if (current && !names.includes(current)) {
    opts.push(el('option', { value: current, textContent: `${current} (old category — pick a new one)` }));
  }
  for (const c of list) opts.push(el('option', { value: c.name, textContent: c.name, title: c.description || '' }));
  select.replaceChildren(...opts);
  select.value = current || '';
}

const tagKey = (s) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// Tags as removable chips plus a text box (autocomplete from every tag in use). Enter or comma adds a tag.
export function tagInput(box, { onChange = () => {} } = {}) {
  let tags = [];
  const chips = el('span', { className: 'chips' });
  const input = el('input', { type: 'text', placeholder: 'Add a tag', maxLength: 40, autocomplete: 'off' });
  input.setAttribute('list', 'tagSuggestions');
  input.setAttribute('aria-label', 'Add a tag');
  box.classList.add('tag-input');
  box.replaceChildren(chips, input);
  const render = () => chips.replaceChildren(...tags.map((t, i) => {
    const x = el('button', { type: 'button', textContent: '×', title: `Remove ${t}` });
    x.setAttribute('aria-label', `Remove tag ${t}`);
    x.dataset.i = i;
    return el('span', { className: 'chip' }, el('span', { textContent: t }), x);
  }));
  const add = (text) => {
    let changed = false;
    for (const part of text.split(',')) {
      const t = part.trim().replace(/\s+/g, ' ').slice(0, 40);
      if (t && tagKey(t) && !tags.some((x) => tagKey(x) === tagKey(t))) { tags.push(t); changed = true; }
    }
    if (changed) { render(); onChange(tags); }
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(input.value); input.value = ''; }
    else if (e.key === 'Backspace' && !input.value && tags.length) { tags.pop(); render(); onChange(tags); }
  });
  // Picking a suggestion from the list fires 'input' with the full value and no keydown.
  input.addEventListener('input', (e) => {
    const v = input.value;
    const picked = (!e.inputType || e.inputType === 'insertReplacementText') && !!listing?.tags.some((t) => t.name === v);
    if (v.includes(',') || picked) { add(v); input.value = ''; }
  });
  input.addEventListener('blur', () => { if (input.value.trim()) { add(input.value); input.value = ''; } });
  chips.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-i]');
    if (!b) return;
    tags.splice(Number(b.dataset.i), 1);
    render();
    onChange(tags);
  });
  return {
    get: () => { if (input.value.trim()) { add(input.value); input.value = ''; } return [...tags]; },
    set: (list) => { tags = [...(list || [])]; input.value = ''; render(); },
  };
}

// ---------- Categories view ----------
function renderCounts() {
  const filter = $('#termFilter');
  const keep = filter.value;
  const counts = listing.categories;
  const other = listing.posts.filter((p) => !taxonomyList.some((c) => c.name === p.category)).length;
  filter.replaceChildren(el('option', { value: '', textContent: `All categories (${listing.posts.length})` }),
    ...counts.map((c) => el('option', { value: c.name, textContent: `${c.name} (${c.count})` })),
    ...(other ? [el('option', { value: '\u0000other', textContent: `Old or no category (${other})` })] : []));
  filter.value = keep;
  $('#catCounts').replaceChildren(...counts.map((c) => {
    const b = el('button', { type: 'button', className: 'cat-count' }, el('strong', { textContent: c.count }), el('span', { textContent: c.name }));
    b.dataset.name = c.name;
    if (c.description) b.title = c.description;
    return el('li', {}, b);
  }));
}

function rowFor(p) {
  const li = el('li', { className: 'term-row' });
  li.dataset.slug = p.slug;
  const href = p.kind === 'archive' || p.state === 'published' ? `/blog/${p.slug}` : `/admin/preview/${p.id}`;
  const title = el('div', { className: 'term-title' },
    el('a', { href, target: '_blank', rel: 'noopener', textContent: p.title || p.slug }),
    el('small', { textContent: [p.kind === 'archive' ? 'Archive' : `Admin • ${p.state}`, p.refiled && 'Re-filed'].filter(Boolean).join(' • ') }));
  const select = el('select', { className: 'term-cat' });
  select.setAttribute('aria-label', `Category of ${p.title}`);
  categoryOptions(select, p.category);
  const tagsBox = el('div');
  const save = el('button', { type: 'button', className: 'primary', textContent: 'Save' });
  save.disabled = true;
  const changed = () => { save.disabled = false; li.classList.add('dirty'); };
  const tags = tagInput(tagsBox, { onChange: changed });
  tags.set(p.tags);
  select.addEventListener('change', changed);
  save.addEventListener('click', async () => {
    save.disabled = true;
    try {
      if (!select.value) throw new Error('Pick a category first.');
      const { post } = await call('/' + encodeURIComponent(p.slug), { method: 'PUT', json: { category: select.value, tags: tags.get() } });
      Object.assign(p, { category: post.category, tags: post.tags, refiled: p.kind === 'archive' ? true : p.refiled });
      li.classList.remove('dirty');
      deps.toast(`Saved “${p.title}”.`);
      await loadListing(true);
      renderCounts();
    } catch (err) {
      save.disabled = false;
      deps.toast(err.message, true);
    }
  });
  li.append(title, select, tagsBox, save);
  return li;
}

function renderRows() {
  const q = $('#termSearch2').value.trim().toLowerCase();
  const f = $('#termFilter').value;
  const names = taxonomyList.map((c) => c.name);
  const shown = listing.posts.filter((p) => (!f || (f === '\u0000other' ? !names.includes(p.category) : p.category === f))
    && (!q || p.title.toLowerCase().includes(q) || p.slug.includes(q) || p.tags.some((t) => t.toLowerCase().includes(q))));
  $('#termRows').replaceChildren(...shown.map(rowFor));
  $('#termShown').textContent = `${shown.length} of ${listing.posts.length} posts`;
  $('#termEmpty').hidden = shown.length > 0;
}

export function initTerms(d) {
  deps = d;
  $('#termSearch2').addEventListener('input', renderRows);
  $('#termFilter').addEventListener('change', renderRows);
  $('#catCounts').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-name]');
    if (!b) return;
    $('#termFilter').value = $('#termFilter').value === b.dataset.name ? '' : b.dataset.name;
    renderRows();
  });
}

export async function showTerms() {
  try {
    if ($('#termRows').querySelector('.dirty')) return;   // keep unsaved edits
    await Promise.all([loadTaxonomy(), loadListing(true)]);
    renderCounts();
    renderRows();
  } catch (err) {
    deps.toast(err.message, true);
  }
}

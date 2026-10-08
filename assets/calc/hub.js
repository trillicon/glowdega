// /resources/: the "I'm a…" selector personalises the calculator cards. Nothing is hidden; matching cards move first
// and say so, and links carry ?type= so each calculator opens on the right business type.
const KEY = 'glowdega.audience';
const NAMES = { solo: 'solo providers', employee: 'employees', owner: 'business owners' };
const hub = document.querySelector('[data-hub]');
if (hub) {
  const buttons = [...hub.querySelectorAll('[data-audience]')];
  const status = hub.querySelector('.hub-status');
  const apply = (type) => {
    for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.audience === type));
    for (const grid of hub.querySelectorAll('.hub-grid')) {
      const cards = [...grid.children];
      cards.forEach((c, i) => { c.dataset.order = c.dataset.order ?? String(i); });
      cards.sort((a, b) => {
        const m = (c) => (type && c.dataset.audiences.split(' ').includes(type) ? 0 : 1);
        return m(a) - m(b) || Number(a.dataset.order) - Number(b.dataset.order);
      }).forEach((c) => grid.append(c));
    }
    for (const card of hub.querySelectorAll('.hub-card')) {
      const match = !!type && card.dataset.audiences.split(' ').includes(type);
      card.classList.toggle('is-match', match);
      card.classList.toggle('is-other', !!type && !match);
      const desc = card.querySelector('.hub-card__desc');
      desc.textContent = (type && card.dataset['desc' + type[0].toUpperCase() + type.slice(1)]) || card.dataset.descDefault;
      const badge = card.querySelector('.hub-card__for');
      if (badge) badge.hidden = !match;
      const link = card.matches('a') ? card : null;
      if (link) {
        const url = new URL(link.getAttribute('href'), location.href);
        if (type && card.dataset.types?.split(' ').includes(type)) url.searchParams.set('type', type); else url.searchParams.delete('type');
        link.setAttribute('href', url.pathname.replace(/^.*\/resources\//, './') + url.search);
      }
    }
    if (status) status.textContent = type ? `Showing the calculators for ${NAMES[type]} first.` : '';
  };
  for (const card of hub.querySelectorAll('.hub-card')) card.dataset.descDefault = card.querySelector('.hub-card__desc').textContent;
  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch { saved = null; }
  buttons.forEach((b) => b.addEventListener('click', () => {
    const type = b.getAttribute('aria-pressed') === 'true' ? null : b.dataset.audience;
    try { type ? localStorage.setItem(KEY, type) : localStorage.removeItem(KEY); } catch { /* not remembered */ }
    apply(type);
  }));
  if (NAMES[saved]) apply(saved);
}

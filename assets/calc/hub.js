// /resources/: "I'm a Licensed [profession] and a [Solo Provider | Employee | Business Owner]". The calculator cards stay
// hidden until both are chosen, then only the matching ones show, linking with ?type=&profession= so each calculator
// opens pre-set. The choice is remembered, so returning visitors skip the gate and get a "Change" control instead.
// Progressive enhancement: the cards are always in the HTML, and with JavaScript off they all show and the gate does not.
import { PROFESSIONS, PROFESSION_KEY, TYPE_KEY, TYPES, profText, savedChoice, saveChoice } from './ui/professions.js';

const TYPE_NAMES = { solo: 'a Solo Provider', employee: 'an Employee', owner: 'a Business Owner' };
export const isProfession = (p) => Object.hasOwn(PROFESSIONS, p || '');
export const isType = (t) => TYPES.includes(t);

/** A card's link with the visitor's choice: ?type= only when that calculator supports the type; ?profession= always. */
export function cardHref(href, { type, profession, types = [] }) {
  const [path, query = ''] = href.split('?');
  const params = new URLSearchParams(query);
  if (isType(type) && types.includes(type)) params.set('type', type); else params.delete('type');
  if (isProfession(profession)) params.set('profession', profession); else params.delete('profession');
  const q = params.toString();
  return q ? `${path}?${q}` : path;
}

/** Does a card (data-audiences="solo owner") belong to this worker type? */
export const cardMatches = (audiences, type) => isType(type) && String(audiences || '').split(' ').includes(type);

export function chosenSentence(profession, type) {
  return `Showing the calculators for a licensed ${PROFESSIONS[profession].label} working as ${TYPE_NAMES[type]}.`;
}

const hub = typeof document !== 'undefined' ? document.querySelector('[data-hub]') : null;
if (hub) {
  const form = hub.querySelector('[data-hub-gate]');
  const body = hub.querySelector('.hub-body');
  const chosen = hub.querySelector('[data-hub-chosen]');
  const [profSelect, typeSelect] = ['profession', 'type'].map((n) => form.querySelector(`select[name="${n}"]`));
  for (const card of hub.querySelectorAll('.hub-card')) {
    card.dataset.descDefault = card.querySelector('.hub-card__desc').textContent;
    if (card.matches('a')) card.dataset.href = card.getAttribute('href');
  }

  const showCards = (profession, type) => {
    body.classList.add('is-chosen');
    for (const card of hub.querySelectorAll('.hub-card')) {
      card.hidden = !cardMatches(card.dataset.audiences, type);
      const desc = card.querySelector('.hub-card__desc');
      // a card whose examples name services (Cost Per Service) takes the chosen license's own: developer and foils for hair
      desc.textContent = (type === 'employee' && card.dataset.descEmployee)
        || (card.dataset.descProf ? profText(card.dataset.descProf, profession) : card.dataset.descDefault);
      if (card.dataset.href) card.setAttribute('href', cardHref(card.dataset.href, { type, profession, types: (card.dataset.types || '').split(' ') }));
    }
    for (const cat of hub.querySelectorAll('.hub-cat')) cat.hidden = !cat.querySelector('.hub-card:not([hidden])');
    chosen.querySelector('.hub-chosen__text').textContent = chosenSentence(profession, type);
  };
  const collapse = (focus) => {
    form.hidden = true;
    chosen.hidden = false;
    if (focus) chosen.focus();
  };
  const done = form.querySelector('[data-hub-done]');
  let changing = false; // "Change": cards update as each select changes; Done closes the picker
  const onPick = (close) => {
    const profession = profSelect.value, type = typeSelect.value;
    if (!isProfession(profession) || !isType(type)) return;
    saveChoice(PROFESSION_KEY, profession);
    saveChoice(TYPE_KEY, type);
    showCards(profession, type);
    if (!changing || close) { changing = false; done.hidden = true; collapse(true); }
  };
  profSelect.addEventListener('change', () => onPick(false));
  typeSelect.addEventListener('change', () => onPick(false));
  form.addEventListener('submit', (e) => { e.preventDefault(); onPick(true); });
  hub.querySelector('[data-hub-change]').addEventListener('click', () => {
    changing = true;
    chosen.hidden = true;
    form.hidden = false;
    done.hidden = false;
    profSelect.focus();
  });

  const savedProf = savedChoice(PROFESSION_KEY), savedType = savedChoice(TYPE_KEY);
  if (isProfession(savedProf) && isType(savedType)) {
    profSelect.value = savedProf;
    typeSelect.value = savedType;
    showCards(savedProf, savedType);
    collapse(false);
  }
}

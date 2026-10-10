// Professions change wording only: example service names in hints, placeholders, sample rows, insights, methodology
// and share text. No number on any page depends on the profession; the engine never sees it. Shared by the hub picker
// and every calculator. Every example is 60 or 90 minutes (tests/calc-views.test.mjs checks the lists).
export const PROFESSION_KEY = 'glowdega.profession';
export const TYPE_KEY = 'glowdega.audience';
export const TYPES = ['solo', 'employee', 'owner'];

const S = (name, minutes, phrase = name.toLowerCase()) => ({ name, minutes, phrase });

/**
 * services: the license's example services, signature first. name is for row placeholders ("Silk Press"), phrase for
 * sentences ("silk press"). items: product and supply examples for the Cost Per Service rows, in row order
 * (two products, a supply, another consumable). long: a service billed by the hour, for the Hourly Service Pricing
 * Calculator's wording (its length is the visitor's own, never an example length).
 */
export const PROFESSIONS = {
  esthetician: { label: 'Esthetician',
    services: [S('Signature Facial', 60), S('Chemical Peel', 60), S('Hydrafacial', 60), S('Dermaplaning', 60),
      S('Brow Lamination', 60), S('Lash Lift', 60), S('Back Facial', 90)],
    items: { product: ['Enzyme mask', 'Hyaluronic serum'], supply: 'Gloves', other: 'Single-use linens' },
    long: 'full set of lash extensions' },
  cosmetologist: { label: 'Cosmetologist/Hairstylist',
    services: [S('Silk Press', 90), S('Curly Cut', 90), S('Root Touch-Up', 90), S('Blowout', 60), S('Trim & Style', 60), S('Gloss/Toner', 60)],
    items: { product: ['Developer', 'Toner'], supply: 'Foils', other: 'Neck strips' },
    long: 'color correction' },
  manicurist: { label: 'Manicurist/Nail Technician',
    services: [S('Gel Manicure', 60), S('Acrylic Full Set', 90), S('Fill', 60), S('Spa Pedicure', 60), S('Gel-X Set', 90, 'Gel-X set')],
    items: { product: ['Gel polish', 'Tips'], supply: 'Files', other: 'Lint-free wipes' },
    long: 'hand-painted nail art set' },
  barber: { label: 'Barber',
    services: [S('Fade', 60), S('Cut & Beard', 60), S('Lineup & Shape-Up', 60), S('Hot Towel Shave', 60), S('Kids’ Cut', 60),
      S('Cut, Beard & Hot Towel Shave', 90)],
    items: { product: ['Shave cream', 'Beard oil'], supply: 'Neck strips', other: 'Disposable clipper guards' },
    long: 'freestyle hair design' },
};
export const DEFAULT_PROFESSION = 'esthetician';
export const professionOf = (p) => (Object.hasOwn(PROFESSIONS, p || '') ? p : DEFAULT_PROFESSION);
const servicesOf = (p) => PROFESSIONS[professionOf(p)].services;
const len = (minutes) => `${Number(minutes).toLocaleString('en-US', { maximumFractionDigits: 0 })}-minute`;

/** The license's long, billed-by-the-hour example: "color correction" for a hairstylist. */
export const longService = (profession) => PROFESSIONS[professionOf(profession)].long;

/** The profession's signature (first-listed) service: "60-minute signature facial", "90-minute silk press". */
export function signatureService(profession) {
  const s = servicesOf(profession)[0];
  return { minutes: s.minutes, name: s.phrase, text: `${len(s.minutes)} ${s.phrase}` };
}

/** "a 90-minute back facial" for an esthetician; any other length reads "service". */
export function serviceText(profession, minutes) {
  const name = servicesOf(profession).find((s) => s.minutes === Number(minutes))?.phrase || 'service';
  return { name, phrase: `${len(minutes)} ${name}`, withArticle: `${/^(8|11|18)/.test(String(minutes)) ? 'an' : 'a'} ${len(minutes)} ${name}` };
}

/** Sample rows for the menu analyzer: the profession's first n services (name and length). */
export const sampleServices = (profession, n = 3) => servicesOf(profession).slice(0, n).map((s) => ({ name: s.name, minutes: s.minutes }));

/** Sample item names for the Cost Per Service rows, in row order: product, product, supply, other. */
export function sampleItems(profession) {
  const i = PROFESSIONS[professionOf(profession)].items;
  return [['product', i.product[0]], ['product', i.product[1]], ['supply', i.supply], ['other', i.other]];
}

/** "e.g. developer, foils": the placeholder of an added item row. */
export function itemPlaceholder(profession) {
  const i = PROFESSIONS[professionOf(profession)].items;
  return `e.g. ${i.product[0].toLowerCase()}, ${i.supply.toLowerCase()}`;
}

const listOf = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}` : xs[0]);

/**
 * The text behind every data-prof="key" span on the pages (and the hub's Cost Per Service card). The static HTML
 * carries the esthetician text; the framework swaps in the chosen license's. tests/calc-pages.test.mjs checks they agree.
 */
export function profText(key, profession) {
  const p = professionOf(profession);
  const sig = signatureService(p);
  if (key === 'signature') return sig.text;
  if (key === 'signature-minutes') return String(sig.minutes);
  if (key === 'signature-name') return sig.name;
  if (key === 'label') return PROFESSIONS[p].label;
  if (key === 'long-service') return PROFESSIONS[p].long;
  const m = /^service-(\d+)$/.exec(key);
  if (m) return serviceText(p, Number(m[1])).phrase;
  if (key === 'cost-card') {
    const i = PROFESSIONS[p].items;
    return `Add up the products and supplies behind a ${listOf(servicesOf(p).slice(0, 3).map((s) => s.phrase))}, down to the ${i.supply.toLowerCase()}.`;
  }
  return PROFESSIONS[p].label;
}

export function savedChoice(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
export function saveChoice(key, value) {
  try { value ? localStorage.setItem(key, value) : localStorage.removeItem(key); } catch { /* storage blocked: nothing to remember */ }
}

// Professions change wording only: example service names in hints, insights and share text. No number on any page
// depends on the profession; the engine never sees it. Shared by the hub picker and every calculator.
export const PROFESSION_KEY = 'glowdega.profession';
export const TYPE_KEY = 'glowdega.audience';
export const TYPES = ['solo', 'employee', 'owner'];

/** services: example service by length in minutes (every example is 60 or 90 minutes). */
export const PROFESSIONS = {
  esthetician: { label: 'Esthetician', services: { 60: 'facial', 90: 'peel' } },
  cosmetologist: { label: 'Cosmetologist/Hairstylist', services: { 90: 'color service' } },
  manicurist: { label: 'Manicurist/Nail Technician', services: { 60: 'gel manicure' } },
  barber: { label: 'Barber', services: { 60: 'cut & beard' } },
};
export const DEFAULT_PROFESSION = 'esthetician';
export const professionOf = (p) => (Object.hasOwn(PROFESSIONS, p || '') ? p : DEFAULT_PROFESSION);

/** The profession's own example service, longest first: "90-minute peel", "60-minute gel manicure". */
export function signatureService(profession) {
  const s = PROFESSIONS[professionOf(profession)].services;
  const min = Math.max(...Object.keys(s).map(Number));
  return { minutes: min, name: s[min], text: `${min}-minute ${s[min]}` };
}

/** "a 90-minute peel" for an esthetician; a length the profession has no example for reads "a 90-minute service" (barber). */
export function serviceText(profession, minutes) {
  const name = PROFESSIONS[professionOf(profession)].services[minutes] || 'service';
  const len = `${Number(minutes).toLocaleString('en-US', { maximumFractionDigits: 0 })}-minute`;
  return { name, phrase: `${len} ${name}`, withArticle: `${/^(8|11|18)/.test(String(minutes)) ? 'an' : 'a'} ${len} ${name}` };
}

export function savedChoice(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
export function saveChoice(key, value) {
  try { value ? localStorage.setItem(key, value) : localStorage.removeItem(key); } catch { /* storage blocked: nothing to remember */ }
}

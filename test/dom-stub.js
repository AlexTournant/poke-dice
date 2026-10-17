// Page minimale pour charger le userscript en Node (sans le DOM réel du jeu).
// Suffisant pour tester la logique de décision (boutique, Pokédex, évolutions) sur une sauvegarde simulée.
function el() {
  const e = {
    style: {}, dataset: {}, children: [], options: [], value: '', checked: false,
    append(...c) { this.children.push(...c); }, appendChild(c) { this.children.push(c); return c; },
    add(o) { this.options.push(o); }, replaceChildren(...c) { this.options = c; },
    addEventListener() {}, setAttribute() {}, getAttribute() { return null; },
    querySelector() { return null; }, querySelectorAll() { return []; }, getClientRects() { return []; },
    contains() { return false; }, attachShadow() { return el(); },
  };
  return e;
}
const store = new Map();
global.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
global.document = {
  body: Object.assign(el(), { innerText: '' }), documentElement: { lang: 'fr' },
  createElement: el, createTextNode: (t) => ({ t }), addEventListener() {},
  querySelector() { return null; }, querySelectorAll() { return []; }, getElementById() { return null; },
};
global.window = global;
global.getComputedStyle = () => ({ visibility: 'visible' });
global.indexedDB = { open() { const r = {}; setTimeout(() => r.onerror?.(new Error('pas d’IndexedDB en test'))); return r; } };
global.fetch = () => Promise.reject(new Error('pas de réseau en test'));
global.MutationObserver = class { observe() {} };
global.Option = class { constructor(t, v, a, s) { Object.assign(this, { text: t, value: v, selected: s }); } };
global.location = { pathname: '/home' };
global.history = { back() {} };
module.exports = { store };

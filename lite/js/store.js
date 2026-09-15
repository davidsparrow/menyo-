/**
 * All persistent state for menyo lite.
 *
 * Everything lives in localStorage on the device — there is no backend and no
 * account system, which is what makes the app droppable onto an iPad as a
 * single static site.
 */
import { uid } from './util.js';

const NS = 'menyo.lite.';
const KEYS = {
  config: `${NS}config`,
  menu: `${NS}menu`,
  session: `${NS}session`,
  cart: `${NS}cart`,
  orders: `${NS}orders`,
};

/** localStorage throws in private browsing and when the quota is exhausted. */
function readJson(key, fallback) {
  try {
    const text = localStorage.getItem(key);
    return text ? JSON.parse(text) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export const DEFAULT_CONFIG = {
  restaurant: { name: '', tagline: '', address: '', phone: '', website: '' },
  brand: { accent: '#c2410c' },
  ordering: {
    currency: 'USD',
    dineIn: true,
    pickup: true,
    delivery: false,
    askTableNumber: true,
    askScheduledTime: true,
    allowItemNotes: true,
    taxRatePercent: 0,
    serviceChargePercent: 0,
    minOrderCents: 0,
    kioskMode: false,
    idleResetMinutes: 5,
  },
  delivery: {
    email: '',
    sms: '',
    method: 'DEVICE',
    relayUrl: '',
    relayToken: '',
    shareBaseUrl: '',
    ccCustomer: true,
  },
  admin: { pin: '' },
  ai: { geminiKey: '', model: 'gemini-2.5-flash' },
};

export const EMPTY_MENU = { name: '', currency: 'USD', updatedAt: 0, categories: [] };

function emptyCart() {
  return {
    lines: [],
    orderType: '',
    tableNumber: '',
    deliveryAddress: '',
    scheduledFor: 'ASAP',
    note: '',
  };
}

/** Deep-merge stored config over the defaults so new fields appear on upgrade. */
function mergeConfig(stored) {
  const merged = structuredClone(DEFAULT_CONFIG);
  if (!stored || typeof stored !== 'object') return merged;
  for (const [section, values] of Object.entries(stored)) {
    if (!(section in merged)) continue;
    if (values && typeof values === 'object' && !Array.isArray(values)) {
      Object.assign(merged[section], values);
    }
  }
  return merged;
}

const listeners = new Set();

export const state = {
  config: mergeConfig(readJson(KEYS.config, null)),
  menu: readJson(KEYS.menu, null) || structuredClone(EMPTY_MENU),
  session: readJson(KEYS.session, null),
  cart: readJson(KEYS.cart, null) || emptyCart(),
  orders: readJson(KEYS.orders, []) || [],
};

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notify() {
  for (const fn of listeners) fn(state);
}

// --- Config ---

export function saveConfig(patch) {
  for (const [section, values] of Object.entries(patch)) {
    if (!(section in state.config)) continue;
    Object.assign(state.config[section], values);
  }
  // Changing the currency in settings has to reach the stored menu too.
  if (patch.ordering?.currency && state.menu.currency !== patch.ordering.currency) {
    state.menu.currency = patch.ordering.currency;
    writeJson(KEYS.menu, state.menu);
  }
  writeJson(KEYS.config, state.config);
  notify();
  return state.config;
}

export function replaceConfig(config) {
  state.config = mergeConfig(config);
  writeJson(KEYS.config, state.config);
  notify();
  return state.config;
}

// --- Menu ---

/** Give every category/item/option a stable id so the cart can reference them. */
export function normaliseMenu(menu) {
  const out = {
    name: menu?.name || '',
    currency: menu?.currency || state.config.ordering.currency || 'USD',
    updatedAt: menu?.updatedAt || Date.now(),
    categories: [],
  };
  for (const category of menu?.categories || []) {
    const cat = {
      id: category.id || uid('c'),
      name: String(category.name || 'Menu').trim(),
      description: category.description ? String(category.description).trim() : '',
      items: [],
    };
    for (const item of category.items || []) {
      cat.items.push({
        id: item.id || uid('i'),
        name: String(item.name || '').trim(),
        description: item.description ? String(item.description).trim() : '',
        price: Number.isFinite(item.price) ? Math.round(item.price) : 0,
        tags: Array.isArray(item.tags) ? item.tags.filter(Boolean).map(String) : [],
        available: item.available !== false,
        options: (item.options || []).map((group) => ({
          id: group.id || uid('g'),
          name: String(group.name || 'Options').trim(),
          required: Boolean(group.required),
          multiple: Boolean(group.multiple),
          choices: (group.choices || []).map((choice) => ({
            id: choice.id || uid('o'),
            name: String(choice.name || '').trim(),
            price: Number.isFinite(choice.price) ? Math.round(choice.price) : 0,
          })).filter((choice) => choice.name),
        })).filter((group) => group.choices.length),
      });
    }
    // Nameless rows are dropped, but an empty section is kept so a half-built
    // menu survives a save; the customer-facing menu hides those.
    cat.items = cat.items.filter((item) => item.name);
    out.categories.push(cat);
  }
  return out;
}

export function saveMenu(menu) {
  state.menu = normaliseMenu({ ...menu, updatedAt: Date.now() });
  // One currency across the app: the menu's wins, so a parsed or imported menu
  // does not leave the totals in a different currency from the prices.
  if (state.menu.currency && state.menu.currency !== state.config.ordering.currency) {
    state.config.ordering.currency = state.menu.currency;
    writeJson(KEYS.config, state.config);
  }
  if (!writeJson(KEYS.menu, state.menu)) {
    notify();
    throw new Error('This device ran out of storage space for the menu.');
  }
  notify();
  return state.menu;
}

export function findItem(itemId) {
  for (const category of state.menu.categories) {
    const item = category.items.find((i) => i.id === itemId);
    if (item) return { item, category };
  }
  return null;
}

export function menuIsEmpty() {
  return !state.menu.categories.some((c) => c.items.length);
}

// --- Customer session ---

export function signIn(customer) {
  state.session = { ...customer, at: Date.now() };
  if (customer.remember) writeJson(KEYS.session, state.session);
  notify();
  return state.session;
}

export function signOut() {
  state.session = null;
  try {
    localStorage.removeItem(KEYS.session);
  } catch {
    /* nothing to clean up */
  }
  notify();
}

// --- Cart ---

function persistCart() {
  writeJson(KEYS.cart, state.cart);
  notify();
}

export function cartAdd(line) {
  // Fold identical configurations together instead of stacking duplicate rows.
  const signature = lineSignature(line);
  const existing = state.cart.lines.find((l) => lineSignature(l) === signature);
  if (existing) existing.qty += line.qty;
  else state.cart.lines.push({ ...line, id: uid('l') });
  persistCart();
}

function lineSignature(line) {
  const options = (line.options || []).map((o) => `${o.groupId}:${o.choiceId}`).sort().join('|');
  return `${line.itemId}#${options}#${(line.note || '').trim()}`;
}

export function cartSetQty(lineId, qty) {
  const line = state.cart.lines.find((l) => l.id === lineId);
  if (!line) return;
  if (qty <= 0) state.cart.lines = state.cart.lines.filter((l) => l.id !== lineId);
  else line.qty = qty;
  persistCart();
}

export function cartRemove(lineId) {
  state.cart.lines = state.cart.lines.filter((l) => l.id !== lineId);
  persistCart();
}

export function cartSet(patch) {
  Object.assign(state.cart, patch);
  persistCart();
}

export function cartClear() {
  state.cart = emptyCart();
  persistCart();
}

export function cartCount() {
  return state.cart.lines.reduce((sum, line) => sum + line.qty, 0);
}

// --- Local order history ---

export function rememberOrder(order) {
  state.orders = [order, ...state.orders.filter((o) => o.id !== order.id)].slice(0, 50);
  writeJson(KEYS.orders, state.orders);
  notify();
}

export function clearOrders() {
  state.orders = [];
  writeJson(KEYS.orders, state.orders);
  notify();
}

// --- Whole-device setup bundle (for copying a configured iPad onto others) ---

export function exportSetup() {
  const { geminiKey, ...ai } = state.config.ai;
  return {
    kind: 'menyo-lite-setup',
    version: 1,
    exportedAt: new Date().toISOString(),
    // The Gemini key is deliberately left out: it should not travel in a file
    // that gets emailed between devices.
    config: { ...state.config, ai },
    menu: state.menu,
  };
}

export function importSetup(bundle) {
  if (!bundle || bundle.kind !== 'menyo-lite-setup') {
    throw new Error('That file is not a menyo lite setup export.');
  }
  if (bundle.config) replaceConfig(bundle.config);
  if (bundle.menu) saveMenu(bundle.menu);
  return true;
}

export function resetEverything() {
  for (const key of Object.values(KEYS)) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }
  state.config = structuredClone(DEFAULT_CONFIG);
  state.menu = structuredClone(EMPTY_MENU);
  state.session = null;
  state.cart = emptyCart();
  state.orders = [];
  notify();
}

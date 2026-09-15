/**
 * menyo lite — app shell, router and the customer-facing ordering screens.
 *
 * No framework, no build step: the whole thing is ES modules served as static
 * files so it can be dropped on any host and added to an iPad home screen.
 */
import { $, h, raw, esc, money, formatDateTime, copyText, downloadFile } from './util.js';
import {
  state,
  subscribe,
  cartAdd,
  cartSet,
  cartSetQty,
  cartClear,
  cartCount,
  findItem,
  menuIsEmpty,
  signIn,
  signOut,
  rememberOrder,
  saveMenu,
  saveConfig,
} from './store.js';
import {
  ORDER_TYPES,
  buildOrder,
  cartTotals,
  encodeOrder,
  decodeOrder,
  shareUrl,
  orderTypeLabel,
  orderToCsv,
  orderToText,
  lineUnitPrice,
} from './order.js';
import { deliveryOptions, mailtoUrl, smsUrl, webShare, sendViaRelay, orderHtmlDocument } from './share.js';
import { qrSvg } from './qr.js';
import { adminView, bindAdmin } from './admin.js';
import { toast, openSheet, closeActiveSheet, updateSheet } from './ui.js';

const root = () => $('#app');

// --- Router ------------------------------------------------------------------

const routes = [];

function route(pattern, handler) {
  routes.push({ pattern, handler });
}

export function go(path, { replace = false } = {}) {
  const hash = `#${path}`;
  if (replace) history.replaceState(null, '', hash);
  else location.hash = hash;
  if (replace) render();
}

function currentPath() {
  const hash = location.hash.replace(/^#/, '');
  return hash.startsWith('/') ? hash : '/';
}

let renderToken = 0;

async function renderView() {
  const path = currentPath();
  const token = ++renderToken;
  // A sheet left open over a previous screen would block every tap on the new one.
  closeActiveSheet();
  applyTheme();

  for (const { pattern, handler } of routes) {
    const match = path.match(pattern);
    if (!match) continue;
    const html = await handler(match);
    if (token !== renderToken) return; // a newer navigation won the race
    if (typeof html === 'string') {
      root().innerHTML = html;
      window.scrollTo(0, 0);
    }
    renderChrome();
    return;
  }
  root().innerHTML = notFoundView();
  renderChrome();
}

function applyTheme() {
  const accent = state.config.brand.accent || '#c2410c';
  document.documentElement.style.setProperty('--accent', accent);
  document.documentElement.style.setProperty('--accent-ink', readableInk(accent));
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  if (themeMeta) themeMeta.setAttribute('content', accent);
}

/** Pick black or white text for a background colour using relative luminance. */
function readableInk(hex) {
  const value = String(hex).replace('#', '');
  if (value.length !== 6) return '#ffffff';
  const channel = (i) => {
    const c = parseInt(value.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
  return luminance > 0.45 ? '#1c1917' : '#ffffff';
}

// --- Shared chrome -----------------------------------------------------------

function topbar({ showAdmin = true, showCart = true } = {}) {
  const name = state.config.restaurant.name || 'menyo lite';
  const initials = name.trim().slice(0, 1).toUpperCase() || 'M';
  const count = cartCount();
  return h`
    <header class="topbar">
      <div class="topbar-inner">
        <a class="brand" href="#/" style="text-decoration:none;color:inherit;">
          <div class="brand-mark" aria-hidden="true">${initials}</div>
          <div class="brand-text">
            <div class="brand-name">${name}</div>
            <div class="brand-sub">${state.config.restaurant.tagline || 'Order from your table'}</div>
          </div>
        </a>
        <div class="topbar-actions">
          ${state.session ? raw(h`<button class="btn btn-ghost btn-sm" data-action="account">${state.session.name || 'Account'}</button>`) : raw('')}
          ${showCart && count ? raw(h`<button class="btn btn-quiet btn-sm" data-action="open-cart">Order · ${count}</button>`) : raw('')}
          ${showAdmin ? raw('<a class="btn btn-ghost btn-sm" href="#/admin" aria-label="Admin">Admin</a>') : raw('')}
        </div>
      </div>
    </header>`;
}

function renderChrome() {
  const bar = $('#cartbar');
  const path = currentPath();
  const totals = cartTotals(state.cart, state.config.ordering);
  const count = cartCount();
  const showBar = count > 0 && (path === '/' || path.startsWith('/menu'));

  bar.dataset.visible = String(showBar);
  bar.setAttribute('aria-hidden', String(!showBar));
  if (!showBar) {
    bar.innerHTML = '';
    return;
  }
  bar.innerHTML = h`
    <div class="cartbar-inner">
      <div class="summary">
        <strong>${money(totals.total, state.menu.currency)}</strong>
        <span>${count} ${count === 1 ? 'item' : 'items'}</span>
      </div>
      <button class="btn btn-primary btn-lg" data-action="open-cart">Review order</button>
    </div>`;
}

// --- Menu --------------------------------------------------------------------

route(/^\/$/, () => {
  if (menuIsEmpty()) return setupNeededView();
  return menuView();
});

function menuView() {
  const { restaurant } = state.config;
  const facts = [restaurant.address, restaurant.phone, restaurant.website].filter(Boolean);

  const categories = state.menu.categories.filter((category) => category.items.length);

  const nav = categories
    .map(
      (category, index) => h`
        <button class="pill" data-jump="${category.id}" aria-current="${index === 0}">${category.name}</button>`
    )
    .join('');

  const sections = categories.map((category) => categorySection(category)).join('');

  return h`
    ${raw(topbar())}
    <main class="page">
      <section class="menu-hero">
        <h1>${restaurant.name || state.menu.name || 'Our menu'}</h1>
        ${restaurant.tagline ? raw(h`<p class="tagline">${restaurant.tagline}</p>`) : raw('')}
        ${facts.length ? raw(h`<div class="facts">${raw(facts.map((f) => h`<span>${f}</span>`).join(''))}</div>`) : raw('')}
      </section>
      <nav class="catnav" aria-label="Menu sections">${raw(nav)}</nav>
      ${raw(sections)}
      <p class="muted small" style="margin-top:32px;">
        Prices are shown as printed on the menu. No payment is taken here — your order is
        sent to the counter and paid in person.
      </p>
    </main>`;
}

function categorySection(category) {
  const items = category.items.map((item) => itemCard(item)).join('');
  return h`
    <section class="category" id="${category.id}">
      <div class="category-head">
        <h2>${category.name}</h2>
        <span class="count">${category.items.length} ${category.items.length === 1 ? 'item' : 'items'}</span>
      </div>
      ${category.description ? raw(h`<p class="category-note">${category.description}</p>`) : raw('')}
      <div class="items">${raw(items)}</div>
    </section>`;
}

function inCartQty(itemId) {
  return state.cart.lines.filter((l) => l.itemId === itemId).reduce((sum, l) => sum + l.qty, 0);
}

function itemCard(item) {
  const qty = inCartQty(item.id);
  const hasOptions = item.options.length > 0;
  const tags = item.tags
    .slice(0, 3)
    .map((tag) => h`<span class="tag ${tagClass(tag)}">${tag}</span>`)
    .join('');

  return h`
    <button class="item" data-item="${item.id}" ${item.available ? raw('') : raw('disabled')}>
      ${qty ? raw(h`<span class="item-count">${qty}</span>`) : raw('')}
      <span class="item-body">
        <span class="item-name">${item.name}</span>
        ${item.description ? raw(h`<span class="item-desc">${item.description}</span>`) : raw('')}
        <span class="item-foot">
          <span class="item-price">${money(item.price, state.menu.currency)}</span>
          ${hasOptions ? raw('<span class="item-from">+ options</span>') : raw('')}
          ${raw(tags)}
          ${item.available ? raw('') : raw('<span class="tag">Sold out</span>')}
        </span>
      </span>
      <span class="item-add" aria-hidden="true">+</span>
    </button>`;
}

function tagClass(tag) {
  const value = tag.toLowerCase();
  if (value.includes('spic') || value.includes('hot')) return 'tag-spicy';
  if (value.includes('veg') || value.includes('gluten') || value.includes('plant')) return 'tag-veg';
  return '';
}

// --- Item sheet --------------------------------------------------------------

function openItemSheet(itemId) {
  const found = findItem(itemId);
  if (!found) return;
  const { item } = found;

  const groups = item.options
    .map(
      (group) => h`
      <div class="optgroup" data-group="${group.id}">
        <div class="optgroup-head">
          <h3>${group.name}</h3>
          ${group.required ? raw('<span class="req">Required</span>') : raw('<span class="opt">Optional</span>')}
          ${group.multiple ? raw('<span class="opt">Choose any</span>') : raw('')}
        </div>
        ${raw(
          group.choices
            .map(
              (choice) => h`
          <label class="choice">
            <input type="${group.multiple ? 'checkbox' : 'radio'}" name="g_${group.id}" value="${choice.id}" data-price="${choice.price}">
            <span class="choice-name">${choice.name}</span>
            <span class="choice-price">${choice.price ? `+${money(choice.price, state.menu.currency)}` : ''}</span>
          </label>`
            )
            .join('')
        )}
      </div>`
    )
    .join('');

  const body = h`
    ${item.description ? raw(h`<p class="muted" style="margin-bottom:20px;">${item.description}</p>`) : raw('')}
    ${raw(groups)}
    ${
      state.config.ordering.allowItemNotes
        ? raw(h`
      <label class="field">
        <span class="label">Anything to tell the kitchen?</span>
        <textarea class="textarea" id="item-note" maxlength="200" placeholder="No onions, extra napkins…"></textarea>
      </label>`)
        : raw('')
    }`;

  const footer = h`
    <div class="stepper">
      <button type="button" data-qty="-1" aria-label="One fewer">−</button>
      <span class="qty" id="item-qty">1</span>
      <button type="button" data-qty="1" aria-label="One more">+</button>
    </div>
    <button class="btn btn-primary btn-lg" id="item-add">Add · ${money(item.price, state.menu.currency)}</button>`;

  openSheet({
    title: item.name,
    subtitle: money(item.price, state.menu.currency),
    body,
    footer,
    onMount(node, close) {
      let qty = 1;

      const selections = () => {
        const chosen = [];
        for (const group of item.options) {
          const inputs = node.querySelectorAll(`input[name="g_${group.id}"]:checked`);
          for (const input of inputs) {
            const choice = group.choices.find((c) => c.id === input.value);
            if (choice) chosen.push({ groupId: group.id, groupName: group.name, choiceId: choice.id, name: choice.name, price: choice.price });
          }
        }
        return chosen;
      };

      const missingGroup = () =>
        item.options.find((group) => group.required && !node.querySelector(`input[name="g_${group.id}"]:checked`));

      const refresh = () => {
        const chosen = selections();
        const unit = item.price + chosen.reduce((sum, c) => sum + c.price, 0);
        const button = node.querySelector('#item-add');
        const missing = missingGroup();
        button.disabled = Boolean(missing);
        button.textContent = missing ? `Choose ${missing.name}` : `Add ${qty > 1 ? `${qty} · ` : '· '}${money(unit * qty, state.menu.currency)}`;
        node.querySelector('#item-qty').textContent = String(qty);
      };

      node.addEventListener('change', refresh);
      node.addEventListener('click', (event) => {
        const step = event.target.closest('[data-qty]');
        if (step) {
          qty = Math.min(99, Math.max(1, qty + Number(step.dataset.qty)));
          refresh();
          return;
        }
        if (event.target.closest('#item-add')) {
          const chosen = selections();
          cartAdd({
            itemId: item.id,
            name: item.name,
            unit: item.price,
            qty,
            options: chosen,
            note: node.querySelector('#item-note')?.value.trim() || '',
          });
          close();
          toast(`${qty} × ${item.name} added`);
          render();
        }
      });

      // Preselect the only sensible answer when a required group has one choice.
      for (const group of item.options) {
        if (group.required && group.choices.length === 1) {
          const input = node.querySelector(`input[name="g_${group.id}"]`);
          if (input) input.checked = true;
        }
      }
      refresh();
    },
  });
}

// --- Cart sheet --------------------------------------------------------------

function openCartSheet() {
  if (!state.cart.lines.length) {
    toast('Your order is empty');
    return;
  }
  openSheet({
    title: 'Your order',
    subtitle: `${cartCount()} ${cartCount() === 1 ? 'item' : 'items'}`,
    body: cartLinesHtml(),
    footer: h`
      <button class="btn btn-quiet" data-action="clear-cart">Clear</button>
      <button class="btn btn-primary btn-lg" data-action="checkout">Continue</button>`,
    onMount(node, close) {
      node.addEventListener('click', (event) => {
        const step = event.target.closest('[data-line-qty]');
        if (step) {
          const { line, delta } = step.dataset;
          const current = state.cart.lines.find((l) => l.id === line);
          if (current) cartSetQty(line, current.qty + Number(delta));
          if (!state.cart.lines.length) {
            close();
            render();
            return;
          }
          updateSheet(node, {
            body: cartLinesHtml(),
            subtitle: `${cartCount()} ${cartCount() === 1 ? 'item' : 'items'}`,
          });
          renderChrome();
          return;
        }
        if (event.target.closest('[data-action="clear-cart"]')) {
          cartClear();
          close();
          render();
          return;
        }
        if (event.target.closest('[data-action="checkout"]')) {
          close();
          go('/checkout');
        }
      });
    },
  });
}

function cartLinesHtml() {
  const totals = cartTotals(state.cart, state.config.ordering);
  const currency = state.menu.currency;
  const lines = state.cart.lines
    .map((line) => {
      const meta = [
        (line.options || []).map((o) => o.name).join(', '),
        line.note ? `Note: ${line.note}` : '',
      ]
        .filter(Boolean)
        .join(' · ');
      return h`
        <div class="cartline">
          <div class="cl-body">
            <div class="cl-name">${line.name}</div>
            ${meta ? raw(h`<div class="cl-meta">${meta}</div>`) : raw('')}
            <div class="cl-meta">${money(lineUnitPrice(line), currency)} each</div>
          </div>
          <div class="cl-actions">
            <div class="cl-price">${money(lineUnitPrice(line) * line.qty, currency)}</div>
            <div class="stepper">
              <button type="button" data-line-qty data-line="${line.id}" data-delta="-1" aria-label="One fewer ${line.name}">−</button>
              <span class="qty">${line.qty}</span>
              <button type="button" data-line-qty data-line="${line.id}" data-delta="1" aria-label="One more ${line.name}">+</button>
            </div>
          </div>
        </div>`;
    })
    .join('');

  return h`${raw(lines)}${raw(totalsHtml(totals, currency))}`;
}

function totalsHtml(totals, currency) {
  return h`
    <div class="totals">
      <div class="row"><span>Subtotal</span><span>${money(totals.subtotal, currency)}</span></div>
      ${totals.serviceCharge ? raw(h`<div class="row"><span>Service (${totals.servicePercent}%)</span><span>${money(totals.serviceCharge, currency)}</span></div>`) : raw('')}
      ${totals.tax ? raw(h`<div class="row"><span>Tax (${totals.taxPercent}%)</span><span>${money(totals.tax, currency)}</span></div>`) : raw('')}
      <div class="row grand"><span>Total</span><span>${money(totals.total, currency)}</span></div>
    </div>`;
}

// --- Sign in -----------------------------------------------------------------

route(/^\/signin$/, () => signInView());

function signInView() {
  return h`
    ${raw(topbar())}
    <main class="page page-narrow">
      <div class="page-head">
        <h1>Sign in to order</h1>
        <p class="sub">We only need enough to call your name and confirm the order.</p>
      </div>
      <div class="card">${raw(signInFormHtml())}</div>
    </main>`;
}

function signInFormHtml() {
  const session = state.session || {};
  const kiosk = state.config.ordering.kioskMode;
  return h`
    <form id="signin-form" novalidate>
      <label class="field">
        <span class="label">Your name</span>
        <input class="input" name="name" autocomplete="name" required value="${session.name || ''}" placeholder="Alex Moore">
      </label>
      <div class="grid-2">
        <label class="field">
          <span class="label">Email</span>
          <input class="input" name="email" type="email" inputmode="email" autocomplete="email" value="${session.email || ''}" placeholder="alex@example.com">
        </label>
        <label class="field">
          <span class="label">Mobile number</span>
          <input class="input" name="phone" type="tel" inputmode="tel" autocomplete="tel" value="${session.phone || ''}" placeholder="+1 555 010 0199">
        </label>
      </div>
      <p class="hint muted small">Give us an email or a phone number so the restaurant can reach you about this order.</p>
      ${
        kiosk
          ? raw('')
          : raw(h`
        <label class="switch" style="margin-top:12px;">
          <input type="checkbox" name="remember" ${session.remember === false ? raw('') : raw('checked')}>
          <span class="switch-text">Remember me on this device
            <span class="switch-sub">Leave this off on a shared iPad.</span>
          </span>
        </label>`)
      }
      <div id="signin-error"></div>
      <button class="btn btn-primary btn-lg btn-block" type="submit" style="margin-top:18px;">Continue</button>
    </form>`;
}

function bindSignInForm(scope, onDone) {
  const form = scope.querySelector('#signin-form');
  if (!form) return;
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    const name = String(data.name || '').trim();
    const email = String(data.email || '').trim();
    const phone = String(data.phone || '').trim();
    const errorBox = form.querySelector('#signin-error');

    const fail = (message) => {
      errorBox.innerHTML = h`<div class="notice notice-error" style="margin-top:14px;">${message}</div>`;
    };

    if (!name) return fail('Please tell us your name.');
    if (!email && !phone) return fail('Add an email address or a mobile number.');
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail('That email address does not look right.');
    if (phone && phone.replace(/[^\d]/g, '').length < 6) return fail('That phone number looks too short.');

    signIn({
      name,
      email,
      phone,
      remember: state.config.ordering.kioskMode ? false : Boolean(data.remember),
    });
    onDone?.();
  });
}

// --- Checkout ----------------------------------------------------------------

route(/^\/checkout$/, () => {
  if (!state.cart.lines.length) return emptyCartView();
  return checkoutView();
});

function availableOrderTypes() {
  const { ordering } = state.config;
  const types = [];
  if (ordering.dineIn) types.push('DINE_IN');
  if (ordering.pickup) types.push('PICKUP');
  if (ordering.delivery) types.push('DELIVERY');
  return types.length ? types : ['PICKUP'];
}

function checkoutView() {
  const totals = cartTotals(state.cart, state.config.ordering);
  const currency = state.menu.currency;
  const types = availableOrderTypes();
  const selected = types.includes(state.cart.orderType) ? state.cart.orderType : types[0];
  const minimum = state.config.ordering.minOrderCents || 0;
  const belowMinimum = minimum > 0 && totals.subtotal < minimum;

  const typeButtons = types
    .map(
      (type) => h`
      <label class="choice">
        <input type="radio" name="orderType" value="${type}" ${type === selected ? raw('checked') : raw('')}>
        <span class="choice-name">${ORDER_TYPES[type].label}</span>
      </label>`
    )
    .join('');

  return h`
    ${raw(topbar({ showCart: false }))}
    <main class="page page-narrow">
      <div class="page-head">
        <h1>Check your order</h1>
        <p class="sub">Nothing is charged here. The kitchen gets your order and you pay in person.</p>
      </div>

      <div class="card">
        <h2>1. Your details</h2>
        <div class="card-sub">So the restaurant knows whose order this is.</div>
        ${
          state.session
            ? raw(h`
          <div class="stack">
            <div><strong>${state.session.name}</strong></div>
            ${state.session.email ? raw(h`<div class="muted small">${state.session.email}</div>`) : raw('')}
            ${state.session.phone ? raw(h`<div class="muted small">${state.session.phone}</div>`) : raw('')}
            <button class="btn btn-quiet btn-sm" data-action="switch-user" style="margin-top:8px;">Not you? Sign in again</button>
          </div>`)
            : raw(signInFormHtml())
        }
      </div>

      <div class="card">
        <h2>2. How would you like it?</h2>
        <div class="card-sub">Pick the service and when you want it.</div>
        <form id="details-form">
          ${raw(typeButtons)}

          <div id="type-extra" style="margin-top:16px;"></div>

          ${
            state.config.ordering.askScheduledTime
              ? raw(h`
            <div class="divider"></div>
            <label class="choice">
              <input type="radio" name="when" value="ASAP" ${state.cart.scheduledFor === 'ASAP' ? raw('checked') : raw('')}>
              <span class="choice-name">As soon as possible</span>
            </label>
            <label class="choice">
              <input type="radio" name="when" value="LATER" ${state.cart.scheduledFor !== 'ASAP' ? raw('checked') : raw('')}>
              <span class="choice-name">At a specific time</span>
              <input class="input" type="time" name="whenTime" style="width:140px;min-height:36px;"
                     value="${state.cart.scheduledFor !== 'ASAP' ? state.cart.scheduledFor : ''}">
            </label>`)
              : raw('')
          }

          <label class="field" style="margin-top:18px;">
            <span class="label">Notes for the whole order</span>
            <textarea class="textarea" name="note" maxlength="400" placeholder="Allergies, celebration, where we are sitting…">${state.cart.note || ''}</textarea>
          </label>
        </form>
      </div>

      <div class="card">
        <h2>3. Your items</h2>
        <div class="card-sub">${cartCount()} ${cartCount() === 1 ? 'item' : 'items'}</div>
        ${raw(cartLinesHtml())}
        <div class="row-actions">
          <a class="btn btn-quiet" href="#/">Add more</a>
        </div>
      </div>

      ${belowMinimum ? raw(h`<div class="notice" style="margin-top:16px;">The minimum order is ${money(minimum, currency)}. Add ${money(minimum - totals.subtotal, currency)} more to submit.</div>`) : raw('')}

      <button class="btn btn-primary btn-lg btn-block" id="submit-order" style="margin-top:20px;" ${belowMinimum ? raw('disabled') : raw('')}>
        Submit order · ${money(totals.total, currency)}
      </button>
      <p class="muted small" style="text-align:center;margin-top:12px;">
        Submitting sends your order to ${esc(state.config.restaurant.name || 'the restaurant')}. Payment happens in person.
      </p>
    </main>`;
}

function renderTypeExtra(scope) {
  const type = scope.querySelector('input[name="orderType"]:checked')?.value || 'PICKUP';
  const host = scope.querySelector('#type-extra');
  if (!host) return;
  if (type === 'DINE_IN' && state.config.ordering.askTableNumber) {
    host.innerHTML = h`
      <label class="field">
        <span class="label">Table number</span>
        <input class="input" name="tableNumber" inputmode="numeric" maxlength="12" value="${state.cart.tableNumber || ''}" placeholder="12">
      </label>`;
  } else if (type === 'DELIVERY') {
    host.innerHTML = h`
      <label class="field">
        <span class="label">Delivery address</span>
        <textarea class="textarea" name="deliveryAddress" maxlength="300" placeholder="Street, apartment, city">${state.cart.deliveryAddress || ''}</textarea>
      </label>`;
  } else {
    host.innerHTML = '';
  }
}

function readCheckoutForm(scope) {
  const form = scope.querySelector('#details-form');
  const data = Object.fromEntries(new FormData(form).entries());
  const orderType = String(data.orderType || 'PICKUP');
  const scheduledFor =
    data.when === 'LATER' && data.whenTime ? String(data.whenTime) : 'ASAP';
  return {
    orderType,
    tableNumber: String(data.tableNumber || '').trim(),
    deliveryAddress: String(data.deliveryAddress || '').trim(),
    scheduledFor,
    note: String(data.note || '').trim(),
  };
}

async function submitOrder() {
  const scope = root();
  const details = readCheckoutForm(scope);

  if (details.orderType === 'DINE_IN' && state.config.ordering.askTableNumber && !details.tableNumber) {
    toast('Add your table number so we can find you', 'error');
    scope.querySelector('[name="tableNumber"]')?.focus();
    return false;
  }
  if (details.orderType === 'DELIVERY' && !details.deliveryAddress) {
    toast('Add a delivery address', 'error');
    scope.querySelector('[name="deliveryAddress"]')?.focus();
    return false;
  }
  cartSet(details);

  const order = buildOrder({ cart: state.cart, session: state.session, config: state.config });
  const token = await encodeOrder(order);
  rememberOrder({ id: order.id, createdAt: order.createdAt, total: order.total, currency: order.currency, token });
  cartClear();
  go(`/receipt/${token}`);
  return true;
}

function emptyCartView() {
  return h`
    ${raw(topbar())}
    <main class="page page-narrow">
      <div class="empty">
        <div class="emoji">🍽️</div>
        <h1>Nothing in your order yet</h1>
        <p class="muted" style="margin-top:8px;">Pick a few things from the menu and they will show up here.</p>
        <a class="btn btn-primary btn-lg" href="#/" style="margin-top:20px;">Back to the menu</a>
      </div>
    </main>`;
}

// --- Receipt & shared order --------------------------------------------------

route(/^\/receipt\/(.+)$/, async (match) => {
  try {
    const order = await decodeOrder(match[1]);
    return receiptView(order, match[1]);
  } catch (err) {
    return errorView('That order link could not be opened.', err.message);
  }
});

route(/^\/o\/(.+)$/, async (match) => {
  try {
    const order = await decodeOrder(match[1]);
    return sharedOrderView(order, match[1]);
  } catch (err) {
    return errorView('That order link could not be opened.', err.message);
  }
});

function orderItemsHtml(order) {
  const rows = order.lines
    .map((line) => {
      const meta = [
        (line.options || []).map((o) => o.name).join(', '),
        line.note ? `Note: ${line.note}` : '',
      ]
        .filter(Boolean)
        .join(' · ');
      return h`
        <div class="cartline">
          <div class="cl-body">
            <div class="cl-name">${line.qty} × ${line.name}</div>
            ${meta ? raw(h`<div class="cl-meta">${meta}</div>`) : raw('')}
          </div>
          <div class="cl-price">${money(line.total, order.currency)}</div>
        </div>`;
    })
    .join('');
  return h`${raw(rows)}${raw(totalsHtml(order, order.currency))}`;
}

function receiptView(order, token) {
  const link = shareUrl(token, state.config);
  const shareable = isShareable(link);
  const options = deliveryOptions(state.config);

  const actions = [];
  if (options.mode === 'RELAY') {
    actions.push('<button class="btn btn-primary btn-lg" data-action="send-relay">Send to the restaurant</button>');
  }
  if (options.hasEmail) {
    actions.push(h`<a class="btn ${options.mode === 'RELAY' ? 'btn-quiet' : 'btn-primary btn-lg'}" data-action="send-email" href="#">Email the order</a>`);
  }
  if (options.hasSms) {
    actions.push(h`<a class="btn ${options.mode === 'RELAY' || options.hasEmail ? 'btn-quiet' : 'btn-primary btn-lg'}" data-action="send-sms" href="#">Text the order</a>`);
  }
  if (options.canShare) actions.push('<button class="btn btn-quiet" data-action="share">Share…</button>');
  if (shareable) actions.push('<button class="btn btn-quiet" data-action="copy-link">Copy link</button>');
  actions.push('<button class="btn btn-quiet" data-action="copy-text">Copy the order</button>');

  const configured = options.hasEmail || options.hasSms || options.mode === 'RELAY';

  return h`
    ${raw(topbar({ showCart: false }))}
    <main class="page page-narrow">
      <div class="receipt-head">
        <div class="eyebrow">Order submitted</div>
        <div class="code">${order.id}</div>
        <div class="where">${orderTypeLabel(order)} · ${money(order.total, order.currency)}</div>
      </div>

      ${
        configured
          ? raw(h`<div class="notice notice-ok">Show this screen at the counter, or send it over using the buttons below.</div>`)
          : raw(h`<div class="notice">No email or phone number is set up yet, so this order has not been sent anywhere. Add one in <strong>Admin → Sending</strong>.</div>`)
      }

      ${
        shareable
          ? raw(h`
      <div class="card" style="margin-top:16px;">
        <div class="qr-wrap">${raw(safeQr(link))}</div>
        <p class="muted small" style="text-align:center;">Scan to open the full order on a phone.</p>
        <div class="linkbox" style="margin-top:12px;"><code>${link}</code></div>
      </div>`)
          : raw(h`
      <div class="card" style="margin-top:16px;">
        <p class="muted small">
          This copy of the app is opened from a file rather than a web address, so there is no
          link to scan. The email and text below still carry every line of the order. To get a
          scannable link, host the app and set its address in <strong>Admin &rarr; Sending</strong>.
        </p>
      </div>`)
      }

      <div class="card">
        <h2>Send it over</h2>
        <div class="card-sub">The restaurant gets every line of the order, not just this link.</div>
        <div class="share-actions">${raw(actions.join(''))}</div>
        <div id="send-status"></div>
      </div>

      <div class="card">
        <h2>Order ${esc(order.id)}</h2>
        <div class="card-sub">${formatDateTime(order.createdAt)}</div>
        ${raw(orderItemsHtml(order))}
      </div>

      <div class="row-actions">
        <a class="btn btn-primary" href="#/">Start a new order</a>
        <button class="btn btn-quiet" data-action="print">Print</button>
      </div>
    </main>`;
}

function sharedOrderView(order, token) {
  const link = shareUrl(token, state.config);
  const shareable = isShareable(link);
  return h`
    ${raw(topbar({ showCart: false, showAdmin: false }))}
    <main class="page page-narrow">
      <div class="receipt-head">
        <div class="eyebrow">Incoming order</div>
        <div class="code">${order.id}</div>
        <div class="where">${orderTypeLabel(order)} · ${money(order.total, order.currency)}</div>
      </div>

      <div class="notice"><strong>No payment has been taken.</strong> Re-enter this order in your own till or ordering system.</div>

      <div class="card" style="margin-top:16px;">
        <h2>Customer</h2>
        <div class="stack" style="margin-top:10px;">
          <div><strong>${order.customer.name || 'Guest'}</strong></div>
          ${order.customer.phone ? raw(h`<div><a href="tel:${order.customer.phone}">${order.customer.phone}</a></div>`) : raw('')}
          ${order.customer.email ? raw(h`<div><a href="mailto:${order.customer.email}">${order.customer.email}</a></div>`) : raw('')}
          <div class="muted small">Placed ${formatDateTime(order.createdAt)}</div>
          <div class="muted small">Requested for: ${order.scheduledFor || 'ASAP'}</div>
          ${order.orderType === 'DELIVERY' && order.deliveryAddress ? raw(h`<div class="muted small">Deliver to: ${order.deliveryAddress}</div>`) : raw('')}
          ${order.note ? raw(h`<div class="notice" style="margin-top:10px;">Order note: ${order.note}</div>`) : raw('')}
        </div>
      </div>

      <div class="card">
        <h2>Items</h2>
        ${raw(orderItemsHtml(order))}
      </div>

      <div class="card no-print">
        <h2>Move it into your system</h2>
        <div class="card-sub">Copy the rows, or download a spreadsheet-ready file.</div>
        <div class="share-actions">
          <button class="btn btn-quiet" data-action="copy-csv">Copy as CSV</button>
          <button class="btn btn-quiet" data-action="download-csv">Download .csv</button>
          <button class="btn btn-quiet" data-action="copy-text">Copy as text</button>
          <button class="btn btn-quiet" data-action="print">Print</button>
        </div>
        ${shareable ? raw(h`<div class="linkbox" style="margin-top:14px;"><code>${link}</code></div>`) : raw('')}
      </div>
    </main>`;
}

/** A link is only worth sharing if someone else's device could actually open it. */
function isShareable(link) {
  return /^https?:\/\//i.test(link);
}

function safeQr(text) {
  try {
    // Longer links need the lower error-correction level to stay scannable.
    const ecc = text.length > 400 ? 'L' : 'M';
    return qrSvg(text, { ecc, scale: 5, border: 3, dark: '#1c1917', light: '#ffffff' });
  } catch {
    return '<p class="muted small">This order is too long to show as a QR code — use the link instead.</p>';
  }
}

// --- Setup / errors ----------------------------------------------------------

function setupNeededView() {
  return h`
    ${raw(topbar({ showCart: false }))}
    <main class="page page-narrow">
      <div class="page-head">
        <h1>Let's get your menu in</h1>
        <p class="sub">Upload a photo or PDF of your menu and this turns into an ordering page.</p>
      </div>
      <div class="card">
        <h2>Three steps</h2>
        <ol class="muted" style="padding-left:20px;line-height:2;">
          <li>Open <strong>Admin</strong> and add your restaurant name.</li>
          <li>Upload your menu, or load the sample menu to try it out.</li>
          <li>Add the email or mobile number that should receive orders.</li>
        </ol>
        <div class="row-actions">
          <a class="btn btn-primary btn-lg" href="#/admin">Open Admin</a>
          <button class="btn btn-quiet" data-action="load-sample">Load the sample menu</button>
        </div>
      </div>
    </main>`;
}

function errorView(title, detail) {
  return h`
    ${raw(topbar({ showCart: false }))}
    <main class="page page-narrow">
      <div class="empty">
        <div class="emoji">🤔</div>
        <h1>${title}</h1>
        <p class="muted" style="margin-top:8px;">${detail || ''}</p>
        <a class="btn btn-primary" href="#/" style="margin-top:20px;">Back to the menu</a>
      </div>
    </main>`;
}

function notFoundView() {
  return errorView('Page not found', 'That link does not point anywhere in this app.');
}

// --- Admin route -------------------------------------------------------------

route(/^\/admin(?:\/([\w-]+))?$/, (match) => adminView(match[1] || 'restaurant', adminContext()));

function adminContext() {
  return { topbar, go, render: () => render(), fetchSampleMenu };
}

// --- Global interaction handling --------------------------------------------

document.addEventListener('click', async (event) => {
  const itemButton = event.target.closest('.item[data-item]');
  if (itemButton && !itemButton.disabled) {
    openItemSheet(itemButton.dataset.item);
    return;
  }

  const jump = event.target.closest('[data-jump]');
  if (jump) {
    document.getElementById(jump.dataset.jump)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    for (const pill of document.querySelectorAll('.catnav .pill')) {
      pill.setAttribute('aria-current', String(pill === jump));
    }
    return;
  }

  const action = event.target.closest('[data-action]')?.dataset.action;
  if (!action) return;

  switch (action) {
    case 'open-cart':
      event.preventDefault();
      openCartSheet();
      break;
    case 'checkout':
      event.preventDefault();
      go('/checkout');
      break;
    case 'switch-user':
      event.preventDefault();
      signOut();
      render();
      break;
    case 'account':
      event.preventDefault();
      openAccountSheet();
      break;
    case 'load-sample':
      event.preventDefault();
      await loadSampleMenu();
      break;
    case 'print':
      event.preventDefault();
      window.print();
      break;
    default:
      await handleOrderAction(action, event);
  }
});

async function handleOrderAction(action, event) {
  const path = currentPath();
  const match = path.match(/^\/(?:receipt|o)\/(.+)$/);
  if (!match) return;
  event.preventDefault();

  let order;
  try {
    order = await decodeOrder(match[1]);
  } catch {
    toast('Could not read this order', 'error');
    return;
  }
  const rawLink = shareUrl(match[1], state.config);
  const link = isShareable(rawLink) ? rawLink : '';
  const status = $('#send-status');

  switch (action) {
    case 'copy-link':
      await copyToClipboard(link, 'Link copied');
      break;
    case 'copy-csv':
      await copyToClipboard(orderToCsv(order), 'CSV copied');
      break;
    case 'copy-text':
      await copyToClipboard(orderToText(order, link), 'Order copied');
      break;
    case 'download-csv':
      downloadFile(`order-${order.id}.csv`, orderToCsv(order), 'text/csv');
      break;
    case 'download-html':
      downloadFile(`order-${order.id}.html`, orderHtmlDocument(order, link), 'text/html');
      break;
    case 'send-email':
      window.location.href = mailtoUrl(order, link, state.config);
      break;
    case 'send-sms':
      window.location.href = smsUrl(order, link, state.config);
      break;
    case 'share':
      try {
        await webShare(order, link);
      } catch (err) {
        toast(err.message || 'Sharing failed', 'error');
      }
      break;
    case 'send-relay': {
      const button = event.target.closest('button');
      if (button) {
        button.disabled = true;
        button.innerHTML = '<span class="spinner"></span> Sending…';
      }
      try {
        const result = await sendViaRelay(order, link, state.config);
        const sent = [result?.email && 'email', result?.sms && 'SMS'].filter(Boolean).join(' and ');
        if (status) status.innerHTML = h`<div class="notice notice-ok" style="margin-top:14px;">Sent to the restaurant${sent ? ` by ${sent}` : ''}.</div>`;
        toast('Order sent');
      } catch (err) {
        if (status) status.innerHTML = h`<div class="notice notice-error" style="margin-top:14px;">${err.message}</div>`;
        toast(err.message || 'Could not send the order', 'error');
      } finally {
        if (button) {
          button.disabled = false;
          button.textContent = 'Send to the restaurant';
        }
      }
      break;
    }
    default:
      break;
  }
}

/** The single-file build inlines the sample menu; the hosted build fetches it. */
export async function fetchSampleMenu() {
  if (window.__MENYO_SAMPLE_MENU__) return window.__MENYO_SAMPLE_MENU__;
  const response = await fetch('sample-menu.json', { cache: 'no-cache' });
  if (!response.ok) throw new Error(`Sample menu unavailable (${response.status})`);
  return response.json();
}

async function copyToClipboard(text, successMessage) {
  if (await copyText(text)) toast(successMessage);
  else toast('Could not copy — select the text and copy it by hand.', 'error');
}

function openAccountSheet() {
  const session = state.session;
  if (!session) return;
  // On a shared kiosk the next guest should not see the last guest's orders.
  const recent = state.config.ordering.kioskMode ? [] : state.orders.slice(0, 5);
  openSheet({
    title: session.name || 'Your details',
    subtitle: [session.email, session.phone].filter(Boolean).join(' · '),
    body: h`
      ${
        recent.length
          ? raw(h`
        <h3 style="font-size:16px;margin-bottom:10px;">Recent orders on this device</h3>
        ${raw(
          recent
            .map(
              (order) => h`
          <a class="cartline" style="text-decoration:none;color:inherit;" href="#/receipt/${order.token}">
            <div class="cl-body">
              <div class="cl-name">${order.id}</div>
              <div class="cl-meta">${formatDateTime(order.createdAt)}</div>
            </div>
            <div class="cl-price">${money(order.total, order.currency)}</div>
          </a>`
            )
            .join('')
        )}`)
          : raw('<p class="muted">No orders from this device yet.</p>')
      }`,
    footer: '<button class="btn btn-quiet btn-block" data-action="switch-user">Sign out</button>',
  });
}

async function loadSampleMenu() {
  try {
    const sample = await fetchSampleMenu();
    saveMenu(sample.menu || sample);
    if (sample.restaurant) saveConfig({ restaurant: sample.restaurant });
    toast('Sample menu loaded');
    go('/', { replace: true });
  } catch (err) {
    toast(err.message || 'Could not load the sample menu', 'error');
  }
}

// --- Page wiring -------------------------------------------------------------

function bindPage() {
  const scope = root();

  if (currentPath().startsWith('/admin')) {
    bindAdmin(scope, adminContext());
    return;
  }

  bindSignInForm(scope, () => render());

  const detailsForm = scope.querySelector('#details-form');
  if (detailsForm) {
    renderTypeExtra(scope);
    detailsForm.addEventListener('change', (event) => {
      if (event.target.name === 'orderType') renderTypeExtra(scope);
      if (event.target.name === 'whenTime') {
        const later = detailsForm.querySelector('input[value="LATER"]');
        if (later) later.checked = true;
      }
    });
  }

  scope.querySelector('#submit-order')?.addEventListener('click', async (event) => {
    if (!state.session) {
      toast('Add your details first', 'error');
      scope.querySelector('#signin-form [name="name"]')?.focus();
      return;
    }
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await submitOrder();
    } catch (err) {
      toast(err.message || 'Could not submit the order', 'error');
    } finally {
      // On success the receipt has replaced this screen, so re-enabling is a
      // no-op; on a validation failure it is what lets the guest try again.
      button.disabled = false;
    }
  });

  observeCategories();
}

/** Keep the sticky section pills in step with the scroll position. */
let categoryObserver = null;

function observeCategories() {
  categoryObserver?.disconnect();
  const sections = Array.from(document.querySelectorAll('.category'));
  if (!sections.length || typeof IntersectionObserver === 'undefined') return;
  categoryObserver = new IntersectionObserver(
    (entries) => {
      const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (!visible) return;
      for (const pill of document.querySelectorAll('.catnav .pill')) {
        pill.setAttribute('aria-current', String(pill.dataset.jump === visible.target.id));
      }
    },
    { rootMargin: '-140px 0px -60% 0px', threshold: 0 }
  );
  for (const section of sections) categoryObserver.observe(section);
}

// --- Kiosk idle reset --------------------------------------------------------

let idleTimer = null;

function resetIdleTimer() {
  clearTimeout(idleTimer);
  const { kioskMode, idleResetMinutes } = state.config.ordering;
  if (!kioskMode || !idleResetMinutes) return;
  idleTimer = setTimeout(() => {
    const path = currentPath();
    if (path.startsWith('/admin')) return; // never interrupt someone mid-setup
    closeActiveSheet();
    cartClear();
    signOut();
    go('/', { replace: true });
  }, idleResetMinutes * 60 * 1000);
}

for (const type of ['pointerdown', 'keydown', 'touchstart', 'scroll']) {
  window.addEventListener(type, resetIdleTimer, { passive: true });
}

// --- Boot --------------------------------------------------------------------

async function render() {
  await renderView();
  bindPage();
  resetIdleTimer();
}

window.addEventListener('hashchange', render);
subscribe(() => renderChrome());

export { render };

render();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {
      /* offline support is a bonus, not a requirement */
    });
  });
}


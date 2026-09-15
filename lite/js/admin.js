/**
 * The admin console: restaurant details, menu ingestion and editing, ordering
 * rules, and where submitted orders get sent.
 *
 * Reachable at #/admin and optionally protected by a PIN so a customer poking
 * at a kiosk cannot wander into it.
 */
import { h, raw, esc, money, parseMoney, uid, downloadFile, copyText, formatDateTime } from './util.js';
import {
  state,
  saveConfig,
  saveMenu,
  normaliseMenu,
  exportSetup,
  importSetup,
  resetEverything,
  clearOrders,
  menuIsEmpty,
} from './store.js';
import { parseMenu, parseMenuTextLocally, SUPPORTED_TYPES } from './menu-ai.js';
import { toast, openSheet, closeActiveSheet, confirmSheet } from './ui.js';
import { buildOrder, encodeOrder, shareUrl } from './order.js';
import { deliveryOptions, mailtoUrl, smsUrl, sendViaRelay } from './share.js';

const TABS = [
  ['restaurant', 'Restaurant'],
  ['menu', 'Menu'],
  ['ordering', 'Ordering'],
  ['sending', 'Sending'],
  ['device', 'Device'],
];

// Unlocking lasts for the life of the page, not the life of the device.
let unlocked = false;

/** Working copy of the menu so edits can be reviewed before they are saved. */
let draft = null;
let draftDirty = false;
let pendingFiles = [];

export function adminNeedsUnlock() {
  return Boolean(state.config.admin.pin) && !unlocked;
}

export function adminView(tab, ctx) {
  if (adminNeedsUnlock()) return lockView(ctx);
  if (!draft) draft = structuredClone(state.menu);

  const active = TABS.some(([id]) => id === tab) ? tab : 'restaurant';
  const tabs = TABS.map(
    ([id, label]) => h`<a class="tab" role="tab" aria-selected="${id === active}" href="#/admin/${id}">${label}</a>`
  ).join('');

  const panels = {
    restaurant: restaurantPanel,
    menu: menuPanel,
    ordering: orderingPanel,
    sending: sendingPanel,
    device: devicePanel,
  };

  return h`
    ${raw(ctx.topbar({ showCart: false, showAdmin: false }))}
    <main class="page">
      <div class="page-head">
        <h1>Admin</h1>
        <p class="sub">Everything here is stored on this device only.</p>
      </div>
      <div class="tabs" role="tablist">${raw(tabs)}</div>
      <div id="admin-panel">${raw(panels[active]())}</div>
      <div class="row-actions" style="margin-top:28px;">
        <a class="btn btn-quiet" href="#/">Back to the menu</a>
      </div>
    </main>`;
}

function lockView(ctx) {
  return h`
    ${raw(ctx.topbar({ showCart: false, showAdmin: false }))}
    <main class="page page-narrow">
      <div class="card" style="margin-top:40px;">
        <h2>Admin is locked</h2>
        <div class="card-sub">Enter the staff PIN to continue.</div>
        <form id="unlock-form">
          <label class="field">
            <span class="label">PIN</span>
            <input class="input" name="pin" type="password" inputmode="numeric" autocomplete="off" maxlength="12" autofocus>
          </label>
          <div id="unlock-error"></div>
          <button class="btn btn-primary btn-lg btn-block" type="submit">Unlock</button>
        </form>
        <p class="muted small" style="margin-top:16px;">
          Forgotten the PIN? Clearing this site's data in Safari settings resets the app,
          including the menu, so export a backup first if you can.
        </p>
      </div>
    </main>`;
}

// --- Restaurant --------------------------------------------------------------

function restaurantPanel() {
  const { restaurant, brand } = state.config;
  return h`
    <div class="card">
      <h2>Restaurant details</h2>
      <div class="card-sub">These appear at the top of the ordering page and on every order.</div>
      <form data-config="restaurant">
        <label class="field">
          <span class="label">Name</span>
          <input class="input" name="name" value="${restaurant.name}" placeholder="Joe's Bistro">
        </label>
        <label class="field">
          <span class="label">Tagline</span>
          <input class="input" name="tagline" value="${restaurant.tagline}" placeholder="Wood-fired pizza since 1998">
        </label>
        <label class="field">
          <span class="label">Address</span>
          <input class="input" name="address" value="${restaurant.address}" placeholder="123 Main St, San Francisco">
        </label>
        <div class="grid-2">
          <label class="field">
            <span class="label">Phone</span>
            <input class="input" name="phone" type="tel" value="${restaurant.phone}" placeholder="+1 555 010 0100">
          </label>
          <label class="field">
            <span class="label">Website</span>
            <input class="input" name="website" value="${restaurant.website}" placeholder="joesbistro.com">
          </label>
        </div>
      </form>
    </div>

    <div class="card">
      <h2>Look</h2>
      <div class="card-sub">One accent colour runs through buttons, highlights and the app icon tint.</div>
      <form data-config="brand">
        <label class="field">
          <span class="label">Accent colour</span>
          <input class="input" name="accent" type="color" value="${brand.accent}" style="height:52px;padding:6px;max-width:120px;">
        </label>
      </form>
      <div class="row-actions">
        ${raw(['#c2410c', '#b91c1c', '#15803d', '#1d4ed8', '#7c3aed', '#0f766e', '#1c1917']
          .map((colour) => h`<button class="btn btn-sm" data-accent="${colour}" style="background:${colour};color:#fff;border-color:transparent;">${colour}</button>`)
          .join(''))}
      </div>
    </div>`;
}

// --- Menu --------------------------------------------------------------------

function menuPanel() {
  const itemCount = draft.categories.reduce((sum, c) => sum + c.items.length, 0);
  return h`
    <div class="card">
      <h2>Read a menu</h2>
      <div class="card-sub">Photograph or export your menu, and Gemini turns it into orderable items.</div>

      <div class="dropzone" id="dropzone" tabindex="0" role="button" aria-label="Choose menu files">
        <div class="dz-icon" aria-hidden="true">📄</div>
        <div class="dz-title">Tap to choose menu pages</div>
        <div class="dz-sub">Photos, screenshots or a PDF · up to 15MB in one go</div>
        <input type="file" id="menu-files" multiple accept="${SUPPORTED_TYPES.join(',')}" class="visually-hidden">
      </div>
      <div class="filelist" id="filelist"></div>

      <label class="field" style="margin-top:18px;">
        <span class="label">Or paste the menu as text</span>
        <textarea class="textarea" id="menu-text" placeholder="Starters&#10;Garlic bread .... 6.50&#10;Soup of the day .... 7.00"></textarea>
      </label>

      <label class="field">
        <span class="label">Gemini API key</span>
        <input class="input" name="geminiKey" id="gemini-key" type="password" autocomplete="off"
               value="${state.config.ai.geminiKey}" placeholder="AIza…">
        <span class="hint">
          Stored on this iPad only and used just for reading menus. Get one free at
          aistudio.google.com. Prefer not to put a key on a customer-facing iPad? Read the
          menu on your own device, then use <strong>Device → Export setup</strong>.
        </span>
      </label>

      <div class="row-actions">
        <button class="btn btn-primary btn-lg" id="parse-menu">Read the menu</button>
        <button class="btn btn-quiet" id="parse-local">Read pasted text without AI</button>
      </div>
      <div id="parse-status"></div>
    </div>

    <div class="card">
      <h2>Menu</h2>
      <div class="card-sub">
        ${draft.categories.length} ${draft.categories.length === 1 ? 'section' : 'sections'} ·
        ${itemCount} ${itemCount === 1 ? 'item' : 'items'} ·
        prices in ${esc(draft.currency)}
      </div>

      ${draftDirty ? raw('<div class="notice" style="margin-bottom:16px;">You have unsaved menu changes.</div>') : raw('')}

      <div id="menu-editor">${raw(menuEditorHtml())}</div>

      <div class="row-actions">
        <button class="btn btn-quiet" id="add-category">Add a section</button>
        <button class="btn btn-primary" id="save-menu" ${draftDirty ? raw('') : raw('disabled')}>Save menu</button>
        <button class="btn btn-ghost" id="revert-menu" ${draftDirty ? raw('') : raw('disabled')}>Discard changes</button>
      </div>
    </div>

    <div class="card">
      <h2>Move the menu around</h2>
      <div class="card-sub">Useful for setting up a second iPad, or keeping a backup.</div>
      <div class="row-actions">
        <button class="btn btn-quiet" id="export-menu">Export menu JSON</button>
        <button class="btn btn-quiet" id="import-menu">Import menu JSON</button>
        <button class="btn btn-quiet" id="load-sample-admin">Load the sample menu</button>
        <input type="file" id="import-menu-file" accept="application/json,.json" class="visually-hidden">
      </div>
    </div>`;
}

function menuEditorHtml() {
  if (!draft.categories.length) {
    return '<p class="muted">No menu yet. Read one in above, or add a section by hand.</p>';
  }
  return draft.categories
    .map(
      (category) => h`
      <div class="editor-cat" data-cat="${category.id}">
        <div class="editor-cat-head">
          <input class="input" data-cat-name="${category.id}" value="${category.name}" aria-label="Section name">
          <button class="btn btn-sm btn-quiet" data-add-item="${category.id}">Add item</button>
          <button class="btn btn-sm btn-danger" data-del-cat="${category.id}" aria-label="Delete ${category.name}">Delete</button>
        </div>
        ${raw(
          category.items
            .map(
              (item) => h`
          <div class="editor-item" data-item="${item.id}">
            <input class="input" data-item-name="${item.id}" value="${item.name}" aria-label="Item name">
            <input class="input" data-item-price="${item.id}" inputmode="decimal" value="${(item.price / 100).toFixed(2)}" aria-label="Price">
            <span style="display:flex;gap:6px;">
              <button class="btn btn-sm btn-quiet" data-edit-item="${item.id}">Details</button>
              <button class="btn btn-sm btn-danger" data-del-item="${item.id}" aria-label="Delete ${item.name}">✕</button>
            </span>
          </div>`
            )
            .join('')
        )}
      </div>`
    )
    .join('');
}

function markDirty() {
  draftDirty = true;
  const save = document.getElementById('save-menu');
  const revert = document.getElementById('revert-menu');
  if (save) save.disabled = false;
  if (revert) revert.disabled = false;
}

function refreshMenuEditor() {
  const host = document.getElementById('menu-editor');
  if (host) host.innerHTML = menuEditorHtml();
}

function findDraftItem(itemId) {
  for (const category of draft.categories) {
    const item = category.items.find((i) => i.id === itemId);
    if (item) return { item, category };
  }
  return null;
}

function openItemEditor(itemId) {
  const found = findDraftItem(itemId);
  if (!found) return;
  const { item } = found;

  // Work on a copy: the sheet's Cancel button should discard choice edits too.
  const groups = structuredClone(item.options);

  openSheet({
    title: 'Item details',
    subtitle: item.name,
    body: h`
      <label class="field">
        <span class="label">Description</span>
        <textarea class="textarea" id="ed-desc" maxlength="400">${item.description}</textarea>
      </label>
      <label class="field">
        <span class="label">Tags</span>
        <input class="input" id="ed-tags" value="${item.tags.join(', ')}" placeholder="vegetarian, spicy">
        <span class="hint">Comma separated. Shown as small chips on the menu.</span>
      </label>
      <label class="switch">
        <input type="checkbox" id="ed-available" ${item.available ? raw('checked') : raw('')}>
        <span class="switch-text">Available to order
          <span class="switch-sub">Turn off to show it as sold out.</span>
        </span>
      </label>
      <div class="divider"></div>
      <h3 style="font-size:16px;margin-bottom:4px;">Choices</h3>
      <p class="muted small">Sizes, sides, cooking temperature — anything the customer picks.</p>
      <div id="ed-groups">${raw(optionGroupsHtml(groups))}</div>
      <button class="btn btn-quiet btn-sm" id="ed-add-group" style="margin-top:12px;">Add a choice group</button>`,
    footer: '<button class="btn btn-quiet" data-close>Cancel</button><button class="btn btn-primary" id="ed-save">Save item</button>',
    onMount(node, close) {
      const rerender = () => {
        node.querySelector('#ed-groups').innerHTML = optionGroupsHtml(groups);
      };

      node.addEventListener('click', (event) => {
        const addGroup = event.target.closest('#ed-add-group');
        if (addGroup) {
          groups.push({ id: uid('g'), name: 'Size', required: false, multiple: false, choices: [{ id: uid('o'), name: 'Regular', price: 0 }] });
          rerender();
          return;
        }
        const delGroup = event.target.closest('[data-del-group]');
        if (delGroup) {
          const index = groups.findIndex((g) => g.id === delGroup.dataset.delGroup);
          if (index >= 0) groups.splice(index, 1);
          rerender();
          return;
        }
        const addChoice = event.target.closest('[data-add-choice]');
        if (addChoice) {
          const group = groups.find((g) => g.id === addChoice.dataset.addChoice);
          group?.choices.push({ id: uid('o'), name: '', price: 0 });
          rerender();
          return;
        }
        const delChoice = event.target.closest('[data-del-choice]');
        if (delChoice) {
          const group = groups.find((g) => g.id === delChoice.dataset.inGroup);
          if (group) group.choices = group.choices.filter((c) => c.id !== delChoice.dataset.delChoice);
          rerender();
          return;
        }
        if (event.target.closest('#ed-save')) {
          item.description = node.querySelector('#ed-desc').value.trim();
          item.tags = node
            .querySelector('#ed-tags')
            .value.split(',')
            .map((t) => t.trim().toLowerCase())
            .filter(Boolean);
          item.available = node.querySelector('#ed-available').checked;
          readGroupInputs(node, groups);
          item.options = groups;
          markDirty();
          refreshMenuEditor();
          close();
          toast('Item updated — remember to save the menu');
        }
      });

      node.addEventListener('input', (event) => {
        // Keep edits in the draft as the user types so re-renders do not lose them.
        if (event.target.matches('[data-group-name], [data-choice-name], [data-choice-price]')) {
          readGroupInputs(node, groups);
        }
      });
      node.addEventListener('change', (event) => {
        if (event.target.matches('[data-group-required], [data-group-multiple]')) readGroupInputs(node, groups);
      });
    },
  });
}

function optionGroupsHtml(groups) {
  if (!groups.length) return '<p class="muted small">No choices on this item.</p>';
  return groups
    .map(
      (group) => h`
      <div class="card" style="box-shadow:none;margin-top:12px;" data-group="${group.id}">
        <div style="display:flex;gap:8px;align-items:center;">
          <input class="input" data-group-name="${group.id}" value="${group.name}" aria-label="Choice group name">
          <button class="btn btn-sm btn-danger" data-del-group="${group.id}" aria-label="Delete ${group.name}">✕</button>
        </div>
        <div style="display:flex;gap:18px;flex-wrap:wrap;margin-top:6px;">
          <label class="switch"><input type="checkbox" data-group-required="${group.id}" ${group.required ? raw('checked') : raw('')}><span class="switch-text small">Must choose</span></label>
          <label class="switch"><input type="checkbox" data-group-multiple="${group.id}" ${group.multiple ? raw('checked') : raw('')}><span class="switch-text small">Can pick several</span></label>
        </div>
        ${raw(
          group.choices
            .map(
              (choice) => h`
          <div class="editor-item" style="border-bottom:0;">
            <input class="input" data-choice-name="${choice.id}" value="${choice.name}" placeholder="Large" aria-label="Choice name">
            <input class="input" data-choice-price="${choice.id}" inputmode="decimal" value="${(choice.price / 100).toFixed(2)}" aria-label="Extra cost">
            <button class="btn btn-sm btn-danger" data-del-choice="${choice.id}" data-in-group="${group.id}" aria-label="Delete choice">✕</button>
          </div>`
            )
            .join('')
        )}
        <button class="btn btn-sm btn-quiet" data-add-choice="${group.id}" style="margin-top:8px;">Add a choice</button>
      </div>`
    )
    .join('');
}

function readGroupInputs(node, groups) {
  for (const group of groups) {
    const nameInput = node.querySelector(`[data-group-name="${group.id}"]`);
    if (nameInput) group.name = nameInput.value.trim() || 'Options';
    const required = node.querySelector(`[data-group-required="${group.id}"]`);
    if (required) group.required = required.checked;
    const multiple = node.querySelector(`[data-group-multiple="${group.id}"]`);
    if (multiple) group.multiple = multiple.checked;
    for (const choice of group.choices) {
      const choiceName = node.querySelector(`[data-choice-name="${choice.id}"]`);
      if (choiceName) choice.name = choiceName.value.trim();
      const choicePrice = node.querySelector(`[data-choice-price="${choice.id}"]`);
      if (choicePrice) choice.price = parseMoney(choicePrice.value) ?? 0;
    }
  }
}

// --- Ordering ----------------------------------------------------------------

function orderingPanel() {
  const o = state.config.ordering;
  const toggle = (name, label, sub, checked) => h`
    <label class="switch">
      <input type="checkbox" name="${name}" ${checked ? raw('checked') : raw('')}>
      <span class="switch-text">${label}<span class="switch-sub">${sub}</span></span>
    </label>`;

  return h`
    <div class="card">
      <h2>What can guests order?</h2>
      <div class="card-sub">Turn off anything you do not offer.</div>
      <form data-config="ordering">
        ${raw(toggle('dineIn', 'Dine in', 'Ordering from a table in the restaurant.', o.dineIn))}
        ${raw(toggle('pickup', 'Pickup', 'Collected at the counter.', o.pickup))}
        ${raw(toggle('delivery', 'Delivery', 'Asks for an address at checkout.', o.delivery))}
        <div class="divider"></div>
        ${raw(toggle('askTableNumber', 'Ask for a table number', 'Shown for dine-in orders.', o.askTableNumber))}
        ${raw(toggle('askScheduledTime', 'Let guests pick a time', 'Otherwise every order is ASAP.', o.askScheduledTime))}
        ${raw(toggle('allowItemNotes', 'Allow notes on items', '"No onions", "extra hot", and so on.', o.allowItemNotes))}
      </form>
    </div>

    <div class="card">
      <h2>Money</h2>
      <div class="card-sub">Nothing is charged in this app — these figures only make the printed total look right.</div>
      <form data-config="ordering">
        <div class="grid-2">
          <label class="field">
            <span class="label">Currency</span>
            <input class="input" name="currency" maxlength="3" value="${o.currency}" placeholder="USD" style="text-transform:uppercase;">
          </label>
          <label class="field">
            <span class="label">Tax rate (%)</span>
            <input class="input" name="taxRatePercent" inputmode="decimal" value="${o.taxRatePercent}">
          </label>
          <label class="field">
            <span class="label">Service charge (%)</span>
            <input class="input" name="serviceChargePercent" inputmode="decimal" value="${o.serviceChargePercent}">
          </label>
          <label class="field">
            <span class="label">Minimum order</span>
            <input class="input" name="minOrderCents" inputmode="decimal" value="${(o.minOrderCents / 100).toFixed(2)}" data-money>
            <span class="hint">0 for no minimum.</span>
          </label>
        </div>
      </form>
    </div>

    <div class="card">
      <h2>Kiosk mode</h2>
      <div class="card-sub">For an iPad that sits on a table or counter and is used by one guest after another.</div>
      <form data-config="ordering">
        ${raw(toggle('kioskMode', 'Run as a shared kiosk', 'Never remembers a guest, and starts fresh between orders.', o.kioskMode))}
        <label class="field" style="margin-top:12px;max-width:240px;">
          <span class="label">Reset after (minutes idle)</span>
          <input class="input" name="idleResetMinutes" inputmode="numeric" value="${o.idleResetMinutes}">
        </label>
      </form>
    </div>`;
}

// --- Sending -----------------------------------------------------------------

function sendingPanel() {
  const d = state.config.delivery;
  const defaultBase = `${location.origin}${location.pathname}`.replace(/#.*$/, '');
  return h`
    <div class="card">
      <h2>Where do orders go?</h2>
      <div class="card-sub">Each submitted order arrives with every line item, not just a link.</div>
      <form data-config="delivery">
        <label class="field">
          <span class="label">Restaurant email</span>
          <input class="input" name="email" type="email" inputmode="email" value="${d.email}" placeholder="orders@joesbistro.com">
        </label>
        <label class="field">
          <span class="label">Restaurant mobile number</span>
          <input class="input" name="sms" type="tel" inputmode="tel" value="${d.sms}" placeholder="+15550100100">
          <span class="hint">Include the country code. Leave blank to skip the text-message button.</span>
        </label>
        <label class="switch">
          <input type="checkbox" name="ccCustomer" ${d.ccCustomer ? raw('checked') : raw('')}>
          <span class="switch-text">Copy the guest in
            <span class="switch-sub">Adds their address to the email so they get a receipt.</span>
          </span>
        </label>
      </form>
    </div>

    <div class="card">
      <h2>How they get sent</h2>
      <form data-config="delivery">
        <label class="choice">
          <input type="radio" name="method" value="DEVICE" ${d.method !== 'RELAY' ? raw('checked') : raw('')}>
          <span class="choice-name">From this iPad
            <span class="switch-sub">Opens Mail or Messages with the order filled in, ready to send. Nothing to host, nothing to pay for.</span>
          </span>
        </label>
        <label class="choice">
          <input type="radio" name="method" value="RELAY" ${d.method === 'RELAY' ? raw('checked') : raw('')}>
          <span class="choice-name">Automatically, through a relay
            <span class="switch-sub">One tap sends the email and text without opening another app. Needs the endpoint in lite/api/send-order.ts deployed.</span>
          </span>
        </label>

        <div class="divider"></div>
        <label class="field">
          <span class="label">Relay URL</span>
          <input class="input" name="relayUrl" inputmode="url" value="${d.relayUrl}" placeholder="https://your-kiosk.vercel.app/api/send-order">
        </label>
        <label class="field">
          <span class="label">Relay token</span>
          <input class="input" name="relayToken" type="password" autocomplete="off" value="${d.relayToken}">
          <span class="hint">Must match LITE_RELAY_TOKEN on the server.</span>
        </label>
      </form>
    </div>

    <div class="card">
      <h2>Share links</h2>
      <div class="card-sub">The address orders link back to. Set this if guests scan the QR code on their own phones.</div>
      <form data-config="delivery">
        <label class="field">
          <span class="label">Public address of this app</span>
          <input class="input" name="shareBaseUrl" inputmode="url" value="${d.shareBaseUrl}" placeholder="${defaultBase}">
          <span class="hint">Leave blank to use whatever address this iPad opened the app from.</span>
        </label>
      </form>
      <div class="row-actions">
        <button class="btn btn-quiet" id="use-current-url">Use this device's address</button>
        <button class="btn btn-primary" id="send-test">Send a test order</button>
      </div>
      <div id="test-status"></div>
    </div>`;
}

// --- Device ------------------------------------------------------------------

function devicePanel() {
  const hasPin = Boolean(state.config.admin.pin);
  return h`
    <div class="card">
      <h2>Lock admin</h2>
      <div class="card-sub">Stops a guest wandering into settings on a shared iPad.</div>
      <form id="pin-form">
        <label class="field" style="max-width:240px;">
          <span class="label">Staff PIN</span>
          <input class="input" name="pin" type="password" inputmode="numeric" maxlength="12" autocomplete="off" placeholder="${hasPin ? 'Set — type to change' : '4 or more digits'}">
        </label>
        <div class="row-actions">
          <button class="btn btn-primary" type="submit">${hasPin ? 'Change PIN' : 'Set PIN'}</button>
          ${hasPin ? raw('<button class="btn btn-quiet" type="button" id="clear-pin">Remove PIN</button>') : raw('')}
        </div>
      </form>
    </div>

    <div class="card">
      <h2>Copy this setup to another iPad</h2>
      <div class="card-sub">Exports the restaurant details, ordering rules and menu as one file. The Gemini key is left out on purpose.</div>
      <div class="row-actions">
        <button class="btn btn-quiet" id="export-setup">Export setup</button>
        <button class="btn btn-quiet" id="import-setup">Import setup</button>
        <input type="file" id="import-setup-file" accept="application/json,.json" class="visually-hidden">
      </div>
    </div>

    <div class="card">
      <h2>Install on this iPad</h2>
      <div class="card-sub">Runs full screen with its own icon, and keeps working if the Wi-Fi drops.</div>
      <ol class="muted" style="padding-left:20px;line-height:1.9;">
        <li>Open this page in Safari (not in another app's browser).</li>
        <li>Tap the Share button in the toolbar.</li>
        <li>Choose <strong>Add to Home Screen</strong>, then <strong>Add</strong>.</li>
      </ol>
      <p class="muted small">Guided Access (Settings → Accessibility) pins the iPad to this one app, which is worth turning on for a table kiosk.</p>
    </div>

    <div class="card">
      <h2>Orders on this device</h2>
      <div class="card-sub">${state.orders.length} stored locally. Only used for the "recent orders" list.</div>
      ${raw(
        state.orders
          .slice(0, 10)
          .map(
            (order) => h`
        <div class="cartline">
          <div class="cl-body">
            <div class="cl-name"><a href="#/o/${order.token}">${order.id}</a></div>
            <div class="cl-meta">${formatDateTime(order.createdAt)}</div>
          </div>
          <div class="cl-price">${money(order.total, order.currency)}</div>
        </div>`
          )
          .join('') || '<p class="muted">Nothing yet.</p>'
      )}
      <div class="row-actions">
        <button class="btn btn-quiet" id="clear-orders" ${state.orders.length ? raw('') : raw('disabled')}>Clear order history</button>
      </div>
    </div>

    <div class="card">
      <h2>Start over</h2>
      <div class="card-sub">Wipes the menu, settings and history from this device.</div>
      <button class="btn btn-danger" id="reset-all">Erase everything</button>
    </div>`;
}

// --- Binding -----------------------------------------------------------------

export function bindAdmin(scope, ctx) {
  const unlockForm = scope.querySelector('#unlock-form');
  if (unlockForm) {
    unlockForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const pin = new FormData(unlockForm).get('pin');
      if (String(pin) === state.config.admin.pin) {
        unlocked = true;
        ctx.render();
      } else {
        unlockForm.querySelector('#unlock-error').innerHTML =
          '<div class="notice notice-error" style="margin-bottom:14px;">That PIN did not match.</div>';
      }
    });
    return;
  }

  bindConfigForms(scope);
  bindMenuPanel(scope, ctx);
  bindSendingPanel(scope);
  bindDevicePanel(scope, ctx);

  scope.addEventListener('click', (event) => {
    const accent = event.target.closest('[data-accent]');
    if (accent) {
      event.preventDefault();
      saveConfig({ brand: { accent: accent.dataset.accent } });
      ctx.render();
    }
  });
}

/** Any form tagged data-config="<section>" writes straight into that config section. */
function bindConfigForms(scope) {
  for (const form of scope.querySelectorAll('[data-config]')) {
    const section = form.dataset.config;
    const commit = () => {
      const patch = {};
      for (const field of form.elements) {
        if (!field.name) continue;
        if (field.type === 'radio' && !field.checked) continue;
        if (field.type === 'checkbox') patch[field.name] = field.checked;
        else if (field.dataset.money !== undefined) patch[field.name] = parseMoney(field.value) ?? 0;
        else if (field.name.endsWith('Percent') || field.name.endsWith('Minutes')) patch[field.name] = Number(field.value) || 0;
        else if (field.name === 'currency') patch[field.name] = field.value.trim().toUpperCase().slice(0, 3) || 'USD';
        else patch[field.name] = field.value.trim();
      }
      saveConfig({ [section]: patch });
    };
    form.addEventListener('change', commit);
    form.addEventListener('input', debounceCommit(commit));
    if (section === 'brand') form.addEventListener('change', () => applyAccent(state.config.brand.accent));
  }
}

/** Repaint the accent without a full re-render, so the colour picker feels live. */
function applyAccent(colour) {
  document.documentElement.style.setProperty('--accent', colour);
}

function debounceCommit(fn) {
  let timer = null;
  return () => {
    clearTimeout(timer);
    timer = setTimeout(fn, 400);
  };
}

function bindMenuPanel(scope, ctx) {
  const dropzone = scope.querySelector('#dropzone');
  const fileInput = scope.querySelector('#menu-files');
  if (dropzone && fileInput) {
    dropzone.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        fileInput.click();
      }
    });
    for (const type of ['dragenter', 'dragover']) {
      dropzone.addEventListener(type, (event) => {
        event.preventDefault();
        dropzone.dataset.drag = 'true';
      });
    }
    for (const type of ['dragleave', 'drop']) {
      dropzone.addEventListener(type, (event) => {
        event.preventDefault();
        dropzone.dataset.drag = 'false';
      });
    }
    dropzone.addEventListener('drop', (event) => {
      pendingFiles = Array.from(event.dataTransfer?.files || []);
      renderFileList(scope);
    });
    fileInput.addEventListener('change', () => {
      pendingFiles = Array.from(fileInput.files || []);
      renderFileList(scope);
    });
    renderFileList(scope);
  }

  scope.querySelector('#parse-menu')?.addEventListener('click', (event) => runParse(scope, event.currentTarget, false));
  scope.querySelector('#parse-local')?.addEventListener('click', (event) => runParse(scope, event.currentTarget, true));

  scope.querySelector('#add-category')?.addEventListener('click', () => {
    draft.categories.push({ id: uid('c'), name: 'New section', description: '', items: [] });
    markDirty();
    refreshMenuEditor();
  });

  scope.querySelector('#save-menu')?.addEventListener('click', () => {
    try {
      saveMenu(draft);
      draft = structuredClone(state.menu);
      draftDirty = false;
      toast('Menu saved');
      ctx.render();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  scope.querySelector('#revert-menu')?.addEventListener('click', () => {
    draft = structuredClone(state.menu);
    draftDirty = false;
    ctx.render();
  });

  const editor = scope.querySelector('#menu-editor');
  if (editor) {
    editor.addEventListener('input', (event) => {
      const target = event.target;
      if (target.dataset.catName) {
        const category = draft.categories.find((c) => c.id === target.dataset.catName);
        if (category) category.name = target.value;
        markDirty();
      } else if (target.dataset.itemName) {
        const found = findDraftItem(target.dataset.itemName);
        if (found) found.item.name = target.value;
        markDirty();
      } else if (target.dataset.itemPrice) {
        const found = findDraftItem(target.dataset.itemPrice);
        if (found) found.item.price = parseMoney(target.value) ?? 0;
        markDirty();
      }
    });

    editor.addEventListener('click', async (event) => {
      const addItem = event.target.closest('[data-add-item]');
      if (addItem) {
        const category = draft.categories.find((c) => c.id === addItem.dataset.addItem);
        category?.items.push({ id: uid('i'), name: 'New item', description: '', price: 0, tags: [], available: true, options: [] });
        markDirty();
        refreshMenuEditor();
        return;
      }
      const delItem = event.target.closest('[data-del-item]');
      if (delItem) {
        for (const category of draft.categories) {
          category.items = category.items.filter((i) => i.id !== delItem.dataset.delItem);
        }
        markDirty();
        refreshMenuEditor();
        return;
      }
      const delCat = event.target.closest('[data-del-cat]');
      if (delCat) {
        const category = draft.categories.find((c) => c.id === delCat.dataset.delCat);
        const ok = await confirmSheet({
          title: 'Delete section?',
          message: `"${category?.name || 'This section'}" and its ${category?.items.length || 0} items will be removed from the menu.`,
          confirmLabel: 'Delete',
          danger: true,
        });
        if (!ok) return;
        draft.categories = draft.categories.filter((c) => c.id !== delCat.dataset.delCat);
        markDirty();
        refreshMenuEditor();
        return;
      }
      const editItem = event.target.closest('[data-edit-item]');
      if (editItem) openItemEditor(editItem.dataset.editItem);
    });
  }

  scope.querySelector('#export-menu')?.addEventListener('click', () => {
    downloadFile(`menu-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(state.menu, null, 2));
    toast('Menu exported');
  });

  const importMenuInput = scope.querySelector('#import-menu-file');
  scope.querySelector('#import-menu')?.addEventListener('click', () => importMenuInput?.click());
  importMenuInput?.addEventListener('change', async () => {
    const file = importMenuInput.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      draft = normaliseMenu(parsed.menu || parsed);
      markDirty();
      toast('Menu loaded — review it, then save');
      ctx.render();
    } catch (err) {
      toast(err.message || 'That file could not be read', 'error');
    }
  });

  scope.querySelector('#load-sample-admin')?.addEventListener('click', async () => {
    try {
      const sample = await ctx.fetchSampleMenu();
      draft = normaliseMenu(sample.menu || sample);
      if (sample.restaurant && !state.config.restaurant.name) saveConfig({ restaurant: sample.restaurant });
      markDirty();
      toast('Sample menu loaded — review it, then save');
      ctx.render();
    } catch (err) {
      toast(err.message || 'Could not load the sample menu', 'error');
    }
  });
}

function renderFileList(scope) {
  const host = scope.querySelector('#filelist');
  if (!host) return;
  host.innerHTML = pendingFiles
    .map(
      (file) => h`
      <div class="filechip">
        <span class="name">${file.name}</span>
        <span class="size">${(file.size / 1024 / 1024).toFixed(1)} MB</span>
      </div>`
    )
    .join('');
}

async function runParse(scope, button, localOnly) {
  const status = scope.querySelector('#parse-status');
  const text = scope.querySelector('#menu-text')?.value || '';
  const key = scope.querySelector('#gemini-key')?.value.trim() || '';

  if (key && key !== state.config.ai.geminiKey) saveConfig({ ai: { geminiKey: key } });

  const setStatus = (html) => {
    status.innerHTML = html;
  };

  if (localOnly && !text.trim()) {
    setStatus('<div class="notice notice-error" style="margin-top:14px;">Paste the menu text first.</div>');
    return;
  }

  const original = button.textContent;
  button.disabled = true;
  button.innerHTML = '<span class="spinner"></span> Reading…';
  setStatus('');

  try {
    const parsed = localOnly
      ? parseMenuTextLocally(text, state.config.ordering.currency)
      : await parseMenu({
          files: pendingFiles,
          text,
          apiKey: key,
          model: state.config.ai.model,
          currency: state.config.ordering.currency,
        });

    const incoming = normaliseMenu(parsed);
    const itemCount = incoming.categories.reduce((sum, c) => sum + c.items.length, 0);
    if (!itemCount) throw new Error('Nothing readable came back. Try a clearer photo, or paste the text.');

    setStatus(h`
      <div class="notice notice-ok" style="margin-top:14px;">
        Read ${itemCount} ${itemCount === 1 ? 'item' : 'items'} across ${incoming.categories.length}
        ${incoming.categories.length === 1 ? 'section' : 'sections'}. Check them below before saving.
      </div>
      <div class="row-actions">
        <button class="btn btn-primary" id="apply-replace">Use this menu</button>
        <button class="btn btn-quiet" id="apply-append" ${menuIsEmpty() ? raw('disabled') : raw('')}>Add to the current menu</button>
      </div>`);

    status.querySelector('#apply-replace').addEventListener('click', () => {
      draft = incoming;
      if (incoming.name && !state.config.restaurant.name) saveConfig({ restaurant: { name: incoming.name } });
      if (incoming.currency) saveConfig({ ordering: { currency: incoming.currency } });
      markDirty();
      toast('Menu ready — review it, then save');
      renderFromDraft(scope);
    });
    status.querySelector('#apply-append').addEventListener('click', () => {
      draft.categories.push(...incoming.categories);
      markDirty();
      toast('Sections added — review them, then save');
      renderFromDraft(scope);
    });
  } catch (err) {
    setStatus(h`<div class="notice notice-error" style="margin-top:14px;">${err.message}</div>`);
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

function renderFromDraft(scope) {
  const host = scope.querySelector('#menu-editor');
  if (host) {
    host.innerHTML = menuEditorHtml();
    host.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  markDirty();
}

function bindSendingPanel(scope) {
  scope.querySelector('#use-current-url')?.addEventListener('click', () => {
    const base = `${location.origin}${location.pathname}`.replace(/#.*$/, '');
    saveConfig({ delivery: { shareBaseUrl: base } });
    const input = scope.querySelector('[name="shareBaseUrl"]');
    if (input) input.value = base;
    toast('Share address set');
  });

  scope.querySelector('#send-test')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    const status = scope.querySelector('#test-status');
    const options = deliveryOptions(state.config);
    if (!options.hasEmail && !options.hasSms && options.mode !== 'RELAY') {
      status.innerHTML = '<div class="notice notice-error" style="margin-top:14px;">Add an email address or a mobile number first.</div>';
      return;
    }

    const order = buildOrder({
      cart: {
        lines: [{ itemId: 'test', name: 'Test item — please ignore', unit: 100, qty: 1, options: [], note: '' }],
        orderType: 'PICKUP',
        scheduledFor: 'ASAP',
        note: 'This is a test order from menyo lite setup.',
      },
      session: { name: 'Test order', email: '', phone: '' },
      config: state.config,
    });
    const rawLink = shareUrl(await encodeOrder(order), state.config);
    const link = /^https?:\/\//i.test(rawLink) ? rawLink : '';

    if (options.mode === 'RELAY') {
      button.disabled = true;
      button.innerHTML = '<span class="spinner"></span> Sending…';
      try {
        await sendViaRelay(order, link, state.config);
        status.innerHTML = '<div class="notice notice-ok" style="margin-top:14px;">Relay accepted the test order.</div>';
      } catch (err) {
        status.innerHTML = h`<div class="notice notice-error" style="margin-top:14px;">${err.message}</div>`;
      } finally {
        button.disabled = false;
        button.textContent = 'Send a test order';
      }
      return;
    }

    if (options.hasEmail) window.location.href = mailtoUrl(order, link, state.config);
    else window.location.href = smsUrl(order, link, state.config);
  });
}

function bindDevicePanel(scope, ctx) {
  const pinForm = scope.querySelector('#pin-form');
  pinForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    const pin = String(new FormData(pinForm).get('pin') || '').trim();
    if (pin.length < 4) {
      toast('Use at least 4 digits', 'error');
      return;
    }
    saveConfig({ admin: { pin } });
    unlocked = true;
    toast('PIN saved');
    ctx.render();
  });

  scope.querySelector('#clear-pin')?.addEventListener('click', () => {
    saveConfig({ admin: { pin: '' } });
    toast('PIN removed');
    ctx.render();
  });

  scope.querySelector('#export-setup')?.addEventListener('click', () => {
    downloadFile(`menyo-lite-setup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(exportSetup(), null, 2));
    toast('Setup exported');
  });

  const setupInput = scope.querySelector('#import-setup-file');
  scope.querySelector('#import-setup')?.addEventListener('click', () => setupInput?.click());
  setupInput?.addEventListener('change', async () => {
    const file = setupInput.files?.[0];
    if (!file) return;
    try {
      importSetup(JSON.parse(await file.text()));
      draft = structuredClone(state.menu);
      draftDirty = false;
      toast('Setup imported');
      ctx.render();
    } catch (err) {
      toast(err.message || 'That file could not be read', 'error');
    }
  });

  scope.querySelector('#clear-orders')?.addEventListener('click', async () => {
    const ok = await confirmSheet({
      title: 'Clear order history?',
      message: 'The list of recent orders on this device is removed. Orders already sent to the restaurant are not affected.',
      confirmLabel: 'Clear',
      danger: true,
    });
    if (!ok) return;
    clearOrders();
    ctx.render();
  });

  scope.querySelector('#reset-all')?.addEventListener('click', async () => {
    const ok = await confirmSheet({
      title: 'Erase everything?',
      message: 'The menu, restaurant details, settings and order history are all removed from this iPad. Export a backup first if you might want them back.',
      confirmLabel: 'Erase',
      danger: true,
    });
    if (!ok) return;
    resetEverything();
    draft = null;
    draftDirty = false;
    pendingFiles = [];
    unlocked = false;
    toast('This device has been reset');
    ctx.go('/');
  });
}

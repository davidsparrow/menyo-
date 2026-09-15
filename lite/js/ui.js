/** Toasts and modal sheets — shared by the ordering screens and the admin console. */
import { h, raw } from './util.js';

export function toast(message, kind = '') {
  const host = document.getElementById('toasts');
  if (!host) return;
  const node = document.createElement('div');
  node.className = `toast${kind ? ` toast-${kind}` : ''}`;
  node.textContent = message;
  host.appendChild(node);
  setTimeout(() => node.remove(), kind === 'error' ? 5200 : 3000);
}

let activeSheet = null;

export function openSheet({ title, subtitle = '', body, footer = '', onMount }) {
  closeActiveSheet();
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = h`
    <div class="sheet" role="dialog" aria-modal="true" aria-label="${title}">
      <div class="sheet-head">
        <div>
          <h2>${title}</h2>
          ${subtitle ? raw(h`<div class="sheet-sub">${subtitle}</div>`) : raw('')}
        </div>
        <button class="btn btn-quiet btn-sm sheet-close" data-close aria-label="Close">Close</button>
      </div>
      <div class="sheet-body">${raw(body)}</div>
      ${footer ? raw(`<div class="sheet-foot">${footer}</div>`) : raw('')}
    </div>`;

  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop || event.target.closest('[data-close]')) closeActiveSheet();
  });

  document.body.appendChild(backdrop);
  document.body.style.overflow = 'hidden';
  activeSheet = () => {
    backdrop.remove();
    document.body.style.overflow = '';
    activeSheet = null;
  };
  onMount?.(backdrop, activeSheet);
  return activeSheet;
}

export function closeActiveSheet() {
  activeSheet?.();
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeActiveSheet();
});

/** Replace a sheet's body without tearing down its event listeners. */
export function updateSheet(node, { body, subtitle }) {
  if (body !== undefined) node.querySelector('.sheet-body').innerHTML = body;
  if (subtitle !== undefined) {
    const sub = node.querySelector('.sheet-head .sheet-sub');
    if (sub) sub.textContent = subtitle;
  }
}

/** A yes/no confirmation that matches the app's sheet styling. */
export function confirmSheet({ title, message, confirmLabel = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    openSheet({
      title,
      body: h`<p>${message}</p>`,
      footer: h`
        <button class="btn btn-quiet" data-close>Cancel</button>
        <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-confirm>${confirmLabel}</button>`,
      onMount(node, close) {
        node.addEventListener('click', (event) => {
          if (event.target.closest('[data-confirm]')) {
            finish(true);
            close();
          } else if (event.target === node || event.target.closest('[data-close]')) {
            finish(false);
          }
        });
      },
    });
  });
}

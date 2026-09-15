/** Small DOM / formatting helpers shared by every view. */

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

/** Escape a value for safe interpolation into HTML. */
export function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Tagged template that escapes every interpolation. Use `raw()` to opt a
 * value out when it is already trusted markup.
 *   h`<p>${userText}</p>`
 */
export function h(strings, ...values) {
  return strings.reduce((acc, str, i) => {
    if (i === 0) return str;
    const value = values[i - 1];
    const rendered = Array.isArray(value)
      ? value.map((v) => (v && v.__raw ? v.value : esc(v))).join('')
      : value && value.__raw
        ? value.value
        : esc(value);
    return acc + rendered + str;
  }, '');
}

export const raw = (value) => ({ __raw: true, value: value == null ? '' : String(value) });

/** Format integer minor units (cents) using the browser's locale rules. */
export function money(cents, currency = 'USD') {
  const amount = (Number(cents) || 0) / 100;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

/** Parse "$12.50", "12,50" or "12.5" into 1250. Returns null when unparseable. */
export function parseMoney(input) {
  if (input === null || input === undefined || input === '') return null;
  if (typeof input === 'number') return Math.round(input * 100);
  const cleaned = String(input).replace(/[^\d.,-]/g, '').trim();
  if (!cleaned) return null;
  // Treat the last separator as the decimal point (handles "1.234,50").
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  let normalised = cleaned;
  if (lastComma > lastDot) {
    normalised = cleaned.replace(/\./g, '').replace(',', '.');
  } else {
    normalised = cleaned.replace(/,/g, '');
  }
  const value = Number.parseFloat(normalised);
  return Number.isFinite(value) ? Math.round(value * 100) : null;
}

const ID_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // no 0/O/1/I

export function uid(prefix = '') {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const body = Array.from(bytes, (b) => ID_ALPHABET[b % ID_ALPHABET.length]).join('');
  return prefix ? `${prefix}_${body}` : body;
}

/** Short, human-readable order code the restaurant can call out loud. */
export function orderCode() {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  const chars = Array.from(bytes, (b) => ID_ALPHABET[b % ID_ALPHABET.length]);
  return `${chars.slice(0, 3).join('')}-${chars.slice(3).join('')}`;
}

export function slug(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

export function debounce(fn, ms = 200) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export function formatDateTime(timestamp) {
  const date = new Date(timestamp);
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

/** Read a File as base64 (without the data: prefix) plus its mime type. */
export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('Could not read file'));
    reader.onload = () => {
      const result = String(reader.result);
      resolve({ base64: result.slice(result.indexOf(',') + 1), mimeType: file.type || 'application/octet-stream' });
    };
    reader.readAsDataURL(file);
  });
}

export function downloadFile(filename, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Copy text to the clipboard, falling back to a hidden textarea on older iPadOS. */
export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    area.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

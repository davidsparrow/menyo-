/**
 * Cart maths, order construction, and the self-contained share link.
 *
 * A submitted order is packed into the URL fragment, so the receipt link works
 * on any static host with no database behind it — and because it lives in the
 * fragment, the order details are never sent to the web server.
 */
import { money, orderCode, esc } from './util.js';

export const ORDER_TYPES = {
  DINE_IN: { code: 'D', label: 'Dine in' },
  PICKUP: { code: 'P', label: 'Pickup' },
  DELIVERY: { code: 'X', label: 'Delivery' },
};

const TYPE_BY_CODE = Object.fromEntries(
  Object.entries(ORDER_TYPES).map(([key, value]) => [value.code, key])
);

/** Unit price of a cart line including its selected options. */
export function lineUnitPrice(line) {
  const options = (line.options || []).reduce((sum, o) => sum + (o.price || 0), 0);
  return (line.unit || 0) + options;
}

export function lineTotal(line) {
  return lineUnitPrice(line) * (line.qty || 0);
}

export function cartTotals(cart, ordering) {
  const subtotal = (cart.lines || []).reduce((sum, line) => sum + lineTotal(line), 0);
  const servicePercent = Number(ordering?.serviceChargePercent) || 0;
  const taxPercent = Number(ordering?.taxRatePercent) || 0;
  const serviceCharge = Math.round((subtotal * servicePercent) / 100);
  const tax = Math.round((subtotal * taxPercent) / 100);
  return {
    subtotal,
    serviceCharge,
    servicePercent,
    tax,
    taxPercent,
    total: subtotal + serviceCharge + tax,
  };
}

/** Build the immutable order record that gets shared, emailed and texted. */
export function buildOrder({ cart, session, config }) {
  const totals = cartTotals(cart, config.ordering);
  return {
    version: 1,
    id: orderCode(),
    createdAt: Date.now(),
    currency: config.ordering.currency || 'USD',
    restaurant: {
      name: config.restaurant.name || 'Our restaurant',
      phone: config.restaurant.phone || '',
      address: config.restaurant.address || '',
    },
    customer: {
      name: session?.name || '',
      email: session?.email || '',
      phone: session?.phone || '',
    },
    orderType: cart.orderType || 'PICKUP',
    tableNumber: cart.tableNumber || '',
    deliveryAddress: cart.deliveryAddress || '',
    scheduledFor: cart.scheduledFor || 'ASAP',
    note: cart.note || '',
    lines: (cart.lines || []).map((line) => ({
      name: line.name,
      qty: line.qty,
      unit: line.unit,
      options: (line.options || []).map((o) => ({ name: o.name, price: o.price })),
      note: line.note || '',
      total: lineTotal(line),
    })),
    ...totals,
  };
}

// --- Compact wire format -----------------------------------------------------

function toWire(order) {
  return {
    v: 1,
    i: order.id,
    t: Math.round(order.createdAt / 1000),
    c: order.currency,
    r: [order.restaurant.name, order.restaurant.phone, order.restaurant.address],
    u: [order.customer.name, order.customer.email, order.customer.phone],
    k: ORDER_TYPES[order.orderType]?.code || 'P',
    b: order.tableNumber || undefined,
    d: order.deliveryAddress || undefined,
    w: order.scheduledFor === 'ASAP' ? undefined : order.scheduledFor,
    m: order.note || undefined,
    l: order.lines.map((line) => [
      line.name,
      line.qty,
      line.unit,
      (line.options || []).map((o) => [o.name, o.price]),
      line.note || '',
    ]),
    s: order.subtotal,
    g: order.serviceCharge || undefined,
    gp: order.servicePercent || undefined,
    x: order.tax || undefined,
    xp: order.taxPercent || undefined,
    o: order.total,
  };
}

function fromWire(w) {
  if (!w || w.v !== 1) throw new Error('Unrecognised order link.');
  const lines = (w.l || []).map((l) => {
    const options = (l[3] || []).map((o) => ({ name: o[0], price: o[1] || 0 }));
    const unit = l[2] || 0;
    const qty = l[1] || 0;
    const optionsTotal = options.reduce((sum, o) => sum + o.price, 0);
    return { name: l[0], qty, unit, options, note: l[4] || '', total: (unit + optionsTotal) * qty };
  });
  return {
    version: 1,
    id: w.i,
    createdAt: (w.t || 0) * 1000,
    currency: w.c || 'USD',
    restaurant: { name: w.r?.[0] || '', phone: w.r?.[1] || '', address: w.r?.[2] || '' },
    customer: { name: w.u?.[0] || '', email: w.u?.[1] || '', phone: w.u?.[2] || '' },
    orderType: TYPE_BY_CODE[w.k] || 'PICKUP',
    tableNumber: w.b || '',
    deliveryAddress: w.d || '',
    scheduledFor: w.w || 'ASAP',
    note: w.m || '',
    lines,
    subtotal: w.s || 0,
    serviceCharge: w.g || 0,
    servicePercent: w.gp || 0,
    tax: w.x || 0,
    taxPercent: w.xp || 0,
    total: w.o || 0,
  };
}

function bytesToBase64Url(bytes) {
  let binary = '';
  const CHUNK = 0x8000; // keep String.fromCharCode off the argument limit
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(text) {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deflate(bytes) {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Pack an order into a URL-safe token. Prefix `2` means deflate-raw compressed,
 * `1` means plain JSON — older browsers without CompressionStream still work.
 */
export async function encodeOrder(order) {
  const json = JSON.stringify(toWire(order));
  const bytes = new TextEncoder().encode(json);
  const packed = await deflate(bytes);
  if (packed && packed.length < bytes.length) return `2${bytesToBase64Url(packed)}`;
  return `1${bytesToBase64Url(bytes)}`;
}

export async function decodeOrder(token) {
  if (!token || token.length < 2) throw new Error('Empty order link.');
  const format = token[0];
  let bytes = base64UrlToBytes(token.slice(1));
  if (format === '2') {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('This browser cannot open compressed order links. Try Safari 16.4 or newer.');
    }
    bytes = await inflate(bytes);
  } else if (format !== '1') {
    throw new Error('Unrecognised order link format.');
  }
  return fromWire(JSON.parse(new TextDecoder().decode(bytes)));
}

/** Absolute URL that renders this order's receipt. */
export function shareUrl(token, config) {
  const configured = (config?.delivery?.shareBaseUrl || '').trim();
  let base = configured;
  if (!base) {
    base = `${location.origin}${location.pathname}`;
  }
  base = base.replace(/#.*$/, '');
  if (base.endsWith('/')) base += 'index.html';
  return `${base}#/o/${token}`;
}

// --- Renderings used by the receipt screen, the email and the SMS ------------

export function orderTypeLabel(order) {
  const label = ORDER_TYPES[order.orderType]?.label || order.orderType;
  if (order.orderType === 'DINE_IN' && order.tableNumber) return `${label} · Table ${order.tableNumber}`;
  return label;
}

function lineDescriptor(line) {
  const parts = [];
  if (line.options?.length) parts.push(line.options.map((o) => o.name).join(', '));
  if (line.note) parts.push(`note: ${line.note}`);
  return parts.join(' — ');
}

/** Plain text used for SMS and as the email's text fallback. */
export function orderToText(order, link) {
  const currency = order.currency;
  const rows = order.lines.map((line) => {
    const extra = lineDescriptor(line);
    return `${line.qty} x ${line.name}${extra ? ` (${extra})` : ''} — ${money(line.total, currency)}`;
  });
  const lines = [
    `NEW ORDER ${order.id}`,
    `${order.restaurant.name}`,
    '',
    `Type: ${orderTypeLabel(order)}`,
    order.scheduledFor && order.scheduledFor !== 'ASAP' ? `Requested for: ${order.scheduledFor}` : 'Requested for: ASAP',
    order.orderType === 'DELIVERY' && order.deliveryAddress ? `Deliver to: ${order.deliveryAddress}` : '',
    '',
    `Customer: ${order.customer.name}`,
    order.customer.phone ? `Phone: ${order.customer.phone}` : '',
    order.customer.email ? `Email: ${order.customer.email}` : '',
    '',
    'ITEMS',
    ...rows,
    '',
    `Subtotal: ${money(order.subtotal, currency)}`,
    order.serviceCharge ? `Service (${order.servicePercent}%): ${money(order.serviceCharge, currency)}` : '',
    order.tax ? `Tax (${order.taxPercent}%): ${money(order.tax, currency)}` : '',
    `TOTAL: ${money(order.total, currency)}`,
    order.note ? `\nOrder note: ${order.note}` : '',
    link ? `\nFull order: ${link}` : '',
    '',
    'Payment has NOT been taken. Re-enter this order in your own system.',
  ];
  return lines.filter((l) => l !== '').join('\n');
}

/**
 * Deliberately short so it fits in as few SMS segments as possible. A
 * self-contained link is a few hundred characters on its own, so the item list
 * is capped: the link always carries the complete order.
 */
const SMS_ITEM_LIMIT = 6;

export function orderToSms(order, link) {
  const shown = order.lines.slice(0, SMS_ITEM_LIMIT).map((l) => `${l.qty}x ${l.name}`);
  const hidden = order.lines.length - shown.length;
  if (hidden > 0) shown.push(`+${hidden} more item${hidden === 1 ? '' : 's'}`);

  const where =
    order.orderType === 'DINE_IN' && order.tableNumber
      ? `Table ${order.tableNumber}`
      : orderTypeLabel(order);

  return [
    `NEW ORDER ${order.id} (${where})`,
    `${order.customer.name}${order.customer.phone ? ` ${order.customer.phone}` : ''}`,
    shown.join(', '),
    `Total ${money(order.total, order.currency)} (unpaid)`,
    link,
  ]
    .filter(Boolean)
    .join('\n');
}

/** Comma-separated rows the restaurant can paste straight into a spreadsheet. */
export function orderToCsv(order) {
  const quote = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const rows = [['order_id', 'item', 'quantity', 'unit_price', 'options', 'item_note', 'line_total'].join(',')];
  for (const line of order.lines) {
    rows.push([
      quote(order.id),
      quote(line.name),
      line.qty,
      (line.unit / 100).toFixed(2),
      quote((line.options || []).map((o) => o.name).join('; ')),
      quote(line.note || ''),
      (line.total / 100).toFixed(2),
    ].join(','));
  }
  return rows.join('\n');
}

export function orderToHtml(order, link) {
  const currency = order.currency;
  const rows = order.lines
    .map((line) => {
      const extra = lineDescriptor(line);
      return `
        <tr>
          <td style="padding:10px 8px;border-bottom:1px solid #e8e3dd;vertical-align:top;">
            <strong style="color:#1c1917;">${esc(line.name)}</strong>
            ${extra ? `<div style="color:#78716c;font-size:13px;margin-top:2px;">${esc(extra)}</div>` : ''}
          </td>
          <td style="padding:10px 8px;border-bottom:1px solid #e8e3dd;text-align:center;white-space:nowrap;">x${line.qty}</td>
          <td style="padding:10px 8px;border-bottom:1px solid #e8e3dd;text-align:right;white-space:nowrap;">${esc(money(line.total, currency))}</td>
        </tr>`;
    })
    .join('');

  const totalRow = (label, value, bold = false) => `
    <tr>
      <td colspan="2" style="padding:6px 8px;text-align:right;color:#57534e;${bold ? 'font-weight:700;color:#1c1917;font-size:18px;' : ''}">${esc(label)}</td>
      <td style="padding:6px 8px;text-align:right;white-space:nowrap;${bold ? 'font-weight:700;color:#1c1917;font-size:18px;' : ''}">${esc(value)}</td>
    </tr>`;

  const detail = (label, value) =>
    value ? `<div style="margin:4px 0;"><span style="color:#78716c;">${esc(label)}:</span> <strong>${esc(value)}</strong></div>` : '';

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:24px 12px;background:#faf7f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1c1917;">
  <div style="max-width:620px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e8e3dd;">
    <div style="background:#1c1917;color:#fff;padding:22px 24px;">
      <div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;opacity:.7;">New order</div>
      <div style="font-size:30px;font-weight:700;letter-spacing:-.02em;margin-top:4px;">${esc(order.id)}</div>
      <div style="opacity:.75;margin-top:4px;">${esc(order.restaurant.name)}</div>
    </div>

    <div style="padding:20px 24px;background:#fffbeb;border-bottom:1px solid #fde68a;color:#78350f;">
      <strong>No payment has been taken.</strong> This order was placed on the in-store
      ordering page. Re-enter it in your own till or ordering system.
    </div>

    <div style="padding:20px 24px;">
      ${detail('Type', orderTypeLabel(order))}
      ${detail('Requested for', order.scheduledFor || 'ASAP')}
      ${detail('Deliver to', order.orderType === 'DELIVERY' ? order.deliveryAddress : '')}
      ${detail('Customer', order.customer.name)}
      ${detail('Phone', order.customer.phone)}
      ${detail('Email', order.customer.email)}
      ${order.note ? `<div style="margin-top:12px;padding:12px;background:#f5f5f4;border-radius:10px;"><span style="color:#78716c;">Order note:</span> ${esc(order.note)}</div>` : ''}
    </div>

    <table role="presentation" style="width:100%;border-collapse:collapse;font-size:15px;">
      <thead>
        <tr>
          <th style="text-align:left;padding:8px;border-bottom:2px solid #1c1917;font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:#78716c;">Item</th>
          <th style="text-align:center;padding:8px;border-bottom:2px solid #1c1917;font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:#78716c;">Qty</th>
          <th style="text-align:right;padding:8px;border-bottom:2px solid #1c1917;font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:#78716c;">Total</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        ${totalRow('Subtotal', money(order.subtotal, currency))}
        ${order.serviceCharge ? totalRow(`Service (${order.servicePercent}%)`, money(order.serviceCharge, currency)) : ''}
        ${order.tax ? totalRow(`Tax (${order.taxPercent}%)`, money(order.tax, currency)) : ''}
        ${totalRow('Total due', money(order.total, currency), true)}
      </tfoot>
    </table>

    ${link ? `<div style="padding:20px 24px;"><a href="${esc(link)}" style="display:block;text-align:center;background:#1c1917;color:#fff;text-decoration:none;padding:14px;border-radius:12px;font-weight:600;">Open the order page</a></div>` : ''}

    <div style="padding:20px 24px;border-top:1px solid #e8e3dd;background:#faf7f2;">
      <div style="font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:#78716c;margin-bottom:8px;">Copy into a spreadsheet</div>
      <pre style="margin:0;padding:12px;background:#fff;border:1px solid #e8e3dd;border-radius:8px;font-size:12px;overflow-x:auto;white-space:pre;">${esc(orderToCsv(order))}</pre>
      <div style="font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:#78716c;margin:16px 0 8px;">Machine-readable order</div>
      <pre style="margin:0;padding:12px;background:#fff;border:1px solid #e8e3dd;border-radius:8px;font-size:12px;overflow-x:auto;white-space:pre-wrap;">${esc(JSON.stringify(toWire(order)))}</pre>
    </div>
  </div>
</body></html>`;
}

export function emailSubject(order) {
  const where =
    order.orderType === 'DINE_IN' && order.tableNumber
      ? `Table ${order.tableNumber}`
      : orderTypeLabel(order);
  return `New order ${order.id} — ${where} — ${order.customer.name || 'Guest'} — ${money(order.total, order.currency)}`;
}

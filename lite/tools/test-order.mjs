/**
 * Round-trip tests for the order model and the share-link encoding.
 *
 *   node lite/tools/test-order.mjs
 */
import {
  buildOrder,
  cartTotals,
  encodeOrder,
  decodeOrder,
  orderToText,
  orderToSms,
  orderToCsv,
  emailSubject,
  shareUrl,
  lineUnitPrice,
} from '../js/order.js';
import { qrMatrix } from '../js/qr.js';
import { parseMoney, money } from '../js/util.js';

let passed = 0;
const failures = [];

async function check(name, fn) {
  try {
    await fn();
    passed++;
  } catch (err) {
    failures.push(`${name}: ${err.message}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'assertion failed');
}

function equal(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message || 'values differ'} — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  }
}

const config = {
  restaurant: { name: 'Bramble & Oak', phone: '+15550100184', address: '184 Halsey Street' },
  ordering: { currency: 'USD', taxRatePercent: 8.875, serviceChargePercent: 5 },
  delivery: { shareBaseUrl: 'https://order.example.com/lite/index.html' },
};

const cart = {
  lines: [
    {
      itemId: 'i1',
      name: 'Margherita',
      unit: 1700,
      qty: 2,
      options: [
        { groupId: 'g1', groupName: 'Size', choiceId: 'o2', name: '16 inch', price: 600 },
        { groupId: 'g2', groupName: 'Add to it', choiceId: 'o5', name: 'Hot honey', price: 200 },
      ],
      note: 'well done',
    },
    { itemId: 'i2', name: 'Hand-cut chips', unit: 800, qty: 1, options: [], note: '' },
  ],
  orderType: 'DINE_IN',
  tableNumber: '12',
  deliveryAddress: '',
  scheduledFor: '19:30',
  note: 'One nut allergy at the table.',
};

const session = { name: 'Alex Moore', email: 'alex@example.com', phone: '+15550100199' };

await check('line unit price includes options', () => {
  equal(lineUnitPrice(cart.lines[0]), 2500);
  equal(lineUnitPrice(cart.lines[1]), 800);
});

await check('cart totals apply service charge and tax to the subtotal', () => {
  const totals = cartTotals(cart, config.ordering);
  equal(totals.subtotal, 5800, 'subtotal');
  equal(totals.serviceCharge, 290, 'service charge');
  equal(totals.tax, 515, 'tax'); // round(5800 * 8.875%)
  equal(totals.total, 6605, 'total');
});

await check('totals are zero-safe with no lines', () => {
  const totals = cartTotals({ lines: [] }, config.ordering);
  equal(totals.subtotal, 0);
  equal(totals.total, 0);
});

const order = buildOrder({ cart, session, config });

await check('buildOrder captures the whole order', () => {
  equal(order.lines.length, 2);
  equal(order.orderType, 'DINE_IN');
  equal(order.tableNumber, '12');
  equal(order.scheduledFor, '19:30');
  equal(order.customer.name, 'Alex Moore');
  equal(order.restaurant.name, 'Bramble & Oak');
  equal(order.total, 6605);
  assert(/^[0-9A-Z]{3}-[0-9A-Z]{3}$/.test(order.id), `order id looks wrong: ${order.id}`);
});

const token = await encodeOrder(order);

await check('the share token is compressed and URL-safe', () => {
  assert(token[0] === '2', 'expected the deflate-raw format marker');
  assert(/^[0-9A-Za-z\-_]+$/.test(token.slice(1)), 'token should be base64url');
});

await check('decoding restores every field', async () => {
  const back = await decodeOrder(token);
  equal(back.id, order.id, 'id');
  equal(back.total, order.total, 'total');
  equal(back.subtotal, order.subtotal, 'subtotal');
  equal(back.tax, order.tax, 'tax');
  equal(back.taxPercent, order.taxPercent, 'tax percent');
  equal(back.serviceCharge, order.serviceCharge, 'service charge');
  equal(back.orderType, order.orderType, 'order type');
  equal(back.tableNumber, order.tableNumber, 'table number');
  equal(back.scheduledFor, order.scheduledFor, 'scheduled time');
  equal(back.note, order.note, 'order note');
  equal(back.customer.email, order.customer.email, 'customer email');
  equal(back.restaurant.address, order.restaurant.address, 'restaurant address');
  equal(back.lines.length, order.lines.length, 'line count');
  equal(back.lines[0].name, 'Margherita');
  equal(back.lines[0].qty, 2);
  equal(back.lines[0].total, 5000);
  equal(back.lines[0].note, 'well done');
  equal(back.lines[0].options.map((o) => o.name).join(','), '16 inch,Hot honey');
  equal(Math.round(back.createdAt / 1000), Math.round(order.createdAt / 1000), 'timestamp');
});

const decoded = await decodeOrder(token);
await check('every line survives the round trip', () => {
  equal(decoded.lines[1].name, 'Hand-cut chips');
  equal(decoded.lines[1].total, 800);
});

await check('an ASAP order drops the scheduled field', async () => {
  const asap = buildOrder({ cart: { ...cart, scheduledFor: 'ASAP' }, session, config });
  const round = await decodeOrder(await encodeOrder(asap));
  equal(round.scheduledFor, 'ASAP');
});

await check('a bad token is rejected rather than silently mis-read', async () => {
  let threw = false;
  try {
    await decodeOrder('9notarealtoken');
  } catch {
    threw = true;
  }
  assert(threw, 'expected decodeOrder to throw');
});

await check('share URL uses the configured public address', () => {
  equal(shareUrl(token, config), `https://order.example.com/lite/index.html#/o/${token}`);
  equal(
    shareUrl(token, { delivery: { shareBaseUrl: 'https://order.example.com/lite/' } }),
    `https://order.example.com/lite/index.html#/o/${token}`
  );
  equal(
    shareUrl(token, { delivery: { shareBaseUrl: 'https://order.example.com/lite/index.html#/whatever' } }),
    `https://order.example.com/lite/index.html#/o/${token}`
  );
});

await check('the share link fits in a scannable QR code', () => {
  const link = shareUrl(token, config);
  const matrix = qrMatrix(link, { ecc: link.length > 400 ? 'L' : 'M' });
  const version = (matrix.length - 17) / 4;
  assert(version <= 20, `QR version ${version} is too dense to scan off a screen`);
});

await check('the SMS body stays short and carries the essentials', () => {
  const sms = orderToSms(order, shareUrl(token, config));
  assert(sms.includes(order.id), 'missing the order code');
  assert(sms.includes('Table 12'), 'missing the table');
  assert(sms.includes('2x Margherita'), 'missing the items');
  assert(sms.includes('unpaid'), 'missing the unpaid warning');
  // A self-contained link is a few hundred characters; the rest must stay lean.
  const link = shareUrl(token, config);
  assert(sms.length - link.length < 150, `SMS overhead is ${sms.length - link.length} characters around the link`);
});

await check('a long order does not produce a runaway SMS', () => {
  const many = buildOrder({
    cart: {
      ...cart,
      lines: Array.from({ length: 30 }, (_, i) => ({
        itemId: `i${i}`,
        name: `Dish number ${i} with a fairly long name`,
        unit: 1000,
        qty: 1,
        options: [],
        note: '',
      })),
    },
    session,
    config,
  });
  const sms = orderToSms(many, 'https://order.example.com/lite/index.html#/o/short');
  assert(sms.includes('+24 more items'), `expected a summary line, got:\n${sms}`);
  assert(sms.length < 420, `SMS is ${sms.length} characters`);
});

await check('the text body carries every line and both totals', () => {
  const text = orderToText(order, shareUrl(token, config));
  assert(text.includes('Margherita'), 'items');
  assert(text.includes('16 inch, Hot honey'), 'options');
  assert(text.includes('note: well done'), 'item note');
  assert(text.includes('Hand-cut chips'), 'second item');
  assert(text.includes(money(6605, 'USD')), 'total');
  assert(text.includes('Payment has NOT been taken'), 'payment warning');
  assert(text.includes('alex@example.com'), 'customer email');
});

await check('the CSV has a header and one row per line', () => {
  const rows = orderToCsv(order).split('\n');
  equal(rows.length, 3, 'header plus two items');
  equal(rows[0], 'order_id,item,quantity,unit_price,options,item_note,line_total');
  assert(rows[1].includes('"Margherita",2,17.00'), `unexpected row: ${rows[1]}`);
  assert(rows[1].includes('"16 inch; Hot honey"'), 'options should be semicolon separated');
});

await check('CSV quoting survives a comma and a quote in an item name', () => {
  const tricky = buildOrder({
    cart: { ...cart, lines: [{ itemId: 'x', name: 'Fish, "proper" chips', unit: 100, qty: 1, options: [], note: '' }] },
    session,
    config,
  });
  const row = orderToCsv(tricky).split('\n')[1];
  assert(row.includes('"Fish, ""proper"" chips"'), `unexpected quoting: ${row}`);
});

await check('the email subject summarises the order', () => {
  const subject = emailSubject(order);
  assert(subject.includes(order.id), 'order code');
  assert(subject.includes('Table 12'), 'where');
  assert(subject.includes('Alex Moore'), 'who');
});

await check('money parsing handles the formats a menu might use', () => {
  equal(parseMoney('$12.50'), 1250);
  equal(parseMoney('12,50'), 1250);
  equal(parseMoney('1.234,50'), 123450);
  equal(parseMoney('1,234.50'), 123450);
  equal(parseMoney(12.5), 1250);
  equal(parseMoney('12'), 1200);
  equal(parseMoney(''), null);
  equal(parseMoney('not a price'), null);
});

await check('a long order still round-trips', async () => {
  const bigCart = {
    ...cart,
    lines: Array.from({ length: 40 }, (_, i) => ({
      itemId: `i${i}`,
      name: `Dish number ${i} with a fairly long name`,
      unit: 1234,
      qty: (i % 3) + 1,
      options: [{ groupId: 'g', groupName: 'Size', choiceId: 'o', name: 'Large', price: 250 }],
      note: 'no coriander',
    })),
  };
  const big = buildOrder({ cart: bigCart, session, config });
  const bigToken = await encodeOrder(big);
  const back = await decodeOrder(bigToken);
  equal(back.lines.length, 40);
  equal(back.total, big.total);
  assert(bigToken.length < 4000, `token grew to ${bigToken.length} characters`);
});

console.log(`${passed} passed, ${failures.length} failed`);
for (const failure of failures) console.log(`  FAIL ${failure}`);
process.exit(failures.length ? 1 : 0);

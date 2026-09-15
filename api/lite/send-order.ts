/**
 * Optional relay for menyo lite.
 *
 * The lite app works with no backend at all — it hands orders to the iPad's own
 * Mail and Messages apps. Deploy this endpoint only if you want a submitted
 * order to reach the restaurant without anyone tapping "Send".
 *
 * Environment variables:
 *   LITE_RELAY_TOKEN     required — shared secret; must match the relay token in Admin
 *   LITE_ORDER_EMAIL     the restaurant address that receives orders
 *   LITE_ORDER_SMS       the restaurant number that receives the text
 *   RESEND_API_KEY       Resend key (email)
 *   RESEND_FROM_EMAIL    verified "from" address, e.g. orders@yourdomain.com
 *   TWILIO_ACCOUNT_SID   Twilio SID (SMS)
 *   TWILIO_AUTH_TOKEN    Twilio auth token
 *   TWILIO_FROM_NUMBER   Twilio sending number, e.g. +15550100100
 *
 * Recipients come from this environment, never from the request body: a leaked
 * relay URL therefore cannot be turned into an open mail or SMS gateway.
 */
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { orderToHtml, orderToText, orderToSms, emailSubject } from '../../lite/js/order.js';

type LiteOrderLine = {
  name: string;
  qty: number;
  unit: number;
  total: number;
  options?: Array<{ name: string; price: number }>;
  note?: string;
};

type LiteOrder = {
  version: number;
  id: string;
  createdAt: number;
  currency: string;
  restaurant: { name: string; phone: string; address: string };
  customer: { name: string; email: string; phone: string };
  orderType: 'DINE_IN' | 'PICKUP' | 'DELIVERY';
  tableNumber: string;
  deliveryAddress: string;
  scheduledFor: string;
  note: string;
  lines: LiteOrderLine[];
  subtotal: number;
  serviceCharge: number;
  servicePercent: number;
  tax: number;
  taxPercent: number;
  total: number;
};

const MAX_LINES = 200;

/** Reject anything that is not recognisably one of our order payloads. */
function validateOrder(value: unknown): LiteOrder {
  const order = value as LiteOrder;
  if (!order || typeof order !== 'object') throw new Error('Missing order.');
  if (order.version !== 1) throw new Error('Unsupported order version.');
  if (typeof order.id !== 'string' || !/^[A-Z0-9-]{3,16}$/.test(order.id)) throw new Error('Bad order id.');
  if (!Array.isArray(order.lines) || order.lines.length === 0) throw new Error('Order has no items.');
  if (order.lines.length > MAX_LINES) throw new Error('Order has too many items.');
  for (const line of order.lines) {
    if (typeof line.name !== 'string' || !Number.isFinite(line.qty) || !Number.isFinite(line.total)) {
      throw new Error('Bad order line.');
    }
  }
  if (!Number.isFinite(order.total)) throw new Error('Bad order total.');
  return order;
}

/** Constant-time-ish comparison so the token cannot be guessed byte by byte. */
function tokensMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function sendEmail(to: string[], subject: string, html: string, text: string) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) return { sent: false, error: 'Email is not configured on the relay.' };

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, subject, html, text }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    return { sent: false, error: (body as any)?.message || `Resend returned ${response.status}` };
  }
  const body = (await response.json()) as { id?: string };
  return { sent: true, id: body.id };
}

async function sendSms(to: string, body: string) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!sid || !token || !from) return { sent: false, error: 'SMS is not configured on the relay.' };

  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: to, From: from, Body: body }).toString(),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    return { sent: false, error: (body as any)?.message || `Twilio returned ${response.status}` };
  }
  const result = (await response.json()) as { sid?: string };
  return { sent: true, id: result.sid };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // The kiosk is a static page that may be served from a different origin.
  const origin = process.env.LITE_ALLOWED_ORIGIN || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const expected = process.env.LITE_RELAY_TOKEN;
  if (!expected) {
    return res.status(500).json({ error: 'LITE_RELAY_TOKEN is not set on the server.' });
  }
  const provided = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!tokensMatch(provided, expected)) {
    return res.status(401).json({ error: 'Bad relay token.' });
  }

  let order: LiteOrder;
  try {
    order = validateOrder(req.body?.order);
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }

  const link = typeof req.body?.link === 'string' && /^https?:\/\//.test(req.body.link) ? req.body.link : '';

  const recipients: string[] = [];
  const configuredEmail = (process.env.LITE_ORDER_EMAIL || '').trim();
  if (configuredEmail) recipients.push(configuredEmail);
  // The only address the caller can influence is the guest's own, for their receipt.
  if (req.body?.ccCustomer && isEmail(order.customer.email || '')) recipients.push(order.customer.email);

  const results: { email?: boolean; sms?: boolean; warnings: string[] } = { warnings: [] };

  if (recipients.length) {
    const outcome = await sendEmail(
      recipients,
      emailSubject(order),
      orderToHtml(order, link),
      orderToText(order, link)
    );
    results.email = outcome.sent;
    if (!outcome.sent) results.warnings.push(outcome.error!);
  }

  const smsTo = (process.env.LITE_ORDER_SMS || '').trim();
  if (smsTo) {
    const outcome = await sendSms(smsTo, orderToSms(order, link));
    results.sms = outcome.sent;
    if (!outcome.sent) results.warnings.push(outcome.error!);
  }

  if (!recipients.length && !smsTo) {
    return res.status(500).json({ error: 'The relay has no LITE_ORDER_EMAIL or LITE_ORDER_SMS configured.' });
  }
  if (!results.email && !results.sms) {
    return res.status(502).json({ error: results.warnings.join(' ') || 'Nothing could be sent.' });
  }

  return res.status(200).json({ ok: true, ...results });
}

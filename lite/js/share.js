/**
 * Getting a submitted order in front of the restaurant.
 *
 * Two delivery modes, both configured in Admin → Sending:
 *  - DEVICE (default, zero infrastructure): hand the order to the iPad's own
 *    Mail / Messages / Share Sheet with everything pre-filled. Nothing to host,
 *    no API keys, no per-message cost.
 *  - RELAY (optional): POST the order to a small endpoint that sends the email
 *    and SMS automatically, so the staff iPad needs no human tap.
 */
import { orderToText, orderToSms, orderToHtml, emailSubject } from './order.js';

const isApple = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// iOS Safari has historically only honoured mailto: bodies up to a couple of
// kilobytes, so past that we fall back to a summary plus the link.
const MAILTO_BUDGET = 1800;

export function mailtoUrl(order, link, config) {
  const to = (config?.delivery?.email || '').trim();
  const cc =
    config?.delivery?.ccCustomer && order.customer.email ? order.customer.email.trim() : '';
  const subject = emailSubject(order);
  let body = orderToText(order, link);
  if (body.length > MAILTO_BUDGET) body = orderToSms(order, link);

  const params = new URLSearchParams();
  if (cc) params.set('cc', cc);
  params.set('subject', subject);
  params.set('body', body);
  return `mailto:${encodeURIComponent(to)}?${params.toString()}`;
}

export function smsUrl(order, link, config) {
  const to = (config?.delivery?.sms || '').replace(/[^\d+]/g, '');
  const body = orderToSms(order, link);
  // iOS wants sms:<number>&body=..., most other platforms want ?body=...
  const separator = isApple() ? '&' : '?';
  return `sms:${to}${separator}body=${encodeURIComponent(body)}`;
}

export function canWebShare() {
  return typeof navigator.share === 'function';
}

export async function webShare(order, link) {
  if (!canWebShare()) return false;
  try {
    await navigator.share({
      title: `Order ${order.id} — ${order.restaurant.name}`,
      text: orderToSms(order, link),
      url: link,
    });
    return true;
  } catch (err) {
    // The user dismissing the share sheet is not an error worth surfacing.
    if (err && err.name === 'AbortError') return false;
    throw err;
  }
}

/**
 * Hand the order to a relay endpoint. The relay decides who to send to — the
 * recipients live in its own environment config, not in this payload — so a
 * leaked relay URL cannot be turned into an open mail gateway.
 */
export async function sendViaRelay(order, link, config) {
  const url = (config?.delivery?.relayUrl || '').trim();
  if (!url) throw new Error('No relay URL is configured.');

  const headers = { 'Content-Type': 'application/json' };
  const token = (config?.delivery?.relayToken || '').trim();
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      order,
      link,
      ccCustomer: Boolean(config?.delivery?.ccCustomer),
    }),
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    /* a non-JSON body is handled below */
  }
  if (!response.ok) {
    throw new Error(payload?.error || `Relay responded with ${response.status}.`);
  }
  return payload || { ok: true };
}

/** A printable/self-contained HTML copy of the order, for saving or AirDropping. */
export function orderHtmlDocument(order, link) {
  return orderToHtml(order, link);
}

/** Which delivery buttons make sense given the current configuration. */
export function deliveryOptions(config) {
  const delivery = config?.delivery || {};
  return {
    mode: delivery.method === 'RELAY' && delivery.relayUrl ? 'RELAY' : 'DEVICE',
    hasEmail: Boolean((delivery.email || '').trim()),
    hasSms: Boolean((delivery.sms || '').trim()),
    hasRelay: Boolean((delivery.relayUrl || '').trim()),
    canShare: canWebShare(),
  };
}

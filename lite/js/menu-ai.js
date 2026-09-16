/**
 * Turning an uploaded menu into structured, orderable data.
 *
 * Calls the Gemini REST API straight from the browser with the key the owner
 * entered in Admin. That key never leaves the device except in the request to
 * Google, and menu parsing is a one-off setup step — see lite/README.md for the
 * recommended "parse once on an admin iPad, export JSON to the others" flow.
 */
import { parseMoney } from './util.js';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Inline request bodies have to stay comfortably under the API's 20MB limit. */
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

export const SUPPORTED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'];

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    restaurantName: { type: 'STRING' },
    currency: { type: 'STRING' },
    // The model's own account of how readable the pages were. Owners
    // photograph a physical menu, so this is often the difference between "the
    // menu has 12 dishes" and "I could only make out 12 of them".
    pageQuality: {
      type: 'OBJECT',
      properties: {
        legible: { type: 'BOOLEAN' },
        confidence: { type: 'NUMBER' },
        issues: { type: 'ARRAY', items: { type: 'STRING' } },
        unreadableAreas: { type: 'STRING' },
      },
    },
    categories: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          description: { type: 'STRING' },
          items: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                name: { type: 'STRING' },
                description: { type: 'STRING' },
                price: { type: 'NUMBER' },
                tags: { type: 'ARRAY', items: { type: 'STRING' } },
                options: {
                  type: 'ARRAY',
                  items: {
                    type: 'OBJECT',
                    properties: {
                      name: { type: 'STRING' },
                      required: { type: 'BOOLEAN' },
                      multiple: { type: 'BOOLEAN' },
                      choices: {
                        type: 'ARRAY',
                        items: {
                          type: 'OBJECT',
                          properties: { name: { type: 'STRING' }, price: { type: 'NUMBER' } },
                          required: ['name'],
                        },
                      },
                    },
                    required: ['name', 'choices'],
                  },
                },
              },
              required: ['name', 'price'],
            },
          },
        },
        required: ['name', 'items'],
      },
    },
  },
  required: ['categories'],
};

const PROMPT = `You are digitising a restaurant menu so customers can order from it on a tablet.

Read every page provided and return the complete menu as JSON.

Rules:
- Keep the menu's own section names and ordering (for example "Starters", "Wood-fired pizza", "Desserts"). If a section has no heading, use a sensible one.
- "price" is a plain number in the menu's own currency, with no symbol: 12.5 means twelve fifty. If an item shows several prices for sizes or portions, set "price" to the lowest one and express the difference as an option group with the extra cost per choice (a choice matching the base price has price 0).
- "currency" is the ISO code you infer from the symbols on the menu (USD, EUR, GBP, ...). Use USD if there is genuinely no signal.
- "description" is the menu's own wording, tidied of line breaks. Leave it empty rather than inventing one.
- "tags" holds only dietary or allergen markers actually printed on the menu, lowercased and short: "vegetarian", "vegan", "gluten-free", "spicy", "contains nuts".
- Only create an option group when the menu really offers a choice (size, protein, side, cooking temperature). Mark it required when the customer must choose.
- Do not invent items, prices, or sections. Skip decorative text, opening hours, addresses and marketing copy.
- If a price is genuinely unreadable, use 0 so a human can correct it later. Never guess a price from the items around it.

These are usually photographs of a physical menu taken on a tablet, so also fill in "pageQuality" honestly — it decides whether the owner is asked to retake the photo:
- "legible": false if you had to strain to read a meaningful part of the page.
- "confidence": 0 to 1, how much of the menu you are sure you captured correctly. Be strict. If a column runs off the edge of the photo, or the text is too soft to read cleanly, say so with a low number rather than a high one.
- "issues": short lowercase tags for what was wrong with the photograph itself, from: "blurry", "cropped", "angled", "glare", "low resolution", "shadow", "creased", "handwritten", "low contrast". Leave it empty when the page was clean.
- "unreadableAreas": one short sentence naming what you could not make out, for example "the right-hand price column of the second page". Leave empty when nothing was lost.`;

function schemaFromText(text) {
  return `${PROMPT}\n\nThe menu content is the following text:\n\n"""\n${text}\n"""`;
}

async function callGemini({ apiKey, model, parts }) {
  const response = await fetch(`${ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
      },
    }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.error?.message || `Gemini returned ${response.status}.`;
    if (response.status === 400 && /API key/i.test(message)) {
      throw new Error('That Gemini API key was rejected. Check it in Admin → Menu.');
    }
    if (response.status === 429) {
      throw new Error('Gemini is rate limiting this key. Wait a moment and try again.');
    }
    throw new Error(message);
  }

  const candidate = payload?.candidates?.[0];
  const finish = candidate?.finishReason;
  if (finish && finish !== 'STOP') {
    if (finish === 'MAX_TOKENS') {
      throw new Error('The menu was too long to read in one go. Try uploading fewer pages at a time.');
    }
    throw new Error(`Gemini stopped early (${finish}).`);
  }

  const text = (candidate?.content?.parts || []).map((p) => p.text || '').join('').trim();
  if (!text) throw new Error('Gemini returned an empty menu.');

  try {
    return JSON.parse(text);
  } catch {
    // Occasionally the model wraps JSON in a code fence despite the mime type.
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) return JSON.parse(fenced[1]);
    throw new Error('Gemini did not return readable JSON. Try again.');
  }
}

/** Convert the model's decimal prices into the integer cents the app stores. */
function toStoredMenu(parsed, fallbackCurrency) {
  const currency = (parsed.currency || fallbackCurrency || 'USD').toUpperCase().slice(0, 3);
  return {
    name: parsed.restaurantName || '',
    currency,
    categories: (parsed.categories || []).map((category) => ({
      name: category.name,
      description: category.description || '',
      items: (category.items || []).map((item) => ({
        name: item.name,
        description: item.description || '',
        price: parseMoney(item.price) ?? 0,
        tags: (item.tags || []).map((t) => String(t).toLowerCase().trim()).filter(Boolean),
        available: true,
        options: (item.options || []).map((group) => ({
          name: group.name,
          required: Boolean(group.required),
          multiple: Boolean(group.multiple),
          choices: (group.choices || []).map((choice) => ({
            name: choice.name,
            price: parseMoney(choice.price) ?? 0,
          })),
        })),
      })),
    })),
  };
}

/** Assemble the request parts for a set of already-decoded pages. */
export function buildPromptParts({ pages = [], text = '' }) {
  const parts = pages.map((page) => ({
    inline_data: { mime_type: page.mimeType, data: page.base64 },
  }));
  parts.push({ text: pages.length ? PROMPT : schemaFromText(text) });
  if (pages.length && text.trim()) {
    parts.push({ text: `Additional notes from the owner:\n${text.trim()}` });
  }
  return parts;
}

/**
 * The network half of menu ingestion, with no dependency on the DOM, so the
 * exact path the app uses can also be exercised from a script — see
 * lite/tools/try-menu-photo.mjs.
 *
 * @param {{pages?: Array<{base64: string, mimeType: string}>, text?: string,
 *          apiKey: string, model?: string, currency?: string}} input
 * @returns {Promise<{menu: object, pageReport: object|null}>}
 */
export async function parseMenuPages({ pages = [], text = '', apiKey, model = 'gemini-2.5-flash', currency }) {
  if (!apiKey) throw new Error('Add a Gemini API key in Admin → Menu before uploading a menu.');
  if (!pages.length && !text.trim()) throw new Error('Choose a menu file or paste the menu text first.');

  const parsed = await callGemini({ apiKey, model, parts: buildPromptParts({ pages, text }) });
  const menu = toStoredMenu(parsed, currency);
  if (!menu.categories.some((c) => c.items.length)) {
    throw new Error('No menu items could be read from that file. Try a clearer photo or paste the text.');
  }
  return { menu, pageReport: parsed.pageQuality || null };
}

/**
 * @param {{files?: File[], text?: string, apiKey: string, model?: string, currency?: string}} input
 * @returns {Promise<{menu: object, pageReport: object|null}>}
 */
export async function parseMenu({ files = [], text = '', apiKey, model = 'gemini-2.5-flash', currency }) {
  if (!files.length && !text.trim()) throw new Error('Choose a menu file or paste the menu text first.');

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > MAX_UPLOAD_BYTES) {
    throw new Error('Those files add up to more than 15MB. Upload the pages in smaller batches.');
  }

  const pages = [];
  for (const file of files) pages.push(await readAsBase64(file));
  return parseMenuPages({ pages, text, apiKey, model, currency });
}

function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.onload = () => {
      const result = String(reader.result);
      resolve({
        base64: result.slice(result.indexOf(',') + 1),
        // Safari reports an empty type for some HEIC captures.
        mimeType: file.type || guessMimeType(file.name),
      });
    };
    reader.readAsDataURL(file);
  });
}

function guessMimeType(filename) {
  const ext = filename.toLowerCase().split('.').pop();
  return (
    {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      webp: 'image/webp',
      heic: 'image/heic',
      heif: 'image/heif',
      pdf: 'application/pdf',
    }[ext] || 'application/octet-stream'
  );
}

/**
 * Cheap, offline fallback for when there is no API key: parse
 * "Name .... 12.50" style lines. Rough by design — the owner is expected to
 * tidy the result in the menu editor.
 */
export function parseMenuTextLocally(text, currency = 'USD') {
  const PRICE = /^(.*?)[\s.·—–-]*\s([£$€¥]?\s?\d+(?:[.,]\d{1,2})?)\s*$/;
  const priced = (line) => {
    const match = line.match(PRICE);
    return match && match[1].trim() ? match : null;
  };

  const lines = String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const categories = [];
  let current = null;
  let lastItem = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = priced(line);
    if (match) {
      if (!current) {
        current = { name: 'Menu', items: [] };
        categories.push(current);
      }
      lastItem = {
        name: match[1].replace(/[.·—–\-\s]+$/, '').trim(),
        description: '',
        price: parseMoney(match[2]) ?? 0,
        tags: [],
        available: true,
        options: [],
      };
      current.items.push(lastItem);
      continue;
    }

    // A short line just above a priced line reads as a section heading;
    // anything longer trailing an item reads as that item's description.
    const shouty = line.length <= 40 && line === line.toUpperCase() && /[A-Z]/.test(line);
    const heading = shouty || (line.length <= 30 && lines[i + 1] && priced(lines[i + 1]));
    if (heading || !lastItem) {
      current = { name: line.replace(/[:：]\s*$/, ''), items: [] };
      categories.push(current);
      lastItem = null;
    } else {
      lastItem.description = lastItem.description ? `${lastItem.description} ${line}` : line;
    }
  }

  return { name: '', currency, categories: categories.filter((c) => c.items.length) };
}

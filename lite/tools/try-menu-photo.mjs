/**
 * Run a real menu photo through the exact ingestion path the app uses, from a
 * terminal, and print what came back plus the quality verdict.
 *
 * Faster than tapping through the iPad when you are checking whether a photo
 * parses, and it prints the raw item list so you can see precisely what was
 * missed rather than guessing from the editor.
 *
 *   GEMINI_API_KEY=... node lite/tools/try-menu-photo.mjs menu-page-1.jpg menu-page-2.jpg
 *   GEMINI_API_KEY=... node lite/tools/try-menu-photo.mjs --json photo.jpg > parsed.json
 *
 * Options:
 *   --json          print the parsed menu as JSON and nothing else
 *   --model NAME    override the model (default gemini-2.5-flash)
 *   --currency XXX  fallback currency when the menu does not show one
 *
 * Get a free key at https://aistudio.google.com/apikey
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseMenuPages, MAX_UPLOAD_BYTES } from '../js/menu-ai.js';
import { assessMenuQuality, qualitySummary, VERDICTS } from '../js/menu-quality.js';
import { money } from '../js/util.js';

const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.pdf': 'application/pdf',
};

const args = process.argv.slice(2);
const flags = { json: false, model: 'gemini-2.5-flash', currency: 'USD' };
const files = [];

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--json') flags.json = true;
  else if (args[i] === '--model') flags.model = args[++i];
  else if (args[i] === '--currency') flags.currency = args[++i];
  else files.push(args[i]);
}

const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';

if (!apiKey) {
  console.error('Set GEMINI_API_KEY first. Get a free key at https://aistudio.google.com/apikey');
  process.exit(2);
}
if (!files.length) {
  console.error('Usage: GEMINI_API_KEY=... node lite/tools/try-menu-photo.mjs <photo> [more photos]');
  process.exit(2);
}

const pages = [];
let totalBytes = 0;
for (const file of files) {
  const ext = path.extname(file).toLowerCase();
  const mimeType = MIME_BY_EXT[ext];
  if (!mimeType) {
    console.error(`Unsupported file type: ${file} (accepted: ${Object.keys(MIME_BY_EXT).join(', ')})`);
    process.exit(2);
  }
  const bytes = await readFile(file);
  totalBytes += bytes.length;
  pages.push({ base64: bytes.toString('base64'), mimeType });
}

if (totalBytes > MAX_UPLOAD_BYTES) {
  console.error(`Those files add up to ${(totalBytes / 1024 / 1024).toFixed(1)}MB, over the 15MB limit.`);
  process.exit(2);
}

if (!flags.json) {
  console.error(`Reading ${pages.length} page${pages.length === 1 ? '' : 's'} (${(totalBytes / 1024 / 1024).toFixed(1)}MB) with ${flags.model}...`);
}

const started = Date.now();
let result;
try {
  result = await parseMenuPages({ pages, apiKey, model: flags.model, currency: flags.currency });
} catch (err) {
  console.error(`\nFailed: ${err.message}`);
  process.exit(1);
}
const elapsed = ((Date.now() - started) / 1000).toFixed(1);

if (flags.json) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

const { menu, pageReport } = result;
const assessment = assessMenuQuality(menu, { pageCount: pages.length, pageReport });
const currency = menu.currency || flags.currency;

const BOLD = '[1m';
const DIM = '[2m';
const RESET = '[0m';
const RED = '[31m';
const YELLOW = '[33m';
const GREEN = '[32m';

const tone =
  assessment.verdict === VERDICTS.GOOD ? GREEN : assessment.verdict === VERDICTS.POOR ? RED : YELLOW;

console.log(`\n${BOLD}${menu.name || '(no restaurant name on the menu)'}${RESET}  ${DIM}${currency} · read in ${elapsed}s${RESET}\n`);

for (const category of menu.categories) {
  console.log(`${BOLD}${category.name}${RESET} ${DIM}(${category.items.length})${RESET}`);
  for (const item of category.items) {
    // A zero price is how the model reports one it could not read.
    const price = item.price ? money(item.price, currency) : `${RED}no price${RESET}`;
    const options = item.options.length ? ` ${DIM}[${item.options.map((g) => g.name).join(', ')}]${RESET}` : '';
    const tags = item.tags.length ? ` ${DIM}${item.tags.join(' ')}${RESET}` : '';
    console.log(`  ${item.name.padEnd(38)} ${price}${options}${tags}`);
    if (item.description) console.log(`    ${DIM}${item.description}${RESET}`);
  }
  console.log('');
}

console.log(`${tone}${BOLD}${assessment.verdict.toUpperCase()}  ${assessment.score}/100${RESET}  ${qualitySummary(assessment)}\n`);

if (pageReport) {
  const bits = [];
  if (typeof pageReport.confidence === 'number') bits.push(`confidence ${pageReport.confidence}`);
  if (pageReport.legible === false) bits.push('reported as hard to read');
  if (pageReport.issues?.length) bits.push(`issues: ${pageReport.issues.join(', ')}`);
  if (pageReport.unreadableAreas) bits.push(`missed: ${pageReport.unreadableAreas}`);
  if (bits.length) console.log(`${DIM}Model's own report — ${bits.join(' · ')}${RESET}\n`);
}

if (assessment.problems.length) {
  console.log(`${BOLD}Problems${RESET}`);
  for (const problem of assessment.problems) {
    console.log(`  - ${problem.label}`);
    if (problem.examples?.length) console.log(`    ${DIM}${problem.examples.join(', ')}${RESET}`);
  }
  console.log('');
}

if (assessment.verdict !== VERDICTS.GOOD) {
  console.log(`${BOLD}What to try${RESET}`);
  assessment.advice.forEach((step, i) => {
    console.log(`  ${i + 1}. ${step.title}`);
    console.log(`     ${DIM}${step.detail}${RESET}`);
  });
  console.log('');
}

process.exit(assessment.verdict === VERDICTS.POOR ? 1 : 0);

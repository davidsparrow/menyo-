/**
 * Self-test for lite/js/qr.js.
 *
 * Decodes each generated symbol with an independently written reader: it
 * checks the function patterns by geometry, recovers the format info, walks
 * the zigzag data placement, de-interleaves the blocks, verifies every
 * Reed-Solomon syndrome is zero, and finally compares the recovered payload
 * with the original string.
 *
 *   node lite/tools/test-qr.mjs
 */
import { qrMatrix, qrSvg } from '../js/qr.js';

// --- Independent re-derivation of the parameter tables (see ISO/IEC 18004) ---

const ECC_PER_BLOCK = {
  L: [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  M: [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  Q: [0, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  H: [0, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
};
const NUM_BLOCKS = {
  L: [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  M: [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  Q: [0, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  H: [0, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
};
const FORMAT_BITS = { L: 1, M: 0, Q: 3, H: 2 };

function totalCodewords(version) {
  let bits = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const n = Math.floor(version / 7) + 2;
    bits -= (25 * n - 10) * n - 55;
    if (version >= 7) bits -= 36;
  }
  return Math.floor(bits / 8);
}

function alignPositions(version) {
  if (version === 1) return [];
  const n = Math.floor(version / 7) + 2;
  const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (n * 2 - 2)) * 2;
  const out = [6];
  for (let pos = version * 4 + 10; out.length < n; pos -= step) out.splice(1, 0, pos);
  return out;
}

function gfMul(a, b) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((b >>> i) & 1) * a;
  }
  return z & 0xff;
}

function gfPow(base, exp) {
  let r = 1;
  for (let i = 0; i < exp; i++) r = gfMul(r, base);
  return r;
}

// --- The independent reader ---

function functionMap(version) {
  const size = version * 4 + 17;
  const map = Array.from({ length: size }, () => new Array(size).fill(false));
  const mark = (x, y) => { if (x >= 0 && y >= 0 && x < size && y < size) map[y][x] = true; };

  for (const [ox, oy] of [[0, 0], [size - 7, 0], [0, size - 7]]) {
    for (let dy = -1; dy <= 7; dy++) for (let dx = -1; dx <= 7; dx++) mark(ox + dx, oy + dy);
  }
  for (let i = 0; i < size; i++) { mark(6, i); mark(i, 6); }

  const pos = alignPositions(version);
  for (let i = 0; i < pos.length; i++) {
    for (let j = 0; j < pos.length; j++) {
      const corner = (i === 0 && j === 0) || (i === 0 && j === pos.length - 1) || (i === pos.length - 1 && j === 0);
      if (corner) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) mark(pos[j] + dx, pos[i] + dy);
    }
  }
  for (let i = 0; i < 9; i++) { mark(i, 8); mark(8, i); }
  for (let i = 0; i < 8; i++) { mark(size - 1 - i, 8); mark(8, size - 1 - i); }
  if (version >= 7) {
    for (let i = 0; i < 18; i++) {
      mark(size - 11 + (i % 3), Math.floor(i / 3));
      mark(Math.floor(i / 3), size - 11 + (i % 3));
    }
  }
  return map;
}

function checkFunctionPatterns(m, version) {
  const size = m.length;
  const problems = [];
  const at = (x, y) => m[y][x];

  for (const [ox, oy] of [[0, 0], [size - 7, 0], [0, size - 7]]) {
    for (let dy = 0; dy < 7; dy++) {
      for (let dx = 0; dx < 7; dx++) {
        const d = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
        if (at(ox + dx, oy + dy) !== (d !== 2)) problems.push(`finder@${ox},${oy}+${dx},${dy}`);
      }
    }
  }
  for (let i = 8; i < size - 8; i++) {
    if (at(i, 6) !== (i % 2 === 0)) problems.push(`h-timing@${i}`);
    if (at(6, i) !== (i % 2 === 0)) problems.push(`v-timing@${i}`);
  }
  const pos = alignPositions(version);
  for (let i = 0; i < pos.length; i++) {
    for (let j = 0; j < pos.length; j++) {
      const corner = (i === 0 && j === 0) || (i === 0 && j === pos.length - 1) || (i === pos.length - 1 && j === 0);
      if (corner) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const expect = Math.max(Math.abs(dx), Math.abs(dy)) !== 1;
          if (at(pos[j] + dx, pos[i] + dy) !== expect) problems.push(`align@${pos[j]},${pos[i]}`);
        }
      }
    }
  }
  if (at(8, size - 8) !== true) problems.push('dark-module');

  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = ((version << 12) | rem) >>> 0;
    for (let i = 0; i < 18; i++) {
      const expect = ((bits >>> i) & 1) !== 0;
      if (at(size - 11 + (i % 3), Math.floor(i / 3)) !== expect) problems.push(`vinfo-a@${i}`);
      if (at(Math.floor(i / 3), size - 11 + (i % 3)) !== expect) problems.push(`vinfo-b@${i}`);
    }
  }
  return problems;
}

function readFormat(m) {
  const size = m.length;
  const bit = (x, y) => (m[y][x] ? 1 : 0);
  let a = 0;
  for (let i = 0; i <= 5; i++) a |= bit(8, i) << i;
  a |= bit(8, 7) << 6;
  a |= bit(8, 8) << 7;
  a |= bit(7, 8) << 8;
  for (let i = 9; i < 15; i++) a |= bit(14 - i, 8) << i;

  let b = 0;
  for (let i = 0; i < 8; i++) b |= bit(size - 1 - i, 8) << i;
  for (let i = 8; i < 15; i++) b |= bit(8, size - 15 + i) << i;

  if (a !== b) throw new Error(`format info copies disagree: ${a} vs ${b}`);

  const unmasked = a ^ 0x5412;
  const data = unmasked >>> 10;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  if ((((data << 10) | rem) ^ 0x5412) >>> 0 !== a) throw new Error('format info BCH check failed');
  return { eccFormat: data >>> 3, mask: data & 7 };
}

function maskBit(mask, x, y) {
  switch (mask) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default: return ((((x + y) % 2) + ((x * y) % 3)) % 2) === 0;
  }
}

function readCodewords(m, version, mask) {
  const size = m.length;
  const fn = functionMap(version);
  const bits = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (fn[y][x]) continue;
        bits.push((m[y][x] ? 1 : 0) ^ (maskBit(mask, x, y) ? 1 : 0));
      }
    }
  }
  const total = totalCodewords(version);
  const out = new Uint8Array(total);
  for (let i = 0; i < total * 8; i++) out[i >>> 3] |= bits[i] << (7 - (i & 7));
  return out;
}

function deinterleave(codewords, version, ecc) {
  const numBlocks = NUM_BLOCKS[ecc][version];
  const eccLen = ECC_PER_BLOCK[ecc][version];
  const total = totalCodewords(version);
  const shortLen = Math.floor(total / numBlocks);
  const numShort = numBlocks - (total % numBlocks);

  const raw = Array.from({ length: numBlocks }, () => new Array(shortLen + 1).fill(null));
  let n = 0;
  for (let i = 0; i < shortLen + 1; i++) {
    for (let j = 0; j < numBlocks; j++) {
      if (i !== shortLen - eccLen || j >= numShort) raw[j][i] = codewords[n++];
    }
  }
  // Dropping the hole left in short blocks leaves [data..., ecc...] contiguous.
  const blocks = raw.map((b) => Uint8Array.from(b.filter((v) => v !== null)));
  return { blocks, eccLen };
}

/** Every codeword block must be an exact multiple of the RS generator. */
function syndromesZero(block, eccLen) {
  for (let s = 0; s < eccLen; s++) {
    let acc = 0;
    for (let j = 0; j < block.length; j++) {
      acc ^= gfMul(block[j], gfPow(2, s * (block.length - 1 - j)));
    }
    if (acc !== 0) return false;
  }
  return true;
}

function decode(m, expectedEcc) {
  const version = (m.length - 17) / 4;
  const patternProblems = checkFunctionPatterns(m, version);
  if (patternProblems.length) {
    throw new Error(`function pattern errors: ${patternProblems.slice(0, 3).join(', ')}`);
  }
  const { eccFormat, mask } = readFormat(m);
  if (eccFormat !== FORMAT_BITS[expectedEcc]) {
    throw new Error(`format info reports ECC bits ${eccFormat}, expected ${FORMAT_BITS[expectedEcc]}`);
  }

  const { blocks, eccLen } = deinterleave(readCodewords(m, version, mask), version, expectedEcc);
  const data = [];
  for (const block of blocks) {
    if (!syndromesZero(block, eccLen)) throw new Error('Reed-Solomon syndrome check failed');
    for (let i = 0; i < block.length - eccLen; i++) data.push(block[i]);
  }

  // Parse the byte-mode segment back out of the data codewords.
  let bitPos = 0;
  const readBits = (n) => {
    let v = 0;
    for (let i = 0; i < n; i++, bitPos++) {
      v = (v << 1) | ((data[bitPos >>> 3] >>> (7 - (bitPos & 7))) & 1);
    }
    return v;
  };
  if (readBits(4) !== 0b0100) throw new Error('expected byte-mode indicator');
  const len = readBits(version < 10 ? 8 : 16);
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = readBits(8);
  return { text: new TextDecoder().decode(bytes), version, mask };
}

// --- Cases ---

const MAX_BYTES = { L: 2953, M: 2331, Q: 1663, H: 1273 };
const ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_/:.#?=&%+';

let seed = 987654321;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;

const cases = [];
for (const ecc of ['L', 'M', 'Q', 'H']) {
  for (let len = 1; len <= 40; len++) cases.push({ ecc, text: 'x'.repeat(len) });
  for (const len of [55, 89, 144, 233, 377, 610, 987, 1200, 1600, 2000, 2400, 2953]) {
    if (len > MAX_BYTES[ecc]) continue;
    let s = '';
    for (let i = 0; i < len; i++) s += ALPHABET[Math.floor(rnd() * ALPHABET.length)];
    cases.push({ ecc, text: s });
  }
}
cases.push({ ecc: 'M', text: 'HELLO WORLD' });
cases.push({ ecc: 'M', text: 'Café — Crème brûlée x2 · $18.50' });
cases.push({ ecc: 'L', text: 'https://menyo.example/lite/#/o/eyJyIjoiSm9lcyBCaXN0cm8iLCJpIjpbWyJCdXJnZXIiLDIsMTQ1MF1dfQ' });
cases.push({ ecc: 'H', text: '🍕🍔🌮 emoji payload 😀' });

let passed = 0;
const failures = [];
for (const c of cases) {
  try {
    const m = qrMatrix(c.text, { ecc: c.ecc });
    const got = decode(m, c.ecc);
    if (got.text !== c.text) throw new Error('payload round-trip mismatch');
    passed++;
  } catch (err) {
    failures.push(`ecc=${c.ecc} len=${c.text.length}: ${err.message}`);
  }
}

// Forcing each mask must still decode, which exercises all 8 mask patterns.
for (let mask = 0; mask < 8; mask++) {
  try {
    const text = `mask ${mask} check — order #A7F3`;
    const got = decode(qrMatrix(text, { ecc: 'M', mask }), 'M');
    if (got.text !== text) throw new Error('payload mismatch');
    if (got.mask !== mask) throw new Error(`format info reports mask ${got.mask}`);
    passed++;
  } catch (err) {
    failures.push(`forced mask ${mask}: ${err.message}`);
  }
}

// Oversized payloads must fail loudly rather than silently truncating.
try {
  qrMatrix('x'.repeat(2954), { ecc: 'L' });
  failures.push('oversized payload was accepted');
} catch {
  passed++;
}

// The SVG wrapper should produce a well-formed, non-empty document.
const svg = qrSvg('https://example.com', { ecc: 'M', scale: 4, border: 2 });
if (svg.startsWith('<svg') && svg.endsWith('</svg>') && svg.includes('<path d="M')) passed++;
else failures.push('qrSvg output looks malformed');

console.log(`${passed} passed, ${failures.length} failed`);
for (const f of failures.slice(0, 10)) console.log(`  FAIL ${f}`);
process.exit(failures.length ? 1 : 0);

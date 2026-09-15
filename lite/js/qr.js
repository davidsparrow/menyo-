/**
 * Minimal QR Code encoder (byte mode, versions 1-40, EC levels L/M/Q/H).
 *
 * Zero dependencies and no network access, so the kiosk can still render a
 * scannable order code while completely offline. Implements ISO/IEC 18004.
 *
 * Usage:
 *   const matrix = qrMatrix('https://example.com/#/o/abc');  // boolean[][]
 *   const svg = qrSvg('https://example.com/#/o/abc', { scale: 6 });
 */

const ECC_LEVELS = { L: 0, M: 1, Q: 2, H: 3 };

// Format-info bit patterns, indexed by ECC_LEVELS value.
const ECC_FORMAT_BITS = [1, 0, 3, 2];

// Number of error-correction codewords per block, [ecc][version].
const ECC_CODEWORDS_PER_BLOCK = [
  [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [0, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [0, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
];

// Number of error-correction blocks, [ecc][version].
const NUM_ECC_BLOCKS = [
  [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [0, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [0, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
];

/** Total number of data+ECC modules available for a version, in bits. */
function rawDataModules(version) {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const numAlign = Math.floor(version / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

/** How many 8-bit data codewords a (version, ecc) pair can carry. */
function dataCodewords(version, ecc) {
  return (
    Math.floor(rawDataModules(version) / 8) -
    ECC_CODEWORDS_PER_BLOCK[ecc][version] * NUM_ECC_BLOCKS[ecc][version]
  );
}

/** Row/column centres of the alignment patterns for a version. */
function alignmentPositions(version) {
  if (version === 1) return [];
  const numAlign = Math.floor(version / 7) + 2;
  const step =
    version === 32 ? 26 : Math.ceil((version * 4 + 4) / (numAlign * 2 - 2)) * 2;
  const result = [6];
  for (let pos = version * 4 + 10; result.length < numAlign; pos -= step) {
    result.splice(1, 0, pos);
  }
  return result;
}

// --- GF(256) arithmetic over the QR primitive polynomial x^8+x^4+x^3+x^2+1 ---

function gfMultiply(a, b) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((b >>> i) & 1) * a;
  }
  return z & 0xff;
}

/** Reed-Solomon generator polynomial of the given degree. */
function rsGenerator(degree) {
  const result = new Uint8Array(degree);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMultiply(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

function rsRemainder(data, generator) {
  const degree = generator.length;
  const result = new Uint8Array(degree);
  for (const b of data) {
    const factor = b ^ result[0];
    result.copyWithin(0, 1);
    result[degree - 1] = 0;
    for (let i = 0; i < degree; i++) {
      result[i] ^= gfMultiply(generator[i], factor);
    }
  }
  return result;
}

// --- Bit/segment helpers ---

function utf8Bytes(text) {
  return new TextEncoder().encode(text);
}

/** Smallest version that fits `byteLen` bytes at the given ECC level. */
function chooseVersion(byteLen, ecc, minVersion, maxVersion) {
  for (let version = minVersion; version <= maxVersion; version++) {
    const charCountBits = version < 10 ? 8 : 16;
    const needed = 4 + charCountBits + byteLen * 8;
    if (needed <= dataCodewords(version, ecc) * 8) return version;
  }
  return -1;
}

/** Build the full codeword sequence (data + interleaved ECC) for a payload. */
function buildCodewords(bytes, version, ecc) {
  const capacityBits = dataCodewords(version, ecc) * 8;
  const bits = [];
  const push = (value, len) => {
    for (let i = len - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };

  push(0b0100, 4); // byte-mode indicator
  push(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) push(b, 8);

  push(0, Math.min(4, capacityBits - bits.length)); // terminator
  push(0, (8 - (bits.length % 8)) % 8); // pad to a byte boundary

  const data = new Uint8Array(capacityBits / 8);
  for (let i = 0; i < bits.length; i++) {
    data[i >>> 3] |= bits[i] << (7 - (i & 7));
  }
  for (let i = bits.length / 8, pad = 0xec; i < data.length; i++, pad ^= 0xec ^ 0x11) {
    data[i] = pad;
  }

  // Split into blocks, append ECC, then interleave.
  const numBlocks = NUM_ECC_BLOCKS[ecc][version];
  const eccLen = ECC_CODEWORDS_PER_BLOCK[ecc][version];
  const totalCodewords = Math.floor(rawDataModules(version) / 8);
  const numShortBlocks = numBlocks - (totalCodewords % numBlocks);
  const shortBlockLen = Math.floor(totalCodewords / numBlocks);

  // Every block is laid out at the same width (shortBlockLen + 1) so that the
  // ECC codewords line up in the same columns. Short blocks leave a one-byte
  // hole in the last data column, which the interleaver below skips.
  const generator = rsGenerator(eccLen);
  const blockWidth = shortBlockLen + 1;
  const blocks = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const len = shortBlockLen - eccLen + (i < numShortBlocks ? 0 : 1);
    const dat = data.slice(k, k + len);
    k += len;
    const block = new Uint8Array(blockWidth);
    block.set(dat, 0);
    block.set(rsRemainder(dat, generator), blockWidth - eccLen);
    blocks.push(block);
  }

  const result = new Uint8Array(totalCodewords);
  let n = 0;
  for (let i = 0; i < blockWidth; i++) {
    for (let j = 0; j < numBlocks; j++) {
      if (i !== shortBlockLen - eccLen || j >= numShortBlocks) {
        result[n++] = blocks[j][i];
      }
    }
  }
  return result;
}

// --- Matrix construction ---

function createGrid(size, value) {
  return Array.from({ length: size }, () => new Array(size).fill(value));
}

function drawFunctionPatterns(modules, isFunction, version) {
  const size = modules.length;

  const setFunction = (x, y, dark) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    modules[y][x] = dark;
    isFunction[y][x] = true;
  };

  // Timing patterns.
  for (let i = 0; i < size; i++) {
    setFunction(6, i, i % 2 === 0);
    setFunction(i, 6, i % 2 === 0);
  }

  // Finder patterns plus their separators.
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        setFunction(cx + dx, cy + dy, dist !== 2 && dist !== 4);
      }
    }
  }

  // Alignment patterns, skipping the three finder corners.
  const positions = alignmentPositions(version);
  for (let i = 0; i < positions.length; i++) {
    for (let j = 0; j < positions.length; j++) {
      const corner =
        (i === 0 && j === 0) ||
        (i === 0 && j === positions.length - 1) ||
        (i === positions.length - 1 && j === 0);
      if (corner) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          setFunction(
            positions[j] + dx,
            positions[i] + dy,
            Math.max(Math.abs(dx), Math.abs(dy)) !== 1
          );
        }
      }
    }
  }

  // Reserve the format-info areas; real values are drawn after masking.
  for (let i = 0; i < 8; i++) {
    setFunction(i < 6 ? i : i + 1, 8, false);
    setFunction(8, i < 6 ? i : i + 1, false);
    setFunction(size - 1 - i, 8, false);
    setFunction(8, size - 1 - i, false);
  }
  setFunction(8, 8, false);
  setFunction(8, size - 8, true); // the always-dark module

  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = ((version << 12) | rem) >>> 0;
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) !== 0;
      setFunction(size - 11 + (i % 3), Math.floor(i / 3), dark);
      setFunction(Math.floor(i / 3), size - 11 + (i % 3), dark);
    }
  }
}

function drawFormatBits(modules, ecc, mask) {
  const size = modules.length;
  const data = (ECC_FORMAT_BITS[ecc] << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = (((data << 10) | rem) ^ 0x5412) >>> 0;
  const bit = (i) => ((bits >>> i) & 1) !== 0;

  // First copy: down column 8, then left along row 8, around the top-left finder.
  for (let i = 0; i <= 5; i++) modules[i][8] = bit(i);
  modules[7][8] = bit(6);
  modules[8][8] = bit(7);
  modules[8][7] = bit(8);
  for (let i = 9; i < 15; i++) modules[8][14 - i] = bit(i);

  // Second copy: row 8 beside the top-right finder, then column 8 above the
  // bottom-left one. Row `size - 8` of column 8 is skipped: it is the
  // always-dark module.
  for (let i = 0; i < 8; i++) modules[8][size - 1 - i] = bit(i);
  for (let i = 8; i < 15; i++) modules[size - 15 + i][8] = bit(i);
}

function drawCodewords(modules, isFunction, codewords) {
  const size = modules.length;
  let i = 0; // bit index into codewords
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // the vertical timing pattern column is skipped
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!isFunction[y][x] && i < codewords.length * 8) {
          modules[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0;
          i++;
        }
      }
    }
  }
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

function applyMask(modules, isFunction, mask) {
  const size = modules.length;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!isFunction[y][x] && maskBit(mask, x, y)) modules[y][x] = !modules[y][x];
    }
  }
}

/** Penalty score used to pick the mask that produces the most readable symbol. */
function penaltyScore(modules) {
  const size = modules.length;
  let result = 0;

  const finderPenalty = (runHistory) => {
    const n = runHistory[1];
    const core =
      n > 0 &&
      runHistory[2] === n &&
      runHistory[3] === n * 3 &&
      runHistory[4] === n &&
      runHistory[5] === n;
    return (
      (core && runHistory[0] >= n * 4 && runHistory[6] >= n ? 40 : 0) +
      (core && runHistory[6] >= n * 4 && runHistory[0] >= n ? 40 : 0)
    );
  };

  for (const byRow of [true, false]) {
    for (let outer = 0; outer < size; outer++) {
      const history = [0, 0, 0, 0, 0, 0, 0];
      let runColor = false;
      let runLength = 0;
      let padded = false;
      for (let inner = 0; inner < size; inner++) {
        const cell = byRow ? modules[outer][inner] : modules[inner][outer];
        if (cell === runColor) {
          runLength++;
          if (runLength === 5) result += 3;
          else if (runLength > 5) result += 1;
        } else {
          // Treat the quiet zone before the first run as light for finder-like checks.
          history.pop();
          history.unshift(runLength + (padded || runColor ? 0 : size));
          padded = true;
          if (!runColor) result += finderPenalty(history);
          runColor = cell;
          runLength = 1;
        }
      }
      history.pop();
      history.unshift(runLength + (runColor ? 0 : size));
      if (runColor) {
        history.pop();
        history.unshift(0);
      }
      result += finderPenalty(history);
    }
  }

  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const c = modules[y][x];
      if (c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1]) {
        result += 3;
      }
    }
  }

  let dark = 0;
  for (const row of modules) for (const cell of row) if (cell) dark++;
  const total = size * size;
  // Penalise a dark-module ratio that strays from 50%, in 5% steps.
  const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
  result += k * 10;
  return result;
}

/**
 * Encode `text` and return the symbol as a boolean matrix (true = dark).
 * @param {string} text
 * @param {{ecc?: 'L'|'M'|'Q'|'H', minVersion?: number, maxVersion?: number, mask?: number}} [options]
 *   `mask` forces a specific mask pattern (0-7) instead of the lowest-penalty one.
 */
export function qrMatrix(text, options = {}) {
  const ecc = ECC_LEVELS[options.ecc || 'M'];
  if (ecc === undefined) throw new Error(`Unknown ECC level: ${options.ecc}`);
  const minVersion = Math.max(1, options.minVersion || 1);
  const maxVersion = Math.min(40, options.maxVersion || 40);

  const bytes = utf8Bytes(text);
  const version = chooseVersion(bytes.length, ecc, minVersion, maxVersion);
  if (version < 0) {
    throw new Error(`Data too long for a QR code (${bytes.length} bytes)`);
  }

  const size = version * 4 + 17;
  const modules = createGrid(size, false);
  const isFunction = createGrid(size, false);

  drawFunctionPatterns(modules, isFunction, version);
  drawCodewords(modules, isFunction, buildCodewords(bytes, version, ecc));

  let bestMask = options.mask === undefined ? 0 : options.mask;
  let bestPenalty = Infinity;
  for (let mask = 0; options.mask === undefined && mask < 8; mask++) {
    applyMask(modules, isFunction, mask);
    drawFormatBits(modules, ecc, mask);
    const penalty = penaltyScore(modules);
    if (penalty < bestPenalty) {
      bestPenalty = penalty;
      bestMask = mask;
    }
    applyMask(modules, isFunction, mask); // undo
  }
  applyMask(modules, isFunction, bestMask);
  drawFormatBits(modules, ecc, bestMask);
  return modules;
}

/**
 * Render `text` as an SVG string. Drawn as one path so it stays tiny and
 * scales cleanly on a Retina iPad display.
 */
export function qrSvg(text, options = {}) {
  const { scale = 6, border = 2, dark = '#0f172a', light = '#ffffff' } = options;
  const modules = qrMatrix(text, options);
  const size = modules.length + border * 2;
  const parts = [];
  for (let y = 0; y < modules.length; y++) {
    for (let x = 0; x < modules.length; x++) {
      if (modules[y][x]) parts.push(`M${x + border} ${y + border}h1v1h-1z`);
    }
  }
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}"`,
    ` width="${size * scale}" height="${size * scale}" shape-rendering="crispEdges"`,
    ` role="img" aria-label="QR code">`,
    `<rect width="${size}" height="${size}" fill="${light}"/>`,
    `<path d="${parts.join('')}" fill="${dark}"/>`,
    `</svg>`,
  ].join('');
}

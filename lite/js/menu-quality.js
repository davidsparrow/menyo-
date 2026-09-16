/**
 * Judging whether a parsed menu is good enough to put in front of guests.
 *
 * Owners photograph a physical menu on the iPad they are holding, so the
 * inputs are camera photos: soft focus, shot at an angle, a corner missing,
 * glare across the laminate. The model returns *something* for almost any of
 * those, which is the dangerous case — a menu that looks fine until you notice
 * a third of the prices are zero.
 *
 * Two sources of evidence are combined:
 *  - what the model said about the pages it read (see menu-ai.js), and
 *  - what the parsed result itself looks like, which needs no cooperation from
 *    the model and catches the cases where it guessed confidently.
 */

/** Below this many items per uploaded page, we probably missed part of it. */
const MIN_ITEMS_PER_PAGE = 4;

/** A price this many times the median is usually a lost decimal point. */
const PRICE_OUTLIER_FACTOR = 30;

export const VERDICTS = { GOOD: 'good', CHECK: 'check', POOR: 'poor' };

function median(numbers) {
  if (!numbers.length) return 0;
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function allItems(menu) {
  return (menu?.categories || []).flatMap((category) =>
    (category.items || []).map((item) => ({ ...item, categoryName: category.name }))
  );
}

/**
 * @param {object} menu a normalised menu
 * @param {{pageCount?: number, pageReport?: object}} [context]
 *   `pageCount` is how many files were uploaded; `pageReport` is the model's
 *   own account of the pages, when it gave one.
 */
export function assessMenuQuality(menu, context = {}) {
  const items = allItems(menu);
  const pageCount = Math.max(1, context.pageCount || 1);
  const problems = [];

  const stats = {
    itemCount: items.length,
    categoryCount: (menu?.categories || []).length,
    pageCount,
    itemsPerPage: Number((items.length / pageCount).toFixed(1)),
    missingPrices: 0,
    suspiciousNames: 0,
    duplicateNames: 0,
    priceOutliers: 0,
    emptyCategories: 0,
  };

  if (!items.length) {
    const problem = [{ kind: 'nothing-read', count: 0, label: 'No menu items could be read at all.' }];
    return { verdict: VERDICTS.POOR, score: 0, stats, problems: problem, advice: adviceFor(problem, stats) };
  }

  // Missing prices: the clearest fingerprint of a cropped or blurry shot. The
  // prompt tells the model to use 0 when a price is genuinely unreadable.
  const priceless = items.filter((item) => !item.price);
  stats.missingPrices = priceless.length;
  if (priceless.length) {
    problems.push({
      kind: 'missing-prices',
      count: priceless.length,
      share: priceless.length / items.length,
      examples: priceless.slice(0, 5).map((i) => i.name),
      label: `${priceless.length} of ${items.length} items came back with no price.`,
    });
  }

  // Names that read like OCR debris rather than dishes.
  const suspicious = items.filter((item) => isSuspiciousName(item.name));
  stats.suspiciousNames = suspicious.length;
  if (suspicious.length) {
    problems.push({
      kind: 'garbled-names',
      count: suspicious.length,
      share: suspicious.length / items.length,
      examples: suspicious.slice(0, 5).map((i) => i.name),
      label: `${suspicious.length} item ${suspicious.length === 1 ? 'name looks' : 'names look'} garbled.`,
    });
  }

  // The same dish twice in one section usually means a page was read twice.
  const seen = new Set();
  const duplicateExamples = [];
  let duplicates = 0;
  for (const item of items) {
    const key = `${item.categoryName}::${item.name.toLowerCase().trim()}`;
    if (seen.has(key)) {
      duplicates++;
      if (duplicateExamples.length < 5) duplicateExamples.push(item.name);
    } else {
      seen.add(key);
    }
  }
  stats.duplicateNames = duplicates;
  if (duplicates) {
    problems.push({
      kind: 'duplicates',
      count: duplicates,
      share: duplicates / items.length,
      examples: duplicateExamples,
      label: `${duplicates} ${duplicates === 1 ? 'item appears' : 'items appear'} twice in the same section.`,
    });
  }

  // A price far above the rest is nearly always a dropped decimal point.
  const prices = items.map((i) => i.price).filter(Boolean);
  if (prices.length >= 5) {
    const mid = median(prices);
    const outliers = items.filter((item) => item.price && mid && item.price > mid * PRICE_OUTLIER_FACTOR);
    stats.priceOutliers = outliers.length;
    if (outliers.length) {
      problems.push({
        kind: 'price-outliers',
        count: outliers.length,
        share: outliers.length / items.length,
        examples: outliers.slice(0, 5).map((i) => i.name),
        label: `${outliers.length} ${outliers.length === 1 ? 'price is' : 'prices are'} far above the rest — check for a missing decimal point.`,
      });
    }
  }

  // Too little came back for the number of pages handed over.
  if (stats.itemsPerPage < MIN_ITEMS_PER_PAGE) {
    problems.push({
      kind: 'sparse',
      count: items.length,
      label: `Only ${items.length} ${items.length === 1 ? 'item' : 'items'} across ${pageCount} ${pageCount === 1 ? 'page' : 'pages'} — part of the menu was probably missed.`,
    });
  }

  const empty = (menu?.categories || []).filter((c) => !(c.items || []).length);
  stats.emptyCategories = empty.length;
  if (empty.length) {
    problems.push({
      kind: 'empty-sections',
      count: empty.length,
      examples: empty.slice(0, 5).map((c) => c.name),
      label: `${empty.length} ${empty.length === 1 ? 'section has' : 'sections have'} a heading but no items.`,
    });
  }

  // Whatever the model volunteered about the pages themselves.
  const reported = normalisePageReport(context.pageReport);
  if (reported.issues.length) {
    stats.reportedIssues = reported.issues;
    problems.push({
      kind: 'page-quality',
      count: reported.issues.length,
      issues: reported.issues,
      label: `The photo itself was hard to read: ${reported.issues.join(', ')}.`,
    });
  }
  if (reported.confidence !== null) stats.reportedConfidence = reported.confidence;

  const score = scoreOf(problems, reported);
  let verdict = score >= 80 ? VERDICTS.GOOD : score >= 55 ? VERDICTS.CHECK : VERDICTS.POOR;

  // GOOD has to mean "nothing to do". A single unpriced item does not make the
  // photograph bad, but it is still a row the owner must fix before guests can
  // order it, so anything we flagged at all lands in CHECK.
  if (verdict === VERDICTS.GOOD && problems.length) verdict = VERDICTS.CHECK;

  return { verdict, score, stats, problems, advice: adviceFor(problems, stats) };
}

function isSuspiciousName(name) {
  const value = String(name || '').trim();
  if (value.length < 3) return true;
  if (!/[\p{Letter}]/u.test(value)) return true;
  // More punctuation and digits than letters reads as debris, not a dish.
  const letters = (value.match(/\p{Letter}/gu) || []).length;
  const noise = (value.match(/[^\p{Letter}\s'&.,()\-’]/gu) || []).length;
  return noise > letters;
}

/** The model's self-report is optional and its shape is not guaranteed. */
function normalisePageReport(report) {
  if (!report || typeof report !== 'object') return { issues: [], confidence: null, legible: null };
  const issues = Array.isArray(report.issues)
    ? report.issues.map((i) => String(i).toLowerCase().trim()).filter(Boolean).slice(0, 6)
    : [];
  const confidence =
    typeof report.confidence === 'number' && report.confidence >= 0 && report.confidence <= 1
      ? report.confidence
      : null;
  const legible = typeof report.legible === 'boolean' ? report.legible : null;
  return { issues, confidence, legible };
}

function scoreOf(problems, reported) {
  let score = 100;
  for (const problem of problems) {
    switch (problem.kind) {
      case 'nothing-read':
        return 0;
      // Missing prices matter most: an item nobody can be charged for is worse
      // than a slightly odd name.
      case 'missing-prices':
        score -= Math.round(problem.share * 70);
        break;
      case 'garbled-names':
        score -= Math.round(problem.share * 50);
        break;
      case 'price-outliers':
        score -= Math.round(problem.share * 40) + 5;
        break;
      case 'duplicates':
        score -= Math.round(problem.share * 25);
        break;
      case 'sparse':
        score -= 25;
        break;
      case 'empty-sections':
        score -= Math.min(10, problem.count * 3);
        break;
      case 'page-quality':
        score -= 12;
        break;
      default:
        break;
    }
  }
  // The model's own report carries real weight, because it is the only
  // evidence of the one failure the checks above cannot see: whole items that
  // never made it into the result at all.
  if (reported.legible === false) score -= 15;
  if (reported.confidence !== null) score -= Math.round((1 - reported.confidence) * 30);
  return Math.max(0, Math.min(100, score));
}

/**
 * Concrete next steps, cheapest first. The iPad's own document scanner is the
 * single best fix and is already on the device, so it leads — an online OCR
 * tool or a print shop is a last resort, not a first suggestion.
 */
function adviceFor(problems, stats) {
  const kinds = new Set(problems.map((p) => p.kind));
  const advice = [];

  if (kinds.has('missing-prices') || kinds.has('price-outliers')) {
    advice.push({
      title: 'Get the whole page in frame',
      detail:
        'Prices sit at the right edge and are the first thing a crop loses. Lay the menu flat, hold the iPad straight above it, and check all four corners are inside the frame before you shoot.',
    });
  }

  // Unconditional: whatever went wrong — crop, blur, angle, glare — the
  // document scanner corrects it, and it is the one fix that needs no
  // judgement from the owner about what the problem was.
  {
    advice.push({
      title: 'Use the scanner built into this iPad',
      detail:
        'In the Files app tap the three dots then Scan Documents (or in Notes, the camera button then Scan Documents). It straightens the page, removes the angle and lifts the contrast far better than a plain photo — and it is already on this device. Save it as a PDF and upload that.',
    });
  }

  if (kinds.has('sparse') || kinds.has('empty-sections') || kinds.has('duplicates')) {
    advice.push({
      title: 'One page per photo',
      detail:
        'A spread shot from a distance loses the small print. Photograph each page on its own and upload them together, skipping covers and anything you do not take orders from.',
    });
  }

  advice.push({
    title: 'Avoid glare',
    detail:
      'Laminated menus bounce ceiling lights straight back. Step to one side of the light, or work near a window — daylight and no flash reads best.',
  });

  const mostlyPriceless = stats.missingPrices / Math.max(1, stats.itemCount) > 0.5;
  if (!stats.itemCount || mostlyPriceless) {
    advice.push({
      title: 'Still no good? Type or paste it instead',
      detail:
        'Run the photo through any OCR tool and paste the text into the box above, or type the menu straight into the editor below. A print shop can also scan a menu properly if the paper itself is in poor shape.',
    });
  }

  return advice;
}

/** One-line summary for the top of the result panel. */
export function qualitySummary(assessment) {
  const { verdict, stats } = assessment;
  if (verdict === VERDICTS.GOOD) {
    return `Read ${stats.itemCount} items across ${stats.categoryCount} sections. Nothing looks wrong — check it over and save.`;
  }
  if (verdict === VERDICTS.CHECK) {
    return `Read ${stats.itemCount} items, but some of it looks unreliable. Fix the flagged rows below, or retake the photo.`;
  }
  return `This photo did not read well. Retaking it will be faster than correcting ${stats.itemCount} rows by hand.`;
}

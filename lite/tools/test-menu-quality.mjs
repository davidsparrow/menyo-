/**
 * Tests for the photo-quality verdict.
 *
 * Each fixture is what a parse actually looks like coming back from a
 * particular kind of bad photograph, so the thresholds are exercised against
 * the failure modes they exist for rather than against synthetic noise.
 *
 *   node lite/tools/test-menu-quality.mjs
 */
import { assessMenuQuality, qualitySummary, VERDICTS } from '../js/menu-quality.js';
import { normaliseMenu } from '../js/store.js';

let passed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
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

/** Build a menu the way store.normaliseMenu would after a parse. */
function menuOf(categories) {
  return normaliseMenu({ name: 'Test', currency: 'USD', categories });
}

const item = (name, price, extra = {}) => ({ name, price, description: '', tags: [], options: [], ...extra });

// A clean, straight-on photo of a printed page.
const cleanMenu = menuOf([
  {
    name: 'Starters',
    items: [
      item('Wood-fired focaccia', 900),
      item('Charred broccolini', 1400),
      item('Burrata and peaches', 1800),
      item('Crispy artichokes', 1300),
    ],
  },
  {
    name: 'Mains',
    items: [
      item('Margherita', 1700),
      item('Mushroom and taleggio', 2100),
      item('Whole branzino', 3400),
      item('Dry-aged ribeye', 7800),
    ],
  },
]);

check('a clean read passes without complaint', () => {
  const result = assessMenuQuality(cleanMenu, { pageCount: 1 });
  equal(result.verdict, VERDICTS.GOOD, 'verdict');
  equal(result.problems.length, 0, 'problem count');
  assert(result.score >= 90, `score was ${result.score}`);
  assert(qualitySummary(result).includes('8 items'), 'summary should count the items');
});

check('the built-in scanner is offered for every kind of bad read', () => {
  // Whatever went wrong, Scan Documents is the fix that needs no diagnosis.
  const bad = [
    menuOf([{ name: 'M', items: [item('A', 0), item('B', 0), item('C', 0), item('D', 1700), item('E', 0)] }]),
    menuOf([{ name: 'M', items: [item('###', 1700), item('%%', 900), item('..', 800), item('Real dish', 1200)] }]),
    menuOf([{ name: 'M', items: [item('A', 1700), item('B', 900)] }]),
    menuOf([]),
  ];
  for (const menu of bad) {
    const result = assessMenuQuality(menu, { pageCount: 2 });
    assert(
      result.advice.some((a) => /Scan Documents/i.test(a.detail)),
      `scanner advice missing for a ${result.verdict} read`
    );
  }
});

check('a cropped right edge shows up as missing prices', () => {
  // The classic failure: the price column ran off the side of the photo.
  const cropped = menuOf([
    {
      name: 'Mains',
      items: [
        item('Margherita', 1700),
        item('Mushroom and taleggio', 0),
        item('Whole branzino', 0),
        item('Dry-aged ribeye', 0),
        item('Cacio e pepe', 0),
        item('Lamb ragu', 0),
      ],
    },
  ]);
  const result = assessMenuQuality(cropped, { pageCount: 1 });
  const problem = result.problems.find((p) => p.kind === 'missing-prices');
  assert(problem, 'expected a missing-prices problem');
  equal(problem.count, 5, 'missing count');
  equal(result.verdict, VERDICTS.POOR, 'verdict');
  assert(
    result.advice.some((a) => /all four corners/i.test(a.detail)),
    'advice should tell them to reframe'
  );
});

check('one missing price on a big menu is only worth a look', () => {
  const nearlyFine = menuOf([
    {
      name: 'Mains',
      items: [
        item('Margherita', 1700),
        item('Mushroom', 2100),
        item('Branzino', 3400),
        item('Ribeye', 7800),
        item('Cacio e pepe', 1900),
        item('Lamb ragu', 2400),
        item('Carbonara', 0),
        item('Puttanesca', 2000),
      ],
    },
  ]);
  const result = assessMenuQuality(nearlyFine, { pageCount: 1 });
  equal(result.verdict, VERDICTS.CHECK, 'one bad row in eight should be "check", not "poor"');
  assert(result.problems.some((p) => p.kind === 'missing-prices'), 'should still flag it');
});

check('a blurry photo shows up as garbled names', () => {
  const blurry = menuOf([
    {
      name: 'Mains',
      items: [
        item('Margherita', 1700),
        item('M@rgh#r1t@ ///', 2100),
        item('%%%', 1400),
        item('..,,--', 900),
      ],
    },
  ]);
  const result = assessMenuQuality(blurry, { pageCount: 1 });
  const problem = result.problems.find((p) => p.kind === 'garbled-names');
  assert(problem, 'expected a garbled-names problem');
  assert(problem.count >= 3, `only flagged ${problem.count}`);
  assert(
    result.advice.some((a) => /Scan Documents/i.test(a.detail)),
    'advice should point at the built-in scanner'
  );
});

check('real dish names are not mistaken for garbage', () => {
  const awkward = menuOf([
    {
      name: 'Mains',
      items: [
        item('Cacio e pepe', 1900),
        item("Chef's special (market price)", 4000),
        item('Fish & chips', 1800),
        item('Crème brûlée', 1100),
        item('Tagliatelle al ragù', 2200),
        item('Pho bo', 1600),
        item('Mapo tofu', 1500),
        item('Jamon 5J', 3000),
      ],
    },
  ]);
  const result = assessMenuQuality(awkward, { pageCount: 1 });
  equal(result.stats.suspiciousNames, 0, 'accented and punctuated dish names are fine');
  equal(result.verdict, VERDICTS.GOOD, 'verdict');
});

check('a page read twice shows up as duplicates', () => {
  const doubled = menuOf([
    {
      name: 'Mains',
      items: [
        item('Margherita', 1700),
        item('Branzino', 3400),
        item('Margherita', 1700),
        item('Branzino', 3400),
        item('Ribeye', 7800),
      ],
    },
  ]);
  const result = assessMenuQuality(doubled, { pageCount: 1 });
  const problem = result.problems.find((p) => p.kind === 'duplicates');
  assert(problem, 'expected a duplicates problem');
  equal(problem.count, 2, 'duplicate count');
});

check('the same dish in two different sections is not a duplicate', () => {
  const legitimate = menuOf([
    { name: 'Lunch', items: [item('Margherita', 1500), item('Salad', 900), item('Soup', 800), item('Pasta', 1400)] },
    { name: 'Dinner', items: [item('Margherita', 1700), item('Steak', 3200), item('Fish', 2600), item('Risotto', 2100)] },
  ]);
  const result = assessMenuQuality(legitimate, { pageCount: 2 });
  equal(result.stats.duplicateNames, 0, 'a dish can appear at lunch and at dinner');
});

check('a lost decimal point is caught as a price outlier', () => {
  // 12.50 read as 1250: the single most expensive mistake on this list.
  const slipped = menuOf([
    {
      name: 'Mains',
      items: [
        item('Margherita', 1700),
        item('Mushroom', 2100),
        item('Branzino', 3400),
        item('Carbonara', 1900),
        item('Lamb ragu', 2400),
        item('Cacio e pepe', 125000),
      ],
    },
  ]);
  const result = assessMenuQuality(slipped, { pageCount: 1 });
  const problem = result.problems.find((p) => p.kind === 'price-outliers');
  assert(problem, 'expected a price-outliers problem');
  equal(problem.examples[0], 'Cacio e pepe', 'should name the offending item');
});

check('a genuinely expensive dish is not flagged as an outlier', () => {
  const tastingMenu = menuOf([
    {
      name: 'Mains',
      items: [
        item('Margherita', 1700),
        item('Mushroom', 2100),
        item('Branzino', 3400),
        item('Carbonara', 1900),
        item('Lamb ragu', 2400),
        item('Tasting menu', 18000),
      ],
    },
  ]);
  const result = assessMenuQuality(tastingMenu, { pageCount: 1 });
  equal(result.stats.priceOutliers, 0, 'a 180 dollar tasting menu beside 20 dollar plates is plausible');
});

check('too little came back for the pages handed over', () => {
  const sparse = menuOf([{ name: 'Mains', items: [item('Margherita', 1700), item('Branzino', 3400)] }]);
  const result = assessMenuQuality(sparse, { pageCount: 3 });
  assert(result.problems.some((p) => p.kind === 'sparse'), 'expected a sparse problem');
  assert(
    result.advice.some((a) => /One page per photo/i.test(a.title)),
    'advice should suggest shooting one page at a time'
  );
});

check('nothing readable is the worst verdict and offers the fallbacks', () => {
  const result = assessMenuQuality(menuOf([]), { pageCount: 1 });
  equal(result.verdict, VERDICTS.POOR, 'verdict');
  equal(result.score, 0, 'score');
  assert(result.advice.some((a) => /OCR/i.test(a.detail)), 'OCR should be offered when nothing was read');
  assert(result.advice.some((a) => /Scan Documents/i.test(a.detail)), 'the scanner should be offered too');
});

check('OCR is a last resort, not a first suggestion', () => {
  const result = assessMenuQuality(cleanMenu, { pageCount: 1 });
  assert(!result.advice.some((a) => /OCR/i.test(a.detail)), 'a clean read should never mention OCR');

  const oneBadRow = assessMenuQuality(
    menuOf([
      {
        name: 'Mains',
        items: [item('A dish', 1700), item('B dish', 2100), item('C dish', 3400), item('D dish', 0)],
      },
    ]),
    { pageCount: 1 }
  );
  assert(!oneBadRow.advice.some((a) => /OCR/i.test(a.detail)), 'one missing price does not warrant OCR');
});

check("the model's own report is folded in", () => {
  const result = assessMenuQuality(cleanMenu, {
    pageCount: 1,
    pageReport: { legible: false, confidence: 0.35, issues: ['blurry', 'glare'], unreadableAreas: 'the dessert column' },
  });
  assert(result.problems.some((p) => p.kind === 'page-quality'), 'expected a page-quality problem');
  assert(result.score < 70, `a self-reported bad page should pull the score down, got ${result.score}`);
  assert(result.stats.reportedIssues.includes('blurry'), 'issues should reach the stats');
});

check('a confident model report leaves a clean read alone', () => {
  const result = assessMenuQuality(cleanMenu, {
    pageCount: 1,
    pageReport: { legible: true, confidence: 1, issues: [] },
  });
  equal(result.verdict, VERDICTS.GOOD, 'verdict');
});

check('a malformed model report is ignored rather than trusted', () => {
  for (const pageReport of [null, undefined, 'blurry', 42, { issues: 'blurry', confidence: 'high' }, { confidence: 7 }]) {
    const result = assessMenuQuality(cleanMenu, { pageCount: 1, pageReport });
    equal(result.verdict, VERDICTS.GOOD, `verdict for ${JSON.stringify(pageReport)}`);
  }
});

check('a section heading with no items under it is flagged', () => {
  const withEmpty = normaliseMenu({
    name: 'Test',
    currency: 'USD',
    categories: [
      { name: 'Mains', items: [item('A', 1700), item('B', 2100), item('C', 3400), item('D', 1900)] },
      { name: 'Desserts', items: [] },
    ],
  });
  const result = assessMenuQuality(withEmpty, { pageCount: 1 });
  const problem = result.problems.find((p) => p.kind === 'empty-sections');
  assert(problem, 'expected an empty-sections problem');
  equal(problem.examples[0], 'Desserts', 'should name the empty section');
});

check('several faults compound into a poor verdict', () => {
  const bad = menuOf([
    {
      name: 'Mains',
      items: [
        item('Margherita', 0),
        item('###', 0),
        item('Branzino', 3400),
        item('Branzino', 3400),
        item('..', 0),
      ],
    },
  ]);
  const result = assessMenuQuality(bad, { pageCount: 2 });
  equal(result.verdict, VERDICTS.POOR, 'verdict');
  assert(result.problems.length >= 3, `expected several problems, got ${result.problems.length}`);
});

check('advice is always actionable and never empty', () => {
  for (const menu of [cleanMenu, menuOf([]), menuOf([{ name: 'X', items: [item('A', 0)] }])]) {
    const result = assessMenuQuality(menu, { pageCount: 1 });
    assert(result.advice.length > 0, 'advice should never be empty');
    for (const step of result.advice) {
      assert(step.title && step.detail, 'every step needs a title and a detail');
      assert(step.detail.length > 40, `advice too thin: ${step.detail}`);
    }
  }
});

console.log(`${passed} passed, ${failures.length} failed`);
for (const failure of failures) console.log(`  FAIL ${failure}`);
process.exit(failures.length ? 1 : 0);

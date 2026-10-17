// Automated tests for the calculation logic in app.js
// Run from the app folder with:  node --test
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../app.js');

const { calculate, foodDose, correctionDose, findMeal, mealForTime, readingColour, arrowColour, mealInfoText, DOSE_PLAN } = app;

const MINUS = '−';
const GREAT = 'You’re doing Great!!! 😊';
const HIGH = 'Above 180: Please Inject Insulin ASAP!!!';
const LOW = 'LOW: treat with 20 g rapid carbs first';
const SWEETS = 'Take sweets to avoid Hypoglycemia';
const BELOW80 = 'Below 80: inject after eating';

// Helper: run the calculator like the screen does (3 food rows)
function run(meal, reading, arrow, foods) {
  const rows = (foods || []).slice();
  while (rows.length < 3) rows.push({ name: '', carbs: '' });
  return calculate({ meal, reading, arrow, foods: rows });
}
const food = (carbs, name) => ({ name: name === undefined ? 'Food' : name, carbs });

function assertMessage(r, text, style, flash) {
  assert.ok(r.message, 'expected a message');
  assert.equal(r.message.text, text);
  assert.equal(r.message.style, style);
  assert.equal(r.message.flash, flash);
}

/* ---------------- Required tests ---------------- */

test('1. 150, →, Dinner, no food → correction 1 u, total 1 u, steady green Great', () => {
  const r = run('Dinner', 150, 'steady');
  assert.equal(r.correction.value, 1);
  assert.equal(r.correction.text, '1 u');
  assert.equal(r.total, 1);
  assert.equal(r.totalText, '1 u');
  assertMessage(r, GREAT, 'green', false);
});

test('2. 300, ↑, Breakfast, 60 g → correction 8 u, food 8 u, total 16 u, Dark Red box, flashing Above 180', () => {
  const r = run('Breakfast', 300, 'up', [food(60, 'Toast')]);
  assert.equal(r.correction.value, 8);
  assert.equal(r.foods[0].value, 8);
  assert.equal(r.foods[0].text, '8 u');
  assert.equal(r.total, 16);
  assert.equal(r.totalText, '16 u');
  assert.equal(r.readingColour.name, 'Dark Red');
  assert.equal(r.readingColour.background, '#C00000');
  assertMessage(r, HIGH, 'red', true);
});

test('3. 70, ↓, Lunch, no food → correction −2 u, total 0 u, Take sweets', () => {
  const r = run('Lunch', 70, 'down');
  assert.equal(r.correction.value, -2);
  assert.equal(r.correction.text, MINUS + '2 u');
  assert.equal(r.total, 0);
  assertMessage(r, SWEETS, 'red', false);
});

test('4. 65, blank arrow, Dinner → correction 0 u, flashing LOW, Blue box', () => {
  const r = run('Dinner', 65, null);
  assert.equal(r.correction.kind, 'dose');
  assert.equal(r.correction.value, 0);
  assert.equal(r.correction.text, '0 u');
  assert.equal(r.total, 0);
  assert.equal(r.readingColour.name, 'Blue');
  assert.equal(r.readingColour.background, '#0070C0');
  assertMessage(r, LOW, 'red', true);
});

test('5. 200, →, Bedtime, 45 g → correction 2 u, food 6 u, total 8 u, flashing Above 180', () => {
  const r = run('Bedtime', 200, 'steady', [food(45)]);
  assert.equal(r.correction.value, 2);
  assert.equal(r.foods[0].value, 6);
  assert.equal(r.total, 8);
  assertMessage(r, HIGH, 'red', true);
});

test('6. 400, ↓ falling quickly, Bedtime → correction 5 u, flashing Above 180', () => {
  const r = run('Bedtime', 400, 'downFast');
  assert.equal(r.correction.value, 5);
  assert.equal(r.total, 5);
  assertMessage(r, HIGH, 'red', true);
});

test('7. 20 g → 3 u (2.5 rounds up); empty food name with 30 g → No food', () => {
  assert.equal(foodDose('Rice', 20, 'Lunch').value, 3);
  assert.equal(foodDose('Rice', 20, 'Lunch').text, '3 u');
  const noName = foodDose('', 30, 'Lunch');
  assert.equal(noName.kind, 'noFood');
  assert.equal(noName.text, 'No food');
  assert.equal(noName.value, 0);
  // and it is not counted in the total
  const r = run('Lunch', 100, 'steady', [food(30, '')]);
  assert.equal(r.foods[0].text, 'No food');
  assert.equal(r.total, 0);
});

test('8. 75, →, Lunch → 0 u, Below 80 (steady red); 79, ↓, Lunch → −2 u, Take sweets wins', () => {
  const a = run('Lunch', 75, 'steady');
  assert.equal(a.correction.value, 0);
  assert.equal(a.total, 0);
  assertMessage(a, BELOW80, 'red', false);

  const b = run('Lunch', 79, 'down');
  assert.equal(b.correction.value, -2);
  assert.equal(b.total, 0);
  assertMessage(b, SWEETS, 'red', false);
});

// 9. Layout check is done in a browser at iPhone SE, iPhone 15 and iPhone 15 Pro Max sizes (not a Node test).

test('10. Boundaries (Dinner, →, no food): 69, 180, 181, 251', () => {
  const r69 = run('Dinner', 69, 'steady');
  assert.equal(r69.correction.value, 0);
  assertMessage(r69, LOW, 'red', true);
  assert.equal(r69.readingColour.name, 'Blue');

  const r180 = run('Dinner', 180, 'steady');
  assert.equal(r180.correction.value, 2);
  assertMessage(r180, GREAT, 'green', false);
  assert.equal(r180.readingColour.name, 'Green');

  const r181 = run('Dinner', 181, 'steady');
  assert.equal(r181.correction.value, 3);
  assertMessage(r181, HIGH, 'red', true);
  assert.equal(r181.readingColour.name, 'Red');

  const r251 = run('Dinner', 251, 'steady');
  assert.equal(r251.correction.value, 5);
  assert.equal(r251.readingColour.name, 'Dark Red');
});

test('11. Only the four main meal times are offered – no snack times', () => {
  assert.deepEqual(DOSE_PLAN.meals.map((m) => m.name), ['Breakfast', 'Lunch', 'Dinner', 'Bedtime']);
  for (const name of ['Morning Snack', 'Late Morning Snack', 'Afternoon Snack', 'Evening Snack']) {
    assert.throws(() => findMeal(name), /Unknown meal time/, name);
  }
});

test('12. Bedtime target 140', () => {
  assert.equal(DOSE_PLAN.meals.find((m) => m.name === 'Bedtime').target, 140);
  assert.equal(mealInfoText('Bedtime'), 'Target 140 mg/dL • Planned carbs 15 g • Correction needed');
});

/* ---------------- Plan data matches the written plan ---------------- */

test('Meal time settings match the plan', () => {
  const expected = [
    ['Breakfast', 'Breakfast', true, 100, 60],
    ['Lunch', 'Lunch', true, 100, 60],
    ['Dinner', 'Dinner', true, 100, 60],
    ['Bedtime', 'Bedtime', true, 140, 15]
  ];
  assert.deepEqual(DOSE_PLAN.meals.map((m) => [m.name, m.column, m.correction, m.target, m.plannedCarbs]), expected);
  assert.deepEqual(DOSE_PLAN.carbRatio, { Breakfast: 8, Lunch: 8, Dinner: 8, Bedtime: 8 });
  assert.deepEqual(DOSE_PLAN.correctionFactor, { Breakfast: 30, Lunch: 30, Dinner: 30, Bedtime: 30 });
});

test('Info line text for every meal time', () => {
  assert.equal(mealInfoText('Breakfast'), 'Target 100 mg/dL • Planned carbs 60 g • Correction needed');
  assert.equal(mealInfoText('Lunch'), 'Target 100 mg/dL • Planned carbs 60 g • Correction needed');
  assert.equal(mealInfoText('Dinner'), 'Target 100 mg/dL • Planned carbs 60 g • Correction needed');
  assert.equal(mealInfoText('Bedtime'), 'Target 140 mg/dL • Planned carbs 15 g • Correction needed');
});

// Correction table typed out separately from app.js so a typo in either place is caught
const TABLE = [
  // from, Breakfast, Lunch, Dinner, Bedtime
  [0, 0, 0, 0, 0],
  [70, 0, 0, 0, 0],
  [101, 1, 1, 1, 0],
  [121, 1, 1, 1, 0],
  [151, 2, 2, 2, 1],
  [181, 3, 3, 3, 2],
  [221, 5, 5, 5, 4],
  [261, 6, 6, 6, 5],
  [301, 7, 7, 7, 7],
  [351, 9, 9, 9, 8]
];
const COLUMN_MEAL = { Breakfast: 'Breakfast', Lunch: 'Lunch', Dinner: 'Dinner', Bedtime: 'Bedtime' };

test('Every correction band boundary in every column (steady arrow)', () => {
  const cols = ['Breakfast', 'Lunch', 'Dinner', 'Bedtime'];
  TABLE.forEach((row, i) => {
    const from = row[0];
    const to = i < TABLE.length - 1 ? TABLE[i + 1][0] - 1 : 600;
    cols.forEach((col, c) => {
      for (const reading of [from, to]) {
        const r = correctionDose(reading, COLUMN_MEAL[col], 'steady');
        assert.equal(r.value, row[c + 1], `${col} reading ${reading}`);
      }
    });
  });
});

test('Bedtime uses its own column', () => {
  assert.equal(correctionDose(110, 'Bedtime', null).value, 0);
  assert.equal(correctionDose(400, 'Bedtime', null).value, 8);
});

test('Arrow adjustments (Libre arrows): ↑ +3, ↗ +2, → 0, ↘ −2, ↓ −3, blank 0', () => {
  const base = 3; // Lunch, 200 mg/dL
  assert.equal(correctionDose(200, 'Lunch', 'upFast').value, base + 3);
  assert.equal(correctionDose(200, 'Lunch', 'up').value, base + 2);
  assert.equal(correctionDose(200, 'Lunch', 'steady').value, base);
  assert.equal(correctionDose(200, 'Lunch', 'down').value, base - 2);
  assert.equal(correctionDose(200, 'Lunch', 'downFast').value, base - 3);
  assert.equal(correctionDose(200, 'Lunch', null).value, base);
  // Libre symbols work too
  assert.equal(correctionDose(200, 'Lunch', '↑').value, base + 3);
  assert.equal(correctionDose(200, 'Lunch', '↗').value, base + 2);
  assert.equal(correctionDose(200, 'Lunch', '→').value, base);
  assert.equal(correctionDose(200, 'Lunch', '↘').value, base - 2);
  assert.equal(correctionDose(200, 'Lunch', '↓').value, base - 3);
});

test('No reading → correction blank, no message, no colour; total from food only', () => {
  const r = run('Lunch', '', 'upFast', [food(16)]);
  assert.equal(r.correction.kind, 'blank');
  assert.equal(r.correction.text, '');
  assert.equal(r.message, null);
  assert.equal(r.readingColour, null);
  assert.equal(r.total, 2);
});

test('A meal time with correction: false shows Not needed and ignores every arrow (kept for future plans)', () => {
  // No meal time uses this today, so a temporary one is added just for this test
  DOSE_PLAN.meals.push({ name: 'Test No Correction', column: 'Dinner', correction: false, target: 100, plannedCarbs: 0 });
  try {
    for (const arrow of ['upFast', 'up', 'steady', 'down', 'downFast', null]) {
      const r = correctionDose(300, 'Test No Correction', arrow);
      assert.equal(r.kind, 'notNeeded');
      assert.equal(r.text, 'Not needed');
      assert.equal(r.value, 0);
    }
    const a = run('Test No Correction', 75, 'down');
    assert.equal(a.total, 0);
    assertMessage(a, BELOW80, 'red', false);
  } finally {
    DOSE_PLAN.meals.pop();
  }
});

test('Total is never negative', () => {
  const r = run('Lunch', 70, 'downFast', [food(8)]); // −3 + 1
  assert.equal(r.correction.value, -3);
  assert.equal(r.total, 0);
  assert.equal(r.totalText, '0 u');
  const s = run('Lunch', 150, 'downFast', [food(16), food(8)]); // 1 − 3 + 2 + 1
  assert.equal(s.total, 1);
});

test('Total adds all three food rows', () => {
  const r = run('Dinner', 250, 'up', [food(60), food(20), food(4)]); // 5+2 + 8 + 3 + 1
  assert.equal(r.correction.value, 7);
  assert.deepEqual(r.foods.map((f) => f.value), [8, 3, 1]);
  assert.equal(r.total, 19);
});

/* ---------------- Food rows ---------------- */

test('Food dose rounding (nearest whole unit, 0.5 up)', () => {
  const cases = [[0, 0], [3.9, 0], [4, 1], [11.9, 1], [12, 2], [15, 2], [20, 3], [28, 4], [44, 6], [45, 6], [60, 8], [100, 13]];
  for (const [g, u] of cases) assert.equal(foodDose('x', g, 'Dinner').value, u, `${g} g`);
});

test('Food row needs both name and carbs', () => {
  assert.equal(foodDose('Rice', '', 'Lunch').text, 'No food');
  assert.equal(foodDose('   ', 30, 'Lunch').text, 'No food');
  assert.equal(foodDose('', '', 'Lunch').text, 'No food');
  assert.equal(foodDose('Rice', '30', 'Lunch').value, 4);   // typed text
  assert.equal(foodDose('Rice', '7,5', 'Lunch').value, 1);  // comma decimal
  assert.equal(foodDose('Rice', 'abc', 'Lunch').text, 'No food');
});

/* ---------------- Messages ---------------- */

test('Message order: first match wins', () => {
  assertMessage(run('Dinner', 65, 'downFast'), LOW, 'red', true);       // LOW beats sweets
  assertMessage(run('Dinner', 0, null), LOW, 'red', true);
  assertMessage(run('Dinner', 70, 'steady'), BELOW80, 'red', false);
  assertMessage(run('Dinner', 79, 'upFast'), BELOW80, 'red', false);    // positive correction
  assertMessage(run('Dinner', 80, 'downFast'), GREAT, 'green', false);  // 80 is not below 80
  assertMessage(run('Dinner', 100, 'steady'), GREAT, 'green', false);
  assertMessage(run('Dinner', 350, 'downFast'), HIGH, 'red', true);
});

test('Only LOW and Above 180 flash', () => {
  for (const m of Object.values(DOSE_PLAN.messages)) {
    assert.equal(m.flash, m.key === 'low' || m.key === 'high', m.key);
  }
});

/* ---------------- Colours ---------------- */

test('Blood sugar box colours at every boundary', () => {
  const cases = [
    [0, 'Blue', '#0070C0'], [69, 'Blue', '#0070C0'],
    [70, 'Yellow', '#FFFF00'], [100, 'Yellow', '#FFFF00'],
    [101, 'Green', '#00B050'], [180, 'Green', '#00B050'],
    [181, 'Red', '#FF0000'], [250, 'Red', '#FF0000'],
    [251, 'Dark Red', '#C00000'], [600, 'Dark Red', '#C00000']
  ];
  for (const [reading, name, hex] of cases) {
    const c = readingColour(reading);
    assert.equal(c.name, name, String(reading));
    assert.equal(c.background, hex, String(reading));
  }
  assert.equal(readingColour(70).text, '#000000');  // yellow has black text
  assert.equal(readingColour(69).text, '#FFFFFF');
  assert.equal(readingColour(''), null);
});

test('Arrow colours', () => {
  assert.equal(arrowColour('steady').background, '#FFFF00');
  assert.equal(arrowColour('down').background, '#92D050');
  assert.equal(arrowColour('downFast').background, '#00B050');
  assert.equal(arrowColour('downFast').text, '#FFFFFF');
  assert.equal(arrowColour('up').background, '#FF0000');
  assert.equal(arrowColour('upFast').background, '#C00000');
  assert.equal(arrowColour(null), null);
});

/* ---------------- Meal time from the clock ---------------- */

test('Default meal time from the clock', () => {
  const at = (hh, mm) => new Date(2026, 0, 15, hh, mm);
  const cases = [
    [0, 0, 'Bedtime'], [4, 59, 'Bedtime'],
    [5, 0, 'Breakfast'], [10, 59, 'Breakfast'],
    [11, 0, 'Lunch'], [15, 59, 'Lunch'],
    [16, 0, 'Dinner'], [20, 59, 'Dinner'],
    [21, 0, 'Bedtime'], [23, 59, 'Bedtime']
  ];
  for (const [hh, mm, meal] of cases) assert.equal(mealForTime(at(hh, mm)), meal, `${hh}:${mm}`);
});

/* ---------------- Reading from the Libre Shortcut ---------------- */

const { parseLibreTime, checkLibreReading, ageText, libreProblemText } = app;

test('Libre time (UTC, as LibreLinkUp sends it) is read correctly', () => {
  assert.equal(parseLibreTime('9/30/2026 8:41:12 AM').toISOString(), '2026-09-30T08:41:12.000Z');
  assert.equal(parseLibreTime('9/30/2026 12:05:00 PM').toISOString(), '2026-09-30T12:05:00.000Z');
  assert.equal(parseLibreTime('9/30/2026 12:05:00 AM').toISOString(), '2026-09-30T00:05:00.000Z');
  assert.equal(parseLibreTime('10/1/2026 11:59:59 PM').toISOString(), '2026-10-01T23:59:59.000Z');
  assert.equal(parseLibreTime('12/31/2026 23:10:00').toISOString(), '2026-12-31T23:10:00.000Z');
  for (const bad of ['', null, undefined, '2026-09-30T08:41:12Z', '2/31/2026 8:00:00 AM', '9/30/2026 13:00:00 PM',
    '9/30/2026 0:10:00 AM', '9/30/2026 8:61:00 AM', '9/30/2026', 'hello']) {
    assert.equal(parseLibreTime(bad), null, String(bad));
  }
});

test('Libre reading: only used when the Shortcut opened the calculator', () => {
  const now = new Date('2026-09-30T08:45:00Z');
  assert.equal(checkLibreReading(new URLSearchParams(''), now), null);
  assert.equal(checkLibreReading(new URLSearchParams('bg=145&ts=9/30/2026 8:41:12 AM'), now), null);
});

test('Libre reading: fresh reading is offered with its time and arrow', () => {
  const now = new Date('2026-09-30T08:45:00Z');
  const r = checkLibreReading(new URLSearchParams('libre=1&bg=145&ts=9%2F30%2F2026%208%3A41%3A12%20AM&trend=4'), now);
  assert.equal(r.ok, true);
  assert.equal(r.value, 145);
  assert.equal(r.takenAt.toISOString(), '2026-09-30T08:41:12.000Z');
  assert.ok(Math.abs(r.ageMinutes - 3.8) < 0.01);
  assert.equal(r.arrow.key, 'up');
  assert.equal(r.arrow.symbol, '↗');
  assert.equal(r.arrow.adjust, 2);
  // Shortcut "+" spaces also work, and a missing or odd trend just means no arrow
  const plus = checkLibreReading(new URLSearchParams('libre=1&bg=98&ts=9/30/2026+8:44:00+AM'), now);
  assert.equal(plus.ok, true);
  assert.equal(plus.value, 98);
  assert.equal(plus.arrow, null);
  assert.equal(checkLibreReading({ libre: '1', bg: '98', ts: '9/30/2026 8:44:00 AM', trend: '9' }, now).arrow, null);
});

test('Libre reading: every trend arrow', () => {
  const now = new Date('2026-09-30T08:45:00Z');
  const expected = { 1: ['↓', 'downFast', -3], 2: ['↘', 'down', -2], 3: ['→', 'steady', 0], 4: ['↗', 'up', 2], 5: ['↑', 'upFast', 3] };
  for (const [trend, [symbol, key, adjust]] of Object.entries(expected)) {
    const r = checkLibreReading({ libre: '1', bg: '120', ts: '9/30/2026 8:44:00 AM', trend }, now);
    assert.equal(r.arrow.symbol, symbol, trend);
    assert.equal(r.arrow.key, key, trend);
    assert.equal(r.arrow.adjust, adjust, trend);
  }
  for (const trend of ['0', '6', 'x', '']) {
    assert.equal(checkLibreReading({ libre: '1', bg: '120', ts: '9/30/2026 8:44:00 AM', trend }, now).arrow, null, trend);
  }
});

test('Libre reading: age limit is 10 minutes', () => {
  const ts = '9/30/2026 8:00:00 AM';
  const at = (mm, ss) => new Date(Date.UTC(2026, 8, 30, 8, mm, ss || 0));
  assert.equal(checkLibreReading({ libre: '1', bg: '150', ts }, at(0)).ok, true);
  assert.equal(checkLibreReading({ libre: '1', bg: '150', ts }, at(10)).ok, true);
  const old = checkLibreReading({ libre: '1', bg: '150', ts }, at(10, 1));
  assert.equal(old.ok, false);
  assert.equal(old.reason, 'old');
  assert.match(libreProblemText(old), /too old/);
  // Slightly ahead of the phone clock is fine, well ahead is not
  assert.equal(checkLibreReading({ libre: '1', bg: '150', ts }, new Date(Date.UTC(2026, 8, 30, 7, 58))).ok, true);
  assert.equal(checkLibreReading({ libre: '1', bg: '150', ts }, new Date(Date.UTC(2026, 8, 30, 7, 57, 59))).reason, 'future');
});

test('Libre reading: LO, HI and broken values are refused', () => {
  const now = new Date('2026-09-30T08:45:00Z');
  const ts = '9/30/2026 8:44:00 AM';
  assert.equal(checkLibreReading({ libre: '1', bg: '40', ts }, now).ok, true);
  assert.equal(checkLibreReading({ libre: '1', bg: '500', ts }, now).ok, true);
  const lo = checkLibreReading({ libre: '1', bg: '39', ts }, now);
  assert.equal(lo.reason, 'range');
  assert.match(libreProblemText(lo), /LO/);
  const hi = checkLibreReading({ libre: '1', bg: '501', ts }, now);
  assert.equal(hi.reason, 'range');
  assert.match(libreProblemText(hi), /HI/);
  for (const bg of ['', 'abc', '-5', '1e3', '1234', '12,5']) {
    assert.equal(checkLibreReading({ libre: '1', bg, ts }, now).reason, 'missing', bg);
  }
  assert.equal(checkLibreReading({ libre: '1', bg: '120', ts: '' }, now).reason, 'missing');
  assert.equal(checkLibreReading({ libre: '1', bg: '120.6', ts }, now).value, 121);
  assert.equal(checkLibreReading({ libre: '1' }, now).reason, 'missing');
  assert.match(libreProblemText({ ok: false, reason: 'expired', ageMinutes: 11.5 }), /now 11 min old, so it was removed/);
});

test('Libre age text', () => {
  assert.equal(ageText(0.4), 'just now');
  assert.equal(ageText(1.2), '1 min ago');
  assert.equal(ageText(9.9), '9 min ago');
  assert.equal(ageText(65), '1 h 5 min ago');
  assert.equal(ageText(120), '2 h ago');
  assert.equal(ageText(-1), 'just now');
});

/* ---------------- Live Libre readings (relay) ---------------- */

const { clockSkew, checkRelayReply, liveAction, liveLine } = app;

test('Live Libre: the relay answer gets the same checks as a Shortcut reading', () => {
  const now = new Date('2026-10-16T13:00:00Z');
  const r = checkRelayReply({ ok: true, bg: 142, ts: '10/16/2026 12:58:30 PM', trend: 4 }, now);
  assert.equal(r.ok, true);
  assert.equal(r.value, 142);
  assert.equal(r.takenAt.toISOString(), '2026-10-16T12:58:30.000Z');
  assert.equal(r.arrow.key, 'up');
  assert.equal(checkRelayReply({ ok: true, bg: 142, ts: '10/16/2026 12:58:30 PM', trend: null }, now).arrow, null);
  assert.equal(checkRelayReply({ ok: true, bg: 142, ts: '10/16/2026 12:49:00 PM', trend: 3 }, now).reason, 'old');
  assert.equal(checkRelayReply({ ok: true, bg: 38, ts: '10/16/2026 12:59:00 PM', trend: 1 }, now).reason, 'range');
  assert.equal(checkRelayReply({ ok: true, bg: 600, ts: '10/16/2026 12:59:00 PM', trend: 5 }, now).reason, 'range');
  assert.equal(checkRelayReply({ ok: true, bg: 120, ts: '10/16/2026 1:10:00 PM', trend: 3 }, now).reason, 'future');
  assert.equal(checkRelayReply({ ok: true, bg: null, ts: '10/16/2026 12:59:00 PM' }, now).reason, 'missing');
  assert.deepEqual(checkRelayReply({ ok: false, reason: 'busy', retryAfter: 120 }, now),
    { ok: false, reason: 'relay', relayReason: 'busy', retryAfter: 120 });
  for (const bad of [null, undefined, 'text', 42]) {
    assert.equal(checkRelayReply(bad, now).relayReason, 'upstream', String(bad));
  }
});

test('Live Libre: fills an empty box, keeps a Libre reading up to date, never changes a typed reading', () => {
  const t = (mm) => new Date(Date.UTC(2026, 9, 16, 12, mm));
  const fresh = (mm) => ({ ok: true, value: 150, takenAt: t(mm), arrow: null });
  const box = (o) => Object.assign({ reading: '', libreTakenAt: null, autoFill: true, focused: false, sheetOpen: false }, o);

  assert.equal(liveAction(box(), fresh(58)), 'fill');
  assert.equal(liveAction(box({ reading: '142', libreTakenAt: t(57) }), fresh(58)), 'update');
  assert.equal(liveAction(box({ reading: '142', libreTakenAt: t(58) }), fresh(58)), 'none', 'same reading');
  assert.equal(liveAction(box({ reading: '142', libreTakenAt: t(59) }), fresh(58)), 'none', 'older reading');
  // Typed by hand: only offered
  assert.equal(liveAction(box({ reading: '130' }), fresh(58)), 'offer');
  // Right after Clear (no auto-fill) or while typing: only offered
  assert.equal(liveAction(box({ autoFill: false }), fresh(58)), 'offer');
  assert.equal(liveAction(box({ focused: true }), fresh(58)), 'offer');
  // While the box is being typed in, a newer reading is only offered (it updates once the keypad closes)
  assert.equal(liveAction(box({ reading: '142', libreTakenAt: t(57), focused: true }), fresh(58)), 'offer');
  // While a Libre box is open over the calculator nothing happens
  assert.equal(liveAction(box({ sheetOpen: true }), fresh(58)), 'none');
  assert.equal(liveAction(box({ reading: '142', libreTakenAt: t(57), sheetOpen: true }), fresh(58)), 'none');
});

test('Live Libre: a newer reading that cannot be used (LO, HI, clock) removes the Libre reading', () => {
  const t = (mm) => new Date(Date.UTC(2026, 9, 16, 12, mm));
  const box = (o) => Object.assign({ reading: '', libreTakenAt: null, autoFill: true, focused: false, sheetOpen: false }, o);
  const lo = { ok: false, reason: 'range', value: 39, takenAt: t(59), arrow: null };
  assert.equal(liveAction(box({ reading: '45', libreTakenAt: t(58) }), lo), 'remove');
  assert.equal(liveAction(box(), lo), 'none', 'empty box stays empty');
  assert.equal(liveAction(box({ reading: '130' }), lo), 'none', 'typed reading is never touched');
  assert.equal(liveAction(box({ reading: '45', libreTakenAt: t(59) }), lo), 'none', 'not newer');
  assert.equal(liveAction(box({ reading: '45', libreTakenAt: t(58) }), { ok: false, reason: 'relay', relayReason: 'busy' }), 'none');
  assert.equal(liveAction(box({ reading: '45', libreTakenAt: t(58) }), null), 'none');
});

test('Live Libre: the line at the top', () => {
  const now = new Date('2026-10-16T13:00:00Z');
  const ok = checkRelayReply({ ok: true, bg: 142, ts: '10/16/2026 12:58:30 PM', trend: 4 }, now);
  assert.deepEqual(liveLine({ connected: false }), { tone: 'off', before: 'Libre: tap to connect live readings', arrowKey: null, after: '',
    text: 'Libre: tap to connect live readings', label: 'Libre: tap to connect live readings', tap: 'connect' });
  assert.equal(liveLine({ connected: true, result: null }).text, 'Libre: getting the latest reading…');
  assert.equal(liveLine({ connected: true, network: true, result: ok }).tone, 'off');

  const inUse = liveLine({ connected: true, result: ok, inUse: true });
  assert.equal(inUse.text, 'Libre 142 ↗ · 1 min ago · in use');
  assert.equal(inUse.tone, 'ok');
  assert.equal(inUse.arrowKey, 'up');
  assert.equal(inUse.tap, 'refresh');
  assert.equal(inUse.label, 'Libre 142, rising · 1 min ago · in use'); // what a screen reader says
  assert.equal(liveLine({ connected: true, result: ok, inUse: true, arrowDiffers: true }).text, 'Libre 142 ↗ · 1 min ago · check arrow');
  const offer = liveLine({ connected: true, result: ok, inUse: false });
  assert.equal(offer.text, 'Libre 142 ↗ · 1 min ago · tap to use');
  assert.equal(offer.tap, 'use');
  // A reading older than the one in the box is shown but never offered
  const older = liveLine({ connected: true, result: ok, inUse: false, older: true });
  assert.equal(older.text, 'Libre 142 ↗ · 1 min ago');
  assert.equal(older.tap, 'refresh');
  const clock = checkRelayReply({ ok: true, bg: 142, ts: '10/16/2026 12:58:30 PM', trend: 4 }, now, 5 * 60000);
  assert.equal(liveLine({ connected: true, result: clock }).text, 'Phone clock is wrong – type the reading');

  const old = checkRelayReply({ ok: true, bg: 142, ts: '10/16/2026 12:46:00 PM', trend: 3 }, now);
  assert.equal(liveLine({ connected: true, result: old }).text, 'Libre 142 · 14 min old – scan the sensor');
  assert.equal(liveLine({ connected: true, result: old }).tap, 'refresh');
  const lo = checkRelayReply({ ok: true, bg: 39, ts: '10/16/2026 12:59:00 PM', trend: 1 }, now);
  assert.equal(liveLine({ connected: true, result: lo }).text, 'Libre shows LO – do a finger-prick check');
  const hi = checkRelayReply({ ok: true, bg: 501, ts: '10/16/2026 12:59:00 PM', trend: 5 }, now);
  assert.equal(liveLine({ connected: true, result: hi }).text, 'Libre shows HI – do a finger-prick check');

  const relay = (reason, retryAfter) => liveLine({ connected: true, result: checkRelayReply({ ok: false, reason, retryAfter }, now) });
  assert.equal(relay('key').tap, 'connect');
  assert.equal(relay('busy', 120).text, 'Libre: busy – trying again in 2 min');
  assert.equal(relay('locked', 300).text, 'Libre: busy – trying again in 5 min');
  assert.equal(relay('many').text, 'Libre: account follows several people');
  assert.equal(relay('something-new').text, 'Libre not answering – type the reading');
  // Every line fits on one line of a phone screen
  assert.equal(relay('patient_changed').text, 'Libre: account follows someone new');
  assert.equal(relay('setup').text, 'Libre relay settings missing (Cloudflare)');
  for (const reason of ['key', 'setup', 'login', 'terms', 'busy', 'no_follow', 'many', 'patient_changed', 'no_reading', 'origin', 'upstream']) {
    assert.ok(relay(reason).text.length <= 44, reason + ': ' + relay(reason).text);
  }
});

test('Live Libre: a phone clock more than 2 minutes off means the reading is not used', () => {
  const now = new Date('2026-10-16T13:00:00Z');
  const reply = { ok: true, bg: 142, ts: '10/16/2026 12:58:30 PM', trend: 4, fetchedAt: '2026-10-16T13:00:00.000Z' };
  assert.equal(clockSkew(reply, Date.parse('2026-10-16T13:00:20Z')), 20000);
  assert.equal(clockSkew({ ok: true }, Date.now()), null);
  assert.equal(clockSkew(null, Date.now()), null);
  assert.equal(checkRelayReply(reply, now, 20000).ok, true, '20 s (cached answer, slow network) is fine');
  assert.equal(checkRelayReply(reply, now, 2 * 60000).ok, true);
  assert.equal(checkRelayReply(reply, now, null).ok, true, 'no time from the relay: the usual checks only');
  // Phone 8 minutes slow and the sensor stopped 15 minutes ago: the phone would think it is 7 minutes old
  const slow = checkRelayReply({ ok: true, bg: 150, ts: '10/16/2026 12:37:00 PM', trend: 3 }, new Date('2026-10-16T12:44:00Z'), -8 * 60000);
  assert.equal(slow.ok, false);
  assert.equal(slow.reason, 'clock');
  assert.equal(slow.value, 150);
  assert.match(libreProblemText(slow), /clock is not right/);
  assert.equal(checkRelayReply(reply, now, 3 * 60000).reason, 'clock');
  // A newer reading that cannot be trusted removes a Libre reading from the box
  const t = (mm) => new Date(Date.UTC(2026, 9, 16, 12, mm));
  const box = { reading: '140', libreTakenAt: t(30), autoFill: true, focused: false, sheetOpen: false };
  assert.equal(liveAction(box, slow), 'remove');
});

test('About: credits and version', () => {
  assert.deepEqual(app.creditLines(), [
    'Developed by Mark Lontoc | Dubai, United Arab Emirates',
    '© 2026 MLWorks. All rights reserved | Version ' + app.APP_INFO.version + ' · ' + app.APP_INFO.date
  ]);
  assert.match(app.APP_INFO.version, /^\d+\.\d+(\.\d+)?$/);
  assert.match(app.APP_INFO.date, /^\d{1,2} [A-Z][a-z]{2} \d{4}$/);
});

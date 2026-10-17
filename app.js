/*
 * Insulin Dose Calculator
 * Helper tool only – always check against the written plan and follow the care team's advice.
 * Everything runs on this phone. The only thing it ever asks the internet for is the latest Libre reading,
 * and only when live Libre readings are set up (APP_SETTINGS.libreLive, see README).
 */
'use strict';

/* ==========================================================================
   DOSE PLAN – all plan numbers live here. Edit this block when the plan changes.
   After editing, also change CACHE_VERSION in service-worker.js (v1 → v2 …)
   so phones pick up the new version.
   ========================================================================== */
const DOSE_PLAN = {
  planTitle: 'Flexible Insulin Dose Plan 2026',

  // Columns that the meal times use for correction and insulin-to-carb ratio
  columns: ['Breakfast', 'Lunch', 'Dinner', 'Bedtime'],

  // Insulin-to-carb ratio: grams of carbohydrate covered by 1 unit
  carbRatio: { Breakfast: 8, Lunch: 8, Dinner: 8, Bedtime: 8 },

  // Correction factor: mg/dL lowered by 1 unit (information only – NOT used in the maths)
  correctionFactor: { Breakfast: 30, Lunch: 30, Dinner: 30, Bedtime: 30 },

  // Meal time settings, in the order shown on screen (snack times removed)
  meals: [
    { name: 'Breakfast', column: 'Breakfast', correction: true, target: 100, plannedCarbs: 60 },
    { name: 'Lunch',     column: 'Lunch',     correction: true, target: 100, plannedCarbs: 60 },
    { name: 'Dinner',    column: 'Dinner',    correction: true, target: 100, plannedCarbs: 60 },
    { name: 'Bedtime', planLabel: 'Bedtime (Bedtime Snack)', column: 'Bedtime', correction: true, target: 140, plannedCarbs: 15 }
  ],

  // Glucose correction (units). The row used is the one whose "from" value
  // is the largest one that is less than or equal to the reading.
  correctionTable: [
    { from: 0,   label: 'Less than 70', units: { Breakfast: 0, Lunch: 0, Dinner: 0, Bedtime: 0 } },
    { from: 70,  label: '70 to 100',    units: { Breakfast: 0, Lunch: 0, Dinner: 0, Bedtime: 0 } },
    { from: 101, label: '101 to 120',   units: { Breakfast: 1, Lunch: 1, Dinner: 1, Bedtime: 0 } },
    { from: 121, label: '121 to 150',   units: { Breakfast: 1, Lunch: 1, Dinner: 1, Bedtime: 0 } },
    { from: 151, label: '151 to 180',   units: { Breakfast: 2, Lunch: 2, Dinner: 2, Bedtime: 1 } },
    { from: 181, label: '181 to 220',   units: { Breakfast: 3, Lunch: 3, Dinner: 3, Bedtime: 2 } },
    { from: 221, label: '221 to 260',   units: { Breakfast: 5, Lunch: 5, Dinner: 5, Bedtime: 4 } },
    { from: 261, label: '261 to 300',   units: { Breakfast: 6, Lunch: 6, Dinner: 6, Bedtime: 5 } },
    { from: 301, label: '301 to 350',   units: { Breakfast: 7, Lunch: 7, Dinner: 7, Bedtime: 7 } },
    { from: 351, label: 'Over 350',     units: { Breakfast: 9, Lunch: 9, Dinner: 9, Bedtime: 8 } }
  ],

  // Trend arrow adjustment (units) and arrow colours. No arrow (blank) = 0.
  // "symbol" is the arrow as the FreeStyle Libre app shows it; "planSymbol" is the same arrow as drawn
  // in the written plan (Libre ↑ = plan ↑↑, Libre ↗ = plan ↑, Libre ↘ = plan ↓, Libre ↓ = plan ↓↓).
  // "libreTrend" is LibreLinkUp's TrendArrow number for that arrow (used by the Libre Shortcut).
  arrows: [
    { key: 'upFast',   symbol: '↑', planSymbol: '↑↑', name: 'Rising quickly',  rate: 'more than 2 mg/dL per minute', libreTrend: 5, adjust: 3,  colour: '#C00000', text: '#FFFFFF', colourName: 'Dark Red' },
    { key: 'up',       symbol: '↗', planSymbol: '↑',  name: 'Rising',          rate: '1 to 2 mg/dL per minute',      libreTrend: 4, adjust: 2,  colour: '#FF0000', text: '#FFFFFF', colourName: 'Red' },
    { key: 'steady',   symbol: '→', planSymbol: '→',  name: 'Changing slowly', rate: 'less than 1 mg/dL per minute', libreTrend: 3, adjust: 0,  colour: '#FFFF00', text: '#000000', colourName: 'Yellow' },
    { key: 'down',     symbol: '↘', planSymbol: '↓',  name: 'Falling',         rate: '1 to 2 mg/dL per minute',      libreTrend: 2, adjust: -2, colour: '#92D050', text: '#000000', colourName: 'Light Green' },
    { key: 'downFast', symbol: '↓', planSymbol: '↓↓', name: 'Falling quickly', rate: 'more than 2 mg/dL per minute', libreTrend: 1, adjust: -3, colour: '#00B050', text: '#FFFFFF', colourName: 'Green' }
  ],

  // Blood sugar box colours (Excel standard colours), checked top to bottom
  readingColours: [
    { lessThan: 70,  label: 'Below 70',   colour: '#0070C0', text: '#FFFFFF', colourName: 'Blue' },
    { atMost: 100,   label: '70 to 100',  colour: '#FFFF00', text: '#000000', colourName: 'Yellow' },
    { atMost: 180,   label: '101 to 180', colour: '#00B050', text: '#FFFFFF', colourName: 'Green' },
    { atMost: 250,   label: '181 to 250', colour: '#FF0000', text: '#FFFFFF', colourName: 'Red' },
    { atMost: Infinity, label: 'Over 250', colour: '#C00000', text: '#FFFFFF', colourName: 'Dark Red' }
  ],

  // Message thresholds (mg/dL)
  thresholds: { low: 70, injectAfterEating: 80, high: 180 },

  // Messages – the first rule that matches wins (see messageFor below)
  messages: {
    low:     { key: 'low',     text: 'LOW: treat with 20 g rapid carbs first',    style: 'red',   flash: true },
    sweets:  { key: 'sweets',  text: 'Take sweets to avoid Hypoglycemia',         style: 'red',   flash: false },
    below80: { key: 'below80', text: 'Below 80: inject after eating',             style: 'red',   flash: false },
    high:    { key: 'high',    text: 'Above 180: Please Inject Insulin ASAP!!!', style: 'red',   flash: true },
    great:   { key: 'great',   text: 'You’re doing Great!!! 😊',                  style: 'green', flash: false }
  },

  // Default meal time from the phone's clock (hours, 24-hour clock; "until" is not included)
  mealByClock: [
    { fromHour: 5,  untilHour: 11, meal: 'Breakfast' }, // 05:00–10:59
    { fromHour: 11, untilHour: 16, meal: 'Lunch' },     // 11:00–15:59
    { fromHour: 16, untilHour: 21, meal: 'Dinner' }     // 16:00–20:59
  ],
  mealByClockOtherwise: 'Bedtime',

  // Reminders (Instructions tab)
  reminders: [
    'Take insulin before meals/snacks unless glucose is below 80 mg/dL (then inject after eating).',
    'Targets: 100 mg/dL for meals/snacks, 140 mg/dL at bedtime; correction factor 30 mg/dL per 1 unit. These are shown for information only – the correction dose always comes from the correction table, not from a target formula.',
    'Hypoglycaemia: use 20 g rapid carbs.',
    'Before exercise: reduce insulin by 2 units (not included in the calculation).',
    'Check ketones if glucose is over 250 mg/dL, particularly if unwell.',
    'Long-acting insulin (Tresiba) is not part of this calculator.'
  ],

  // Short reminder line at the bottom of the main screen
  reminderLine: 'Inject before eating (after eating if below 80) • Hypo: 20 g rapid carbs • Exercise: 2 u less (not included)',

  disclaimer: 'Helper tool only – always check against the written plan and follow the care team’s advice.'
};

// App behaviour (not part of the dose plan)
const APP_SETTINGS = {
  foodRows: 3,
  // Everything is cleared when the app comes back after this long in the background,
  // so an old reading is never shown as if it were new.
  autoClearMinutes: 30,
  // Reading sent by the Libre Shortcut (see README): refused when older than this,
  // or when it is more than a couple of minutes "in the future" (phone clock wrong),
  // or outside the range the sensor can show (below 40 = LO, above 500 = HI).
  libre: { maxAgeMinutes: 10, futureToleranceMinutes: 2, min: 40, max: 500 },
  // Live Libre readings through your Libre relay (see README). Leave relayUrl empty to switch this off.
  libreLive: {
    relayUrl: 'https://libre-relay.markwendell-lontoc.workers.dev', // your Libre relay ('' switches live readings off)
    everySeconds: 60,      // how often to ask while the calculator is open
    timeoutSeconds: 15,    // give up on one try after this long
    minTapSeconds: 5       // tapping the Libre line asks again at most this often
  }
};

// About this app (Instructions tab → About). Change version and date with every release.
const APP_INFO = {
  name: 'Insulin Dose Calculator',
  version: '2.1',
  date: '17 Oct 2026',
  developer: 'Developed by Mark Lontoc | Dubai, United Arab Emirates',
  copyright: '© 2026 MLWorks. All rights reserved'
};

// The two credit lines, e.g. "© 2026 MLWorks. All rights reserved | Version 2.1 · 17 Oct 2026"
function creditLines() {
  return [APP_INFO.developer, APP_INFO.copyright + ' | Version ' + APP_INFO.version + ' · ' + APP_INFO.date];
}

// The arrow for a LibreLinkUp TrendArrow number (1–5), or null. It is shown in the Libre box but NOT
// selected automatically – the arrow is still tapped by hand in the calculator.
function libreArrow(trend) {
  const n = Number(trend);
  return DOSE_PLAN.arrows.find((a) => a.libreTrend === n) || null;
}

/* ==========================================================================
   CALCULATIONS – pure functions, no screen code (tested in tests/calc.test.js)
   ========================================================================== */

// Turns typed text into a number. Empty or invalid text gives null. Negative numbers are not allowed.
function toNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
  const s = String(value).trim().replace(',', '.');
  if (!/^(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Like Excel ROUND(x, 0): halves go away from zero (2.5 → 3). Tiny floating-point errors are tidied first.
function roundHalfUp(x) {
  const t = Number(x.toPrecision(12));
  return t < 0 ? -Math.round(-t) : Math.round(t);
}

// "8 u", "0 u", "−2 u" (true minus sign so it is easy to see)
function formatUnits(n) {
  return (n < 0 ? '−' : '') + Math.abs(n) + ' u';
}

function findMeal(name) {
  const meal = DOSE_PLAN.meals.find((m) => m.name === name);
  if (!meal) throw new Error('Unknown meal time: ' + name);
  return meal;
}

function findArrow(key) {
  if (!key) return null;
  return DOSE_PLAN.arrows.find((a) => a.key === key || a.symbol === key) || null;
}

function arrowAdjustment(key) {
  const arrow = findArrow(key);
  return arrow ? arrow.adjust : 0;
}

// Row of the correction table: the largest "from" that is <= reading
function correctionRow(reading) {
  const table = DOSE_PLAN.correctionTable;
  let best = null;
  for (const row of table) {
    if (row.from <= reading && (best === null || row.from > best.from)) best = row;
  }
  if (best === null) best = table.reduce((a, b) => (a.from <= b.from ? a : b));
  return best;
}

// Correction Dose: blank if no reading; "Not needed" (counts as 0, arrow ignored) when the
// meal time has correction: false (none do at the moment); otherwise table units + arrow units (may be negative).
function correctionDose(reading, mealName, arrowKey) {
  const r = toNumber(reading);
  if (r === null) return { kind: 'blank', value: 0, text: '' };
  const meal = findMeal(mealName);
  if (!meal.correction) return { kind: 'notNeeded', value: 0, text: 'Not needed' };
  const row = correctionRow(r);
  const value = row.units[meal.column] + arrowAdjustment(arrowKey);
  return { kind: 'dose', value, text: formatUnits(value), rowLabel: row.label, column: meal.column };
}

// Req'd. Dose for one food row: "No food" if the name or the carbs is empty,
// otherwise carbs ÷ ratio rounded to the nearest whole unit (0.5 rounds up).
function foodDose(foodName, carbs, mealName) {
  const meal = findMeal(mealName);
  const name = String(foodName === null || foodName === undefined ? '' : foodName).trim();
  const grams = toNumber(carbs);
  if (name === '' || grams === null) return { kind: 'noFood', value: 0, text: 'No food' };
  const value = roundHalfUp(grams / DOSE_PLAN.carbRatio[meal.column]);
  return { kind: 'dose', value, text: formatUnits(value) };
}

// Message banner – first match wins. Returns null when there is no reading.
function messageFor(reading, correctionValue) {
  const r = toNumber(reading);
  const t = DOSE_PLAN.thresholds;
  const m = DOSE_PLAN.messages;
  if (r === null) return null;
  if (r < t.low) return m.low;
  if (r < t.injectAfterEating && correctionValue < 0) return m.sweets;
  if (r < t.injectAfterEating) return m.below80;
  if (r > t.high) return m.high;
  return m.great;
}

function readingColour(reading) {
  const r = toNumber(reading);
  if (r === null) return null;
  for (const band of DOSE_PLAN.readingColours) {
    const inBand = 'lessThan' in band ? r < band.lessThan : r <= band.atMost;
    if (inBand) return { background: band.colour, text: band.text, name: band.colourName };
  }
  return null;
}

function arrowColour(key) {
  const arrow = findArrow(key);
  return arrow ? { background: arrow.colour, text: arrow.text, name: arrow.colourName } : null;
}

// Main meal from the clock: 05:00–10:59 Breakfast, 11:00–15:59 Lunch, 16:00–20:59 Dinner, otherwise Bedtime
function mealForTime(date) {
  const hour = date.getHours();
  for (const slot of DOSE_PLAN.mealByClock) {
    if (hour >= slot.fromHour && hour < slot.untilHour) return slot.meal;
  }
  return DOSE_PLAN.mealByClockOtherwise;
}

function mealInfoText(mealName) {
  const meal = findMeal(mealName);
  return 'Target ' + meal.target + ' mg/dL • Planned carbs ' + meal.plannedCarbs + ' g • Correction ' +
    (meal.correction ? 'needed' : 'NOT needed');
}

// Everything the screen shows, worked out from the inputs.
// input = { meal, reading, arrow, foods: [{ name, carbs }, …] }
function calculate(input) {
  const meal = findMeal(input.meal);
  const reading = toNumber(input.reading);
  const correction = correctionDose(reading, meal.name, input.arrow);
  const foods = (input.foods || []).map((f) => foodDose(f.name, f.carbs, meal.name));
  const foodTotal = foods.reduce((sum, f) => sum + f.value, 0);
  const total = Math.max(0, correction.value + foodTotal);
  return {
    meal,
    reading,
    correction,
    foods,
    total,
    totalText: formatUnits(total),
    message: messageFor(reading, correction.value),
    readingColour: readingColour(reading),
    arrowColour: arrowColour(input.arrow),
    mealInfo: mealInfoText(meal.name)
  };
}

/* ==========================================================================
   READING FROM THE LIBRE SHORTCUT – pure functions (tested in tests/calc.test.js)
   The Shortcut opens the calculator with ?libre=1&bg=145&ts=9/30/2026 8:41:12 AM&trend=4
   (ts is LibreLinkUp's FactoryTimestamp, which is UTC). Nothing is sent anywhere.
   ========================================================================== */

// "9/30/2026 8:41:12 AM" (UTC) → Date, or null if it is not a real date and time
function parseLibreTime(text) {
  const s = String(text === null || text === undefined ? '' : text).trim();
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i.exec(s);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  const year = Number(m[3]);
  let hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6] || 0);
  if (m[7]) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (m[7].toUpperCase() === 'PM' ? 12 : 0);
  } else if (hour > 23) {
    return null;
  }
  if (minute > 59 || second > 59) return null;
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
}

// Checks what the Shortcut sent. params: anything with get(name) (URLSearchParams) or a plain object.
// Returns null when the calculator was not opened by the Shortcut, otherwise
// { ok: true, value, takenAt, ageMinutes, arrow } or { ok: false, reason, … }.
function checkLibreReading(params, now) {
  const get = (k) => {
    const v = params && typeof params.get === 'function' ? params.get(k) : (params ? params[k] : undefined);
    return v === null || v === undefined ? '' : String(v).trim();
  };
  if (get('libre') === '') return null;
  const limits = APP_SETTINGS.libre;

  const takenAt = parseLibreTime(get('ts'));
  const raw = get('bg');
  if (takenAt === null || !/^\d{1,3}(\.\d+)?$/.test(raw)) return { ok: false, reason: 'missing' };
  const value = Math.round(Number(raw));

  const ageMinutes = (now.getTime() - takenAt.getTime()) / 60000;
  const arrow = get('trend') === '' ? null : libreArrow(get('trend'));
  const base = { value, takenAt, ageMinutes, arrow };

  if (value < limits.min || value > limits.max) return Object.assign({ ok: false, reason: 'range' }, base);
  if (ageMinutes < -limits.futureToleranceMinutes) return Object.assign({ ok: false, reason: 'future' }, base);
  if (ageMinutes > limits.maxAgeMinutes) return Object.assign({ ok: false, reason: 'old' }, base);
  return Object.assign({ ok: true }, base);
}

// "just now", "1 min ago", "7 min ago", "2 h 5 min ago"
function ageText(ageMinutes) {
  const m = Math.max(0, Math.floor(ageMinutes));
  if (m < 1) return 'just now';
  if (m < 60) return m + ' min ago';
  const hours = Math.floor(m / 60);
  const rest = m % 60;
  return hours + ' h' + (rest ? ' ' + rest + ' min' : '') + ' ago';
}

// What the Libre box says when a reading cannot be used
function libreProblemText(result) {
  const limits = APP_SETTINGS.libre;
  switch (result.reason) {
    case 'missing': return 'Could not get a reading from Libre. Check the Libre app and type the reading yourself.';
    case 'range': return 'Libre shows ' + (result.value < limits.min ? 'LO' : 'HI') + '. Do a finger-prick check and type the reading yourself.';
    case 'future': return 'The reading time does not match this phone’s clock. Check the Libre app and type the reading yourself.';
    case 'clock': return 'This phone’s clock is not right, so the age of the Libre reading cannot be checked. Set the clock to automatic (Settings → General → Date & Time) and type the reading yourself.';
    case 'expired': return 'The Libre reading is now ' + ageText(result.ageMinutes).replace(' ago', ' old') +
      ', so it was removed from the calculator. Check the Libre app and type the current reading.';
    case 'old': return 'The latest Libre reading is from ' + ageText(result.ageMinutes) + ' – too old to use (more than ' +
      limits.maxAgeMinutes + ' minutes). Check the Libre app and type the current reading.';
    default: return 'Could not use the Libre reading. Type it yourself.';
  }
}

/* ==========================================================================
   LIVE LIBRE READINGS – pure functions (tested in tests/calc.test.js)
   While the calculator is open it asks your Libre relay (see README) for the latest LibreLinkUp
   reading about once a minute. The readings are a guide only, never a go-ahead to inject.
   ========================================================================== */

// How far this phone's clock is from the relay's clock (milliseconds), from the relay's "fetchedAt";
// null when the answer has no usable time.
function clockSkew(reply, receivedAtMs) {
  const at = reply && typeof reply.fetchedAt === 'string' ? Date.parse(reply.fetchedAt) : NaN;
  return Number.isFinite(at) ? receivedAtMs - at : null;
}

// The relay's answer → the same checks as a Shortcut reading (age, LO/HI, clock).
// skewMs (from clockSkew): when the phone's clock is more than 2 minutes off, the reading's age cannot be
// trusted, so it is refused as 'clock'.
// When the relay could not get a reading: { ok: false, reason: 'relay', relayReason, retryAfter }.
function checkRelayReply(reply, now, skewMs) {
  if (!reply || typeof reply !== 'object') return { ok: false, reason: 'relay', relayReason: 'upstream', retryAfter: 0 };
  if (reply.ok !== true) {
    return { ok: false, reason: 'relay', relayReason: String(reply.reason || 'upstream'), retryAfter: Number(reply.retryAfter) || 0 };
  }
  const text = (v) => (v === null || v === undefined ? '' : String(v));
  const r = checkLibreReading({ libre: '1', bg: text(reply.bg), ts: text(reply.ts), trend: text(reply.trend) }, now);
  const limitMs = APP_SETTINGS.libre.futureToleranceMinutes * 60000;
  if (r.takenAt && typeof skewMs === 'number' && Math.abs(skewMs) > limitMs) return Object.assign({}, r, { ok: false, reason: 'clock' });
  return r;
}

// What to do with a reading the relay just sent.
// box = { reading: text in the Blood Sugar box, libreTakenAt: time of the Libre reading in the box (or null),
//         autoFill: may fill an empty box by itself (not right after Clear), focused: the box is being typed in,
//         sheetOpen: a Libre box is showing over the calculator }
// Returns 'fill' (empty box), 'update' (a newer Libre reading replaces the one in the box),
// 'remove' (the Libre reading in the box has been replaced by one that cannot be used, e.g. LO or HI),
// 'offer' (shown on the Libre line, used only when tapped) or 'none'.
// A reading typed by hand is never changed. Nothing changes while the box is being typed in, except that a
// Libre reading is still removed when a newer one cannot be used.
function liveAction(box, result) {
  if (!result || box.sheetOpen) return 'none';
  if (box.libreTakenAt instanceof Date) {
    const newer = result.takenAt instanceof Date && result.takenAt.getTime() > box.libreTakenAt.getTime();
    if (!newer) return 'none';
    if (!result.ok) return 'remove';
    return box.focused ? 'offer' : 'update';
  }
  if (!result.ok) return 'none';
  if (box.reading === '' && box.autoFill && !box.focused) return 'fill';
  return 'offer';
}

// The Libre line at the top of the calculator.
// s = { connected, network (last try had no internet), result (checkRelayReply), inUse (that reading is in the box),
//       older (the box has a newer Libre reading than this one), arrowDiffers (the arrow in the calculator is not the Libre arrow) }
// Returns { tone: 'ok' | 'offer' | 'warn' | 'bad' | 'off', before, arrowKey, after, text, label, tap: 'connect' | 'use' | 'refresh' }
function liveLine(s) {
  const line = (tone, before, tap, arrowKey, after) => {
    const arrow = arrowKey ? findArrow(arrowKey) : null;
    const rest = after || '';
    return { tone, before, arrowKey: arrow ? arrow.key : null, after: rest,
      text: before + (arrow ? ' ' + arrow.symbol : '') + rest,
      label: before + (arrow ? ', ' + arrow.name.toLowerCase() : '') + rest, tap };
  };
  if (!s.connected) return line('off', 'Libre: tap to connect live readings', 'connect');
  if (s.network) return line('off', 'Libre: no internet – type the reading', 'refresh');
  const r = s.result;
  if (!r) return line('off', 'Libre: getting the latest reading…', 'refresh');

  if (r.reason === 'relay') {
    const mins = Math.max(1, Math.ceil((r.retryAfter || 0) / 60));
    switch (r.relayReason) {
      case 'key': return line('bad', 'Libre: key not accepted – tap to fix', 'connect');
      case 'setup': return line('off', 'Libre relay settings missing (Cloudflare)', 'refresh');
      case 'login': return line('bad', 'Libre: sign-in refused – check the relay', 'refresh');
      case 'terms': return line('warn', 'Libre: accept the terms in LibreLinkUp', 'refresh');
      case 'locked':
      case 'busy': return line('warn', 'Libre: busy – trying again in ' + mins + ' min', 'refresh');
      case 'no_follow': return line('warn', 'Libre: the account follows nobody yet', 'refresh');
      case 'many':
      case 'patient': return line('bad', 'Libre: account follows several people', 'refresh');
      case 'patient_changed': return line('bad', 'Libre: account follows someone new', 'refresh');
      case 'no_reading': return line('warn', 'Libre: no reading – check the Libre app', 'refresh');
      case 'origin': return line('bad', 'Libre relay refused this address', 'refresh');
      default: return line('off', 'Libre not answering – type the reading', 'refresh');
    }
  }

  const arrowKey = r.arrow ? r.arrow.key : null;
  if (r.ok) {
    const age = ' · ' + ageText(r.ageMinutes);
    if (s.inUse) return line('ok', 'Libre ' + r.value, 'refresh', arrowKey, age + (s.arrowDiffers ? ' · check arrow' : ' · in use'));
    if (s.older) return line('off', 'Libre ' + r.value, 'refresh', arrowKey, age);
    return line('offer', 'Libre ' + r.value, 'use', arrowKey, age + ' · tap to use');
  }
  const limits = APP_SETTINGS.libre;
  switch (r.reason) {
    case 'old': return line('warn', 'Libre ' + r.value + ' · ' + ageText(r.ageMinutes).replace(' ago', ' old') + ' – scan the sensor', 'refresh');
    case 'range': return line('bad', 'Libre shows ' + (r.value < limits.min ? 'LO' : 'HI') + ' – do a finger-prick check', 'refresh');
    case 'future': return line('warn', 'Libre time is off – type the reading', 'refresh');
    case 'clock': return line('bad', 'Phone clock is wrong – type the reading', 'refresh');
    default: return line('warn', 'Libre: no reading – check the Libre app', 'refresh');
  }
}

// The relay key is kept on this phone only (never in the app files, which are public)
const RELAY_KEY_STORE = 'insulin-dose-libre-relay-key';
function loadRelayKey() {
  try { return (window.localStorage.getItem(RELAY_KEY_STORE) || '').trim(); } catch (e) { return ''; }
}
function saveRelayKey(key) {
  try {
    if (key) window.localStorage.setItem(RELAY_KEY_STORE, key);
    else window.localStorage.removeItem(RELAY_KEY_STORE);
  } catch (e) { /* private mode: kept until the app closes */ }
}

/* ==========================================================================
   SCREEN
   ========================================================================== */
function initApp() {
  const $ = (id) => document.getElementById(id);
  const plan = DOSE_PLAN;

  function freshState() {
    const foods = [];
    for (let i = 0; i < APP_SETTINGS.foodRows; i++) foods.push({ name: '', carbs: '' });
    return { meal: mealForTime(new Date()), reading: '', arrow: null, arrowByHand: false, foods, libreTakenAt: null, libreArrowKey: null };
  }
  const state = freshState();

  // Live Libre readings (see the LIVE LIBRE section further down)
  const live = {
    url: String(APP_SETTINGS.libreLive.relayUrl || '').trim().replace(/\/+$/, ''),
    key: loadRelayKey(),
    reply: null,        // the relay's last answer
    network: false,     // the last try had no internet (or the relay could not be reached)
    autoFill: true,     // may fill an empty box by itself – not right after Clear
    skew: null,         // phone clock minus the relay's clock when that answer came in
    timer: null,
    inflight: null,
    ctrl: null,
    gen: 0,             // answers from before Connect / Turn off are ignored
    lastTap: 0,
    waitUntil: 0
  };

  // Reading sent by the Libre Shortcut in the address (?libre=1&bg=…&ts=…&trend=…)
  let libreSheet = null;
  const libreParams = {};
  if (location.search) {
    const sp = new URLSearchParams(location.search);
    ['libre', 'bg', 'ts', 'trend'].forEach((k) => { if (sp.has(k)) libreParams[k] = sp.get(k); });
  }

  const els = {
    total: $('total-num'),
    totalBox: $('total-box'),
    hud: $('hud'),
    hudTotal: $('hud-total'),
    hudReading: $('hud-reading'),
    hudMsg: $('hud-msg'),
    mealGrid: $('meal-grid'),
    mealInfo: $('meal-info'),
    readingBox: $('box-reading'),
    readingLabel: $('reading-label'),
    reading: $('reading'),
    title: $('title'),
    strip: $('libre-line'),
    arrowBox: $('box-arrow'),
    arrowGrid: $('arrow-btns'),
    correction: $('correction'),
    message: $('message'),
    names: [], carbs: [], doses: [],
    clear: $('clear'),
    reminder: $('reminder-line'),
    pageCalc: $('page-calc'),
    updateBar: $('update-bar')
  };
  for (let i = 1; i <= APP_SETTINGS.foodRows; i++) {
    els.names.push($('food-name-' + i));
    els.carbs.push($('food-carbs-' + i));
    els.doses.push($('food-dose-' + i));
  }

  function closeKeypad() {
    const a = document.activeElement;
    if (a && a.tagName === 'INPUT') a.blur();
  }

  // Meal time chips
  const chips = plan.meals.map((meal) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.setAttribute('role', 'radio');
    b.dataset.meal = meal.name;
    b.textContent = meal.name;
    b.addEventListener('click', () => {
      closeKeypad();
      state.meal = meal.name;
      render();
    });
    els.mealGrid.appendChild(b);
    return b;
  });

  // Arrow buttons (tap again to clear)
  const arrowBtns = plan.arrows.map((arrow) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'arrow-btn';
    b.dataset.arrow = arrow.key;
    b.appendChild(arrowIcon(arrow.key));
    b.setAttribute('aria-label', arrow.name);
    b.style.setProperty('--sel-bg', arrow.colour);
    b.style.setProperty('--sel-fg', arrow.text);
    b.addEventListener('click', () => {
      closeKeypad();
      state.arrow = state.arrow === arrow.key ? null : arrow.key;
      state.arrowByHand = true;   // chosen (or cleared) by hand: Libre leaves the arrow alone from now on
      state.libreArrowKey = null;
      render();
    });
    els.arrowGrid.appendChild(b);
    return b;
  });

  // Blood sugar reading: digits only, up to 3
  els.reading.addEventListener('input', () => {
    const clean = els.reading.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 3);
    if (clean !== els.reading.value) els.reading.value = clean;
    state.reading = clean;
    if (state.libreTakenAt) {
      // Typed by hand: no longer the Libre reading, so the arrow Libre selected goes too
      if (!state.arrowByHand && state.libreArrowKey && state.arrow === state.libreArrowKey) state.arrow = null;
      state.libreTakenAt = null;
      state.libreArrowKey = null;
    }
    // Emptied by hand: like Clear, Libre does not fill it again by itself (tap the Libre line to use a reading)
    if (clean === '') live.autoFill = false;
    render();
  });

  // Food rows
  els.names.forEach((input, i) => {
    input.addEventListener('input', () => {
      state.foods[i].name = input.value;
      render();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        els.carbs[i].focus();
      }
    });
  });
  els.carbs.forEach((input, i) => {
    input.addEventListener('input', () => {
      let v = input.value.replace(/,/g, '.').replace(/[^\d.]/g, '');
      const dot = v.indexOf('.');
      if (dot !== -1) v = v.slice(0, dot + 1) + v.slice(dot + 1).replace(/\./g, '');
      v = v.slice(0, 5);
      if (v !== input.value) input.value = v;
      state.foods[i].carbs = v;
      render();
    });
  });

  // Tapping an empty part of the screen closes the keypad
  els.pageCalc.addEventListener('click', (e) => {
    if (!e.target.closest('input, .box-reading')) closeKeypad();
  });

  function resetAll() {
    const fresh = freshState();
    state.meal = fresh.meal;
    state.reading = '';
    state.arrow = null;
    state.arrowByHand = false;
    state.foods = fresh.foods;
    state.libreTakenAt = null;
    state.libreArrowKey = null;
    closeLibreSheet();
    els.reading.value = '';
    els.names.forEach((n) => { n.value = ''; });
    els.carbs.forEach((c) => { c.value = ''; });
    closeKeypad();
    render();
  }
  els.clear.addEventListener('click', () => {
    resetAll();
    // A dose was probably just given: do not fill the box again by itself (tap the Libre line to use a reading)
    live.autoFill = false;
    renderLiveLine();
  });

  function isPristine() {
    return !libreSheet && state.reading === '' && !state.arrow &&
      state.foods.every((f) => f.name.trim() === '' && f.carbs === '');
  }

  /* ---- Libre reading box: shown over the calculator; nothing is used until "Use this reading" is tapped ---- */
  function closeLibreSheet() {
    if (libreSheet) {
      libreSheet.remove();
      libreSheet = null;
    }
    // Forget the reading in the address so a reload never shows it again
    if (location.search) {
      try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) { /* ignore */ }
    }
  }

  function timeText(date) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function typeItMyself() {
    closeLibreSheet();
    els.reading.focus();
  }

  function showLibreSheet(ready) {
    const result = ready || checkLibreReading(libreParams, new Date());
    if (!result) return;
    if (libreSheet) libreSheet.remove();
    closeKeypad();

    const card = h('div', { class: 'libre-card' });
    card.appendChild(h('h2', { id: 'libre-title', text: 'Reading from Libre' }));
    const buttons = h('div', { class: 'libre-btns' });

    if (result.ok) {
      const value = h('p', { class: 'libre-value' }, [String(result.value)]);
      value.appendChild(h('span', { text: 'mg/dL' }));
      setColours(value, readingColour(result.value));
      card.appendChild(value);
      card.appendChild(h('p', { class: 'libre-time', text: 'Taken at ' + timeText(result.takenAt) + ' (' + ageText(result.ageMinutes) + ')' }));
      if (result.arrow) {
        const arrow = h('p', { class: 'libre-arrow' }, ['Libre arrow: ']);
        arrow.appendChild(arrowIcon(result.arrow.key, 'libre-arrow-big'));
        arrow.appendChild(document.createTextNode(' ' + result.arrow.name + '. Use this reading also selects '));
        arrow.appendChild(arrowIcon(result.arrow.key));
        arrow.appendChild(document.createTextNode(' in the calculator.'));
        card.appendChild(arrow);
      } else {
        card.appendChild(h('p', { class: 'libre-arrow', text: 'No arrow from Libre. Check the Libre app and tap the arrow yourself.' }));
      }

      const use = h('button', { type: 'button', class: 'primary', text: 'Use this reading' });
      use.addEventListener('click', () => {
        const now = checkLibreReading(libreParams, new Date());
        if (!now || !now.ok) { showLibreSheet(); return; } // became too old while the box was open
        state.reading = String(now.value);
        els.reading.value = state.reading;
        state.arrow = now.arrow ? now.arrow.key : null;
        state.arrowByHand = false;
        state.libreArrowKey = state.arrow;
        state.libreTakenAt = now.takenAt;
        closeLibreSheet();
        render();
        liveReapply(); // a newer live reading may already be waiting
      });
      buttons.appendChild(use);
      buttons.appendChild(h('button', { type: 'button', text: 'Type it myself' }));
    } else {
      card.appendChild(h('p', { class: 'libre-problem', text: libreProblemText(result) }));
      buttons.appendChild(h('button', { type: 'button', class: 'primary', text: 'Type the reading myself' }));
    }
    buttons.lastChild.addEventListener('click', typeItMyself);
    card.appendChild(buttons);

    libreSheet = h('div', { class: 'libre-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'libre-title' }, [card]);
    libreSheet.dataset.kind = ready ? 'expired' : 'offer';
    document.getElementById('app').appendChild(libreSheet);
    buttons.firstChild.focus();
  }

  function setColours(el, colour) {
    if (colour) {
      el.style.setProperty('--bg', colour.background);
      el.style.setProperty('--fg', colour.text);
      el.classList.add('coloured');
      el.dataset.colour = colour.name;
    } else {
      el.style.removeProperty('--bg');
      el.style.removeProperty('--fg');
      el.classList.remove('coloured');
      delete el.dataset.colour;
    }
  }

  let lastMessageKey = null;

  function showMessage(el, msg) {
    el.className = el.dataset.base || 'message';
    if (msg) {
      el.classList.add('msg-' + msg.style);
      if (msg.flash) {
        void el.offsetWidth; // restart the blink from the red state
        el.classList.add('flash');
      }
    } else {
      el.classList.add('empty');
    }
    el.textContent = msg ? msg.text : '';
    el.dataset.key = msg ? msg.key : '';
  }

  function render() {
    const r = calculate(state);

    els.total.textContent = String(r.total);
    els.hudTotal.textContent = r.totalText;
    els.hudReading.textContent = r.reading === null ? '' : String(r.reading);
    setColours(els.hudReading, r.readingColour);

    chips.forEach((c) => {
      const on = c.dataset.meal === state.meal;
      c.classList.toggle('on', on);
      c.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    els.mealInfo.textContent = r.mealInfo;

    setColours(els.readingBox, r.readingColour);
    els.readingLabel.textContent = state.libreTakenAt ? 'Blood Sugar (Libre)' : 'Blood Sugar Reading';

    arrowBtns.forEach((b) => {
      const on = b.dataset.arrow === state.arrow;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    if (r.arrowColour) els.arrowBox.dataset.colour = r.arrowColour.name;
    else delete els.arrowBox.dataset.colour;

    els.correction.textContent = r.correction.text;
    els.correction.classList.toggle('small', r.correction.kind === 'notNeeded');
    els.correction.dataset.kind = r.correction.kind;

    const key = r.message ? r.message.key : '';
    if (key !== lastMessageKey) {
      showMessage(els.message, r.message);
      showMessage(els.hudMsg, r.message);
      lastMessageKey = key;
    }

    r.foods.forEach((f, i) => {
      const d = els.doses[i];
      d.textContent = f.text;
      d.classList.toggle('nofood', f.kind === 'noFood');
      const hasName = state.foods[i].name.trim() !== '';
      const hasCarbs = toNumber(state.foods[i].carbs) !== null;
      els.names[i].classList.toggle('needs', !hasName && hasCarbs);
      els.carbs[i].classList.toggle('needs', hasName && !hasCarbs);
    });

    renderLiveLine();
    updateHud();
  }

  /* ---- Keypad view: when the keypad (or iPhone scrolling to a food box) hides the Total,
          the reading or the message, a strip with all three is shown at the top of what is visible ---- */
  const vv = window.visualViewport;
  function inView(el, top, bottom) {
    const rect = el.getBoundingClientRect();
    return rect.top >= top - 2 && rect.bottom <= bottom + 2;
  }
  function updateHud() {
    if (!vv || els.pageCalc.hidden) { els.hud.hidden = true; return; }
    const top = vv.offsetTop;
    const bottom = vv.offsetTop + vv.height;
    const hasMessage = !els.message.classList.contains('empty');
    const messageInView = !hasMessage || inView(els.message, top, bottom);
    const hidden = !inView(els.totalBox, top, bottom) || !inView(els.readingBox, top, bottom) || !messageInView;
    els.hud.hidden = !hidden;
    els.hudMsg.hidden = messageInView; // no need to show the message twice
    if (hidden) els.hud.style.transform = 'translate3d(0,' + Math.max(0, top) + 'px,0)';
  }
  if (vv) {
    vv.addEventListener('resize', updateHud);
    vv.addEventListener('scroll', updateHud);
  }
  window.addEventListener('scroll', updateHud, { passive: true });
  document.addEventListener('focusout', () => setTimeout(updateHud, 350));

  /* ---- Tabs ---- */
  const pages = Array.from(document.querySelectorAll('.page'));
  const tabs = Array.from(document.querySelectorAll('.tab'));
  function showPage(name) {
    closeKeypad();
    pages.forEach((p) => {
      const on = p.dataset.page === name;
      p.hidden = !on;
      if (on && p.classList.contains('page-scroll')) p.scrollTop = 0;
    });
    tabs.forEach((t) => t.setAttribute('aria-selected', t.dataset.page === name ? 'true' : 'false'));
    updateHud();
  }
  tabs.forEach((t) => t.addEventListener('click', () => showPage(t.dataset.page)));

  /* ---- Plan and Instructions pages, built from DOSE_PLAN ---- */
  buildPlanPage($('plan-content'));
  buildHelpPage($('help-content'));
  els.reminder.appendChild(h('strong', { text: plan.disclaimer }));
  els.reminder.appendChild(document.createTextNode(' ' + plan.reminderLine));

  /* ---- Clear after a long time in the background ---- */
  let hiddenAt = null;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      hiddenAt = Date.now();
    } else if (hiddenAt !== null) {
      const away = Date.now() - hiddenAt;
      hiddenAt = null;
      if (away > APP_SETTINGS.autoClearMinutes * 60000) {
        resetAll();
        live.autoFill = true; // a new start: the latest Libre reading may fill the box again
        showPage('calc');
      }
    }
  });

  /* ---- Offline copy and updates ---- */
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    const hadController = !!navigator.serviceWorker.controller;
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloading) return;
      reloading = true;
      location.reload();
    });
    const offerUpdate = (worker) => {
      const activate = () => worker.postMessage({ type: 'SKIP_WAITING' });
      if (isPristine()) {
        activate();
      } else {
        els.updateBar.hidden = false;
        els.updateBar.onclick = () => { els.updateBar.hidden = true; activate(); };
      }
    };
    navigator.serviceWorker.register('./service-worker.js').then((reg) => {
      if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const worker = reg.installing;
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(worker);
        });
      });
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) reg.update().catch(() => {});
      });
    }).catch(() => {});
  }
  if ('caches' in window) {
    caches.keys().then((keys) => {
      const k = keys.find((name) => name.indexOf('insulin-dose-') === 0);
      if (k) $('cache-version').textContent = k.replace('insulin-dose-', '');
    }).catch(() => {});
  }

  // Removes a Libre reading that is more than 10 minutes old. Returns its age in minutes (or null).
  // quiet: no message box yet (used on return to the app while the latest reading is fetched).
  function expireOldLibre(quiet) {
    if (!state.libreTakenAt) return null;
    const ageMinutes = (Date.now() - state.libreTakenAt.getTime()) / 60000;
    if (ageMinutes <= APP_SETTINGS.libre.maxAgeMinutes) return null;
    state.reading = '';
    els.reading.value = '';
    state.arrow = null; // the arrow belonged to that reading too, even if changed by hand
    state.arrowByHand = false;
    state.libreTakenAt = null;
    state.libreArrowKey = null;
    closeKeypad();
    render();
    if (!quiet) showExpired(ageMinutes);
    return ageMinutes;
  }

  function showExpired(ageMinutes) {
    if (libreSheet && libreSheet.dataset.kind === 'connect') return; // the Libre line says it; keep what is being typed
    showLibreSheet({ ok: false, reason: 'expired', ageMinutes });
  }

  function checkLibreAge() {
    if (libreSheet && libreSheet.dataset.kind === 'offer') {
      showLibreSheet(); // refresh the age text (or show "too old")
    }
    expireOldLibre(false);
    renderLiveLine(); // keeps "x min ago" up to date
  }
  setInterval(checkLibreAge, 30000);

  /* ---- LIVE LIBRE: while the calculator is open, ask the relay for the latest reading about once a minute ---- */
  function liveConfigured() { return live.url !== ''; }
  function liveOn() { return liveConfigured() && live.key !== ''; }

  function liveBox() {
    return {
      reading: state.reading,
      libreTakenAt: state.libreTakenAt,
      autoFill: live.autoFill,
      focused: document.activeElement === els.reading,
      sheetOpen: !!libreSheet
    };
  }

  function liveSchedule() {
    clearTimeout(live.timer);
    live.timer = null;
    if (!liveOn() || document.hidden) return;
    const wait = Math.max(APP_SETTINGS.libreLive.everySeconds * 1000, live.waitUntil - Date.now());
    live.timer = setTimeout(() => { liveFetch(); }, wait);
  }

  function liveFetch() {
    if (!liveOn()) return Promise.resolve();
    if (live.inflight) return live.inflight;
    if (Date.now() < live.waitUntil) { liveSchedule(); return Promise.resolve(); }
    const gen = live.gen;
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timeout = setTimeout(() => { if (ctrl) ctrl.abort(); }, APP_SETTINGS.libreLive.timeoutSeconds * 1000);
    const request = fetch(live.url + '/latest', {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + live.key },
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: ctrl ? ctrl.signal : undefined
    })
      .then((res) => res.json().catch(() => null))
      .then((reply) => {
        if (gen !== live.gen) return; // asked before Connect / Turn off: ignore
        live.network = false;
        liveReceive(reply, Date.now());
      }, () => {
        if (gen === live.gen) live.network = true;
      })
      .catch(() => { /* never let one bad answer stop the checks */ })
      .then(() => {
        clearTimeout(timeout);
        if (live.inflight === request) {
          live.inflight = null;
          live.ctrl = null;
        }
        if (gen === live.gen) {
          renderLiveLine();
          liveSchedule();
        }
      });
    live.inflight = request;
    live.ctrl = ctrl;
    renderLiveLine();
    return request;
  }

  // After Connect or Turn off: forget any answer already on its way
  function liveRestart() {
    live.gen++;
    if (live.ctrl) live.ctrl.abort();
    live.inflight = null;
    live.ctrl = null;
    clearTimeout(live.timer);
    live.reply = null;
    live.skew = null;
    live.network = false;
    live.waitUntil = 0;
  }

  function liveReceive(reply, receivedAt) {
    live.reply = reply;
    live.skew = clockSkew(reply, receivedAt);
    const result = checkRelayReply(reply, new Date(), live.skew);
    if (result.reason === 'relay' && result.retryAfter > 0) live.waitUntil = Date.now() + result.retryAfter * 1000;
    liveApply(result);
  }

  function liveApply(result) {
    const action = liveAction(liveBox(), result);
    if (action === 'fill') useLibreReading(result, false);
    else if (action === 'update') useLibreReading(result, true);
    else if (action === 'remove') removeLibreReading(result);
  }

  // Applies the last answer again (e.g. right after the Shortcut box closes)
  function liveReapply() {
    if (!liveOn()) return;
    const r = liveResultNow();
    if (r) liveApply(r);
    renderLiveLine();
  }

  // Puts a Libre reading in the box. The Libre arrow comes with it unless an arrow was chosen (or cleared) by hand.
  function useLibreReading(result, isUpdate) {
    state.reading = String(result.value);
    els.reading.value = state.reading;
    if (!state.arrowByHand) {
      state.arrow = result.arrow ? result.arrow.key : null;
      state.libreArrowKey = state.arrow;
    }
    state.libreTakenAt = result.takenAt;
    render();
    if (isUpdate) {
      els.readingBox.classList.remove('libre-new');
      void els.readingBox.offsetWidth; // restart the highlight
      els.readingBox.classList.add('libre-new');
    }
  }

  // A newer Libre reading cannot be used (LO, HI, clock): the older one leaves the calculator too
  function removeLibreReading(result) {
    state.reading = '';
    els.reading.value = '';
    state.arrow = null; // the arrow belonged to that reading too
    state.arrowByHand = false;
    state.libreTakenAt = null;
    state.libreArrowKey = null;
    closeKeypad();
    render();
    showLibreSheet(result);
  }

  function liveResultNow() {
    return live.reply ? checkRelayReply(live.reply, new Date(), live.skew) : null;
  }

  function renderLiveLine() {
    if (!els.strip) return;
    if (!liveConfigured()) {
      els.strip.hidden = true;
      els.title.classList.remove('title-off');
      return;
    }
    els.title.classList.add('title-off'); // still there for screen readers
    els.strip.hidden = false;
    const r = liveResultNow();
    const boxTime = state.libreTakenAt ? state.libreTakenAt.getTime() : null;
    const inUse = !!(r && r.ok && boxTime !== null && r.takenAt.getTime() === boxTime);
    const s = liveLine({
      connected: liveOn(),
      network: live.network,
      result: r,
      inUse,
      older: !!(r && r.ok && boxTime !== null && r.takenAt.getTime() < boxTime),
      arrowDiffers: inUse && !!r.arrow && state.arrow !== r.arrow.key
    });
    const strip = els.strip;
    strip.className = 'libre-line tone-' + s.tone + (live.inflight ? ' busy' : '');
    strip.dataset.tap = s.tap;
    strip.setAttribute('aria-label', s.label);
    strip.textContent = '';
    strip.appendChild(h('span', { class: 'll-dot', 'aria-hidden': 'true' }));
    const text = h('span', { class: 'll-text', 'aria-hidden': 'true' }, [s.before]);
    if (s.arrowKey) {
      text.appendChild(document.createTextNode(' '));
      text.appendChild(arrowIcon(s.arrowKey));
    }
    if (s.after) text.appendChild(document.createTextNode(s.after));
    strip.appendChild(text);
  }

  if (els.strip) {
    els.strip.addEventListener('click', () => {
      closeKeypad();
      const tap = els.strip.dataset.tap;
      if (tap === 'connect') { openConnectSheet(); return; }
      if (tap === 'use') {
        const r = liveResultNow();
        const boxTime = state.libreTakenAt ? state.libreTakenAt.getTime() : null;
        if (r && r.ok && !libreSheet && (boxTime === null || r.takenAt.getTime() > boxTime)) {
          live.autoFill = true;
          state.arrowByHand = false; // asked for the Libre reading: its arrow comes too (check it)
          useLibreReading(r, false);
          return;
        }
      }
      if (Date.now() - live.lastTap < APP_SETTINGS.libreLive.minTapSeconds * 1000) return;
      live.lastTap = Date.now();
      live.waitUntil = 0;
      liveFetch();
    });
  }

  // Connect (or change the key / turn off) – with the reminder that the reading is only a guide
  function openConnectSheet() {
    if (libreSheet) libreSheet.remove();
    closeKeypad();
    const card = h('div', { class: 'libre-card' });
    card.appendChild(h('h2', { id: 'libre-title', text: 'Live Libre readings' }));
    card.appendChild(h('p', { class: 'libre-info', text: 'While the calculator is open it gets the latest LibreLinkUp reading about once a minute and puts it in the Blood Sugar box with the Libre arrow. When a newer reading comes, the box and the Total update by themselves.' }));
    card.appendChild(h('p', { class: 'libre-warn', text: 'A guide only – not a go-ahead to inject. Libre readings can be late, missing or wrong. Before every dose check the reading in the Libre app (or do a finger-prick check) and the dose against the written plan. The person giving the insulin is always responsible for the final dose.' }));
    card.appendChild(h('label', { class: 'libre-key-label', for: 'libre-key', text: 'Relay key (RELAY_KEY)' }));
    const input = h('input', {
      id: 'libre-key', class: 'libre-key', type: 'text', maxlength: '200', autocomplete: 'off',
      autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: 'Paste the key here'
    });
    input.value = live.key;
    card.appendChild(input);
    const problem = h('p', { class: 'libre-problem', hidden: '' });
    card.appendChild(problem);

    const buttons = h('div', { class: 'libre-btns' });
    const connect = h('button', { type: 'button', class: 'primary', text: 'I understand – connect' });
    connect.addEventListener('click', () => {
      const key = input.value.trim();
      if (key.length < 16) {
        problem.textContent = 'That key is too short. Copy the whole RELAY_KEY.';
        problem.hidden = false;
        return;
      }
      liveRestart();
      live.key = key;
      saveRelayKey(key);
      live.autoFill = true;
      closeLibreSheet();
      renderLiveLine();
      renderHelpLive();
      liveFetch();
    });
    buttons.appendChild(connect);
    if (live.key) {
      const off = h('button', { type: 'button', text: 'Turn off on this phone' });
      off.addEventListener('click', () => {
        liveRestart();
        live.key = '';
        saveRelayKey('');
        closeLibreSheet();
        renderLiveLine();
        renderHelpLive();
      });
      buttons.appendChild(off);
    }
    const later = h('button', { type: 'button', text: 'Not now' });
    later.addEventListener('click', closeLibreSheet);
    buttons.appendChild(later);
    card.appendChild(buttons);

    libreSheet = h('div', { class: 'libre-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'libre-title' }, [card]);
    libreSheet.dataset.kind = 'connect';
    document.getElementById('app').appendChild(libreSheet);
    input.focus();
  }

  // Status and button on the Instructions page
  function renderHelpLive() {
    const status = $('libre-live-status');
    const btn = $('libre-live-btn');
    if (!status || !btn) return;
    status.textContent = liveOn() ? 'On this phone: connected.' : 'On this phone: not connected.';
    btn.textContent = liveOn() ? 'Change the key or turn off' : 'Connect live Libre readings';
  }
  if ($('libre-live-btn')) {
    $('libre-live-btn').addEventListener('click', () => { showPage('calc'); openConnectSheet(); });
    renderHelpLive();
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      clearTimeout(live.timer);
      return;
    }
    if (!liveOn()) { checkLibreAge(); return; }
    // An old reading leaves the calculator straight away; the message waits until Libre has been asked,
    // because a newer reading may fill the box again
    if (libreSheet && libreSheet.dataset.kind === 'offer') showLibreSheet();
    const expiredAge = expireOldLibre(true);
    const since = Date.now();
    liveFetch().then(() => {
      if (expiredAge !== null && !state.libreTakenAt) showExpired(expiredAge + (Date.now() - since) / 60000);
      checkLibreAge();
    });
  });
  window.addEventListener('online', () => { if (liveOn()) liveFetch(); });

  render();
  showLibreSheet();
  liveFetch();
}

/* ---- Trend arrow icon: one arrow shape turned to the angle the Libre app uses,
        so all five look the same on every phone (the font's ↗ and ↘ differ from ↑ → ↓) ---- */
const ARROW_ANGLES = { upFast: -90, up: -45, steady: 0, down: 45, downFast: 90 };
function arrowIcon(key, extraClass) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'arrow-icon' + (extraClass ? ' ' + extraClass : ''));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', 'M3.5 12H20M13.5 5.5L20 12l-6.5 6.5');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '3');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  path.setAttribute('transform', 'rotate(' + (ARROW_ANGLES[key] || 0) + ' 12 12)');
  svg.appendChild(path);
  return svg;
}

/* ---- Small helper to build elements without innerHTML ---- */
function h(tag, attrs, children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const k of Object.keys(attrs)) {
      if (k === 'text') el.textContent = attrs[k];
      else if (k === 'class') el.className = attrs[k];
      else el.setAttribute(k, attrs[k]);
    }
  }
  (children || []).forEach((c) => el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
  return el;
}

function table(headers, rows, cls) {
  return h('div', { class: 'tbl-wrap' }, [
    h('table', { class: 'tbl' + (cls ? ' ' + cls : '') }, [
      h('thead', null, [h('tr', null, headers.map((t) => h('th', { text: t, scope: 'col' })))]),
      h('tbody', null, rows.map((row) => h('tr', null, row.map((cell, i) => {
        if (cell && typeof cell === 'object' && cell.swatch) {
          const td = h(i === 0 ? 'th' : 'td', i === 0 ? { scope: 'row' } : null);
          const sw = cell.arrowKey
            ? h('span', { class: 'swatch', role: 'img', 'aria-label': cell.text }, [arrowIcon(cell.arrowKey)])
            : h('span', { class: 'swatch', text: cell.text });
          sw.style.setProperty('--bg', cell.swatch);
          sw.style.setProperty('--fg', cell.fg);
          td.appendChild(sw);
          return td;
        }
        return h(i === 0 ? 'th' : 'td', i === 0 ? { scope: 'row', text: String(cell) } : { text: String(cell) });
      }))))
    ])
  ]);
}

function signed(n) {
  return n > 0 ? '+' + n : n < 0 ? '−' + Math.abs(n) : '0';
}

function buildPlanPage(root) {
  const p = DOSE_PLAN;
  const cols = p.columns;
  root.appendChild(h('h2', { text: p.planTitle }));

  root.appendChild(h('h3', { text: 'Insulin-to-carb ratio and correction factor' }));
  root.appendChild(table([''].concat(cols), [
    ['Carb ratio (g per 1 unit)'].concat(cols.map((c) => p.carbRatio[c])),
    ['Correction factor (mg/dL per 1 unit)*'].concat(cols.map((c) => p.correctionFactor[c]))
  ], 'first-wide'));
  root.appendChild(h('p', { class: 'note', text: '* Information only – the correction dose comes from the correction table.' }));

  root.appendChild(h('h3', { text: 'Meal time settings' }));
  root.appendChild(table(['Meal Time', 'Uses column', 'Correction needed?', 'Target mg/dL', 'Planned carbs g'],
    p.meals.map((m) => [m.planLabel || m.name, m.column, m.correction ? 'Yes' : 'No', m.target, m.plannedCarbs]), 'first-wide'));

  root.appendChild(h('h3', { text: 'Glucose correction (units)' }));
  root.appendChild(table(['Blood sugar mg/dL'].concat(cols),
    p.correctionTable.map((row) => [row.label].concat(cols.map((c) => row.units[c]))), 'first-wide'));
  root.appendChild(h('p', { class: 'note', text: 'The row used is the highest band the reading has reached.' }));

  root.appendChild(h('h3', { text: 'Trend arrow adjustment (units)' }));
  root.appendChild(table(['Libre arrow', 'Written plan', 'Units', 'Meaning'],
    p.arrows.map((a) => [{ swatch: a.colour, fg: a.text, text: a.name, arrowKey: a.key }, a.planSymbol, signed(a.adjust), a.name + ' (' + a.rate + ')'])
      .concat([['Blank', '', '0', 'No arrow']])));
  root.appendChild(h('p', { class: 'note', text: 'Arrows are shown as in the FreeStyle Libre app. “Written plan” shows the same arrow as drawn in the written plan.' }));

  root.appendChild(h('h3', { text: 'Blood sugar colours' }));
  root.appendChild(table(['Colour', 'Blood sugar mg/dL'],
    p.readingColours.map((c) => [{ swatch: c.colour, fg: c.text, text: c.colourName }, c.label])));

  root.appendChild(h('p', { class: 'disclaimer', text: p.disclaimer }));
}

function buildHelpPage(root) {
  const p = DOSE_PLAN;
  const ratios = Array.from(new Set(p.columns.map((c) => p.carbRatio[c])));
  const ratioText = ratios.length === 1 ? ratios[0] + ' g' : 'the carb ratio for the meal';

  root.appendChild(h('h2', { text: 'Instructions' }));
  root.appendChild(h('h3', { text: 'How to use' }));
  root.appendChild(h('ol', { class: 'steps' }, [
    'Check the Meal Time. Breakfast, Lunch, Dinner or Bedtime is picked from the phone’s clock – tap another one to change it.',
    'Check the Blood Sugar Reading (mg/dL). With live Libre readings it is filled in from Libre – check it matches the Libre app. Otherwise type it (or use the box the Libre Shortcut shows).',
    'Check the trend arrow matches the Libre app (live Libre readings select it for you). Tap an arrow to change it; tap it again to clear it. Leave it blank if there is no arrow.',
    'For each food type its name and its carbs in grams. A row only counts when both are filled in (an orange dashed box means something is missing).',
    'Read the yellow TOTAL and the message just under it. Check against the written plan before injecting.',
    'Tap Clear before the next reading. The app also clears itself after ' + APP_SETTINGS.autoClearMinutes + ' minutes in the background.'
  ].map((t) => h('li', { text: t }))));

  const libre = APP_SETTINGS.libre;
  const liveSet = String(APP_SETTINGS.libreLive.relayUrl || '').trim() !== '';
  root.appendChild(h('h3', { text: 'Live Libre readings' }));
  if (liveSet) {
    root.appendChild(h('ul', { class: 'reminders' }, [
      'While the calculator is open and online it gets the latest LibreLinkUp reading about once a minute. When the sensor sends a new reading (or it is scanned), the Blood Sugar box, the arrow and the Total update by themselves and the box flashes blue.',
      'The line at the top shows the Libre reading, its arrow and how old it is. Tap it to check again now.',
      'It fills the box when the box is empty and keeps it up to date. A reading you type yourself is never changed – tap the Libre line to use the Libre reading instead. An arrow you choose by hand is kept (the line then says “check arrow” if Libre shows a different one).',
      'After Clear (or emptying the box by hand) the box stays empty until you tap the Libre line, so a dose that was just given is not worked out again by itself.',
      'While the keypad is open for the Blood Sugar box nothing in it changes; a newer reading waits on the Libre line.',
      'Readings older than ' + libre.maxAgeMinutes + ' minutes, LO and HI are never used. If Libre stops sending readings, the last one is removed once it is more than ' + libre.maxAgeMinutes + ' minutes old.',
      'LibreLinkUp is used in an unofficial way and can be a few minutes behind the Libre app or stop working at any time. Then type the reading as before.'
    ].map((t) => h('li', { text: t }))));
    root.appendChild(h('p', { class: 'disclaimer', text: 'Live Libre readings are a guide only – not a go-ahead to inject. Before every dose check the reading in the Libre app (or do a finger-prick check) and the dose against the written plan. The person giving the insulin is always responsible for the final dose.' }));
    root.appendChild(h('p', { class: 'note', id: 'libre-live-status' }));
    root.appendChild(h('button', { type: 'button', class: 'doc-btn', id: 'libre-live-btn', text: 'Connect live Libre readings' }));
  } else {
    root.appendChild(h('p', { class: 'note', text: 'Not set up in this copy of the calculator (see “Live Libre readings” in the README).' }));
  }

  root.appendChild(h('h3', { text: 'Reading from Libre (Shortcut)' }));
  root.appendChild(h('ul', { class: 'reminders' }, [
    'The Libre Shortcut gets the latest reading from LibreLinkUp and opens the calculator with a box showing the reading and when it was taken.',
    'Nothing is used until you tap Use this reading. Readings older than ' + libre.maxAgeMinutes + ' minutes, LO or HI are refused – then check the Libre app and type the reading.',
    'A Libre reading and its arrow are removed from the calculator once the reading is more than ' + libre.maxAgeMinutes + ' minutes old, or when you type a reading yourself.',
    'Use this reading also selects the Libre arrow. Check it matches the Libre app; tap another arrow to change it.',
    'LibreLinkUp can be a few minutes behind the Libre app. If the number looks wrong, check the Libre app or do a finger-prick check.'
  ].map((t) => h('li', { text: t }))));

  root.appendChild(h('h3', { text: 'Reminders' }));
  root.appendChild(h('ul', { class: 'reminders' }, p.reminders.map((t) => h('li', { text: t }))));

  root.appendChild(h('h3', { text: 'How the numbers are worked out' }));
  root.appendChild(h('ul', { class: 'reminders' }, [
    'Correction Dose = units from the correction table for the reading (in the column shown on the Plan tab) plus the arrow units. It can be negative.',
    'Req’d. Dose = carbs ÷ ' + ratioText + ', rounded to the nearest whole unit (a half rounds up).',
    'TOTAL = Correction Dose + all food doses. It is never less than 0.'
  ].map((t) => h('li', { text: t }))));

  root.appendChild(h('p', { class: 'disclaimer', text: p.disclaimer }));

  root.appendChild(h('h3', { text: 'About' }));
  root.appendChild(h('p', { text: APP_INFO.name + ' – a helper that works out the insulin dose from the ' + p.planTitle +
    ', the same way as the Excel calculator.' }));
  const about = h('p', { class: 'note' }, [
    (liveSet
      ? 'Works offline (live Libre readings need internet). The only thing sent anywhere is the request to your Libre relay for the latest reading; the only thing saved on this phone is the relay key. '
      : 'Works offline. Nothing is saved or sent anywhere. ') + 'Plan: ' + p.planTitle + '. Offline copy: '
  ]);
  about.appendChild(h('span', { id: 'cache-version', text: 'not saved yet' }));
  about.appendChild(document.createTextNode('.'));
  root.appendChild(about);
  root.appendChild(h('p', { class: 'note', text: 'FreeStyle Libre, LibreLinkUp and LibreView are trademarks of Abbott. This app is not made by or connected with Abbott.' }));
  // Same text as creditLines(); the version and date are kept together on one line
  root.appendChild(h('div', { class: 'credits' }, [
    h('p', { text: APP_INFO.developer }),
    h('p', null, [APP_INFO.copyright + ' | ', h('span', { class: 'nowrap', text: 'Version ' + APP_INFO.version + ' · ' + APP_INFO.date })])
  ]));
}

/* ---- Start (browser) / export (tests) ---- */
if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initApp);
  else initApp();
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DOSE_PLAN, APP_SETTINGS, toNumber, roundHalfUp, formatUnits, findMeal, findArrow, arrowAdjustment,
    correctionRow, correctionDose, foodDose, messageFor, readingColour, arrowColour, mealForTime,
    mealInfoText, calculate, libreArrow, parseLibreTime, checkLibreReading, ageText, libreProblemText,
    clockSkew, checkRelayReply, liveAction, liveLine, APP_INFO, creditLines
  };
}

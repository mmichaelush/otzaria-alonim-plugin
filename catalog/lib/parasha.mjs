// Text analysis for Hebrew gilyon titles: parasha, special Shabbat/festival,
// Hebrew year, issue number, language and a cleaned display title. Pure functions.
//
// Precision over coverage: names that are also everyday words (בא, שמות,
// דברים, ראה ...) count only with a cue ("פרשת X", "עלון X"), next to a Hebrew
// year, or when the caller already knows which parasha to expect (`expect`).
import { normalizeKey } from './normalize.mjs';
import { PARASHA_SLUGS } from './calendar.mjs';

// All word lists below are compared against normalizeKey output (final letters
// folded: עלון -> עלונ), so every list goes through N() first.
const N = (list) => new Set(list.map((w) => normalizeKey(w)));

// ---- tokenizing ------------------------------------------------------------

const ch = (n) => String.fromCharCode(n);
// Zero-width and bidi control characters (common in tashma file names).
const BIDI_RE = new RegExp(`[${ch(0x200B)}-${ch(0x200F)}${ch(0x202A)}-${ch(0x202E)}${ch(0x2060)}-${ch(0x2069)}${ch(0xFEFF)}]`, 'g');
// A word is anything except whitespace, maqaf/dashes and common punctuation.
// Quotes and geresh stay inside words (ר', תשפ"ז); normalizeKey removes them.
const WORD_RE = /[^\s־‐-―\-_/\\,;:|()[\]{}<>*#@!?.~+=]+/gu;

/** Splits into words; each keeps the raw text, the normalized form and the separator before it. */
export function tokenize(text) {
  const out = [];
  let last = 0;
  const s = String(text ?? '').replace(BIDI_RE, '');
  for (const m of s.matchAll(WORD_RE)) {
    // "138נח" is a number glued to a word: two tokens.
    const pieces = /\d/.test(m[0]) && /\p{L}/u.test(m[0]) ? m[0].match(/\d+|\D+/g) : [m[0]];
    let at = m.index;
    for (const piece of pieces) {
      const n = normalizeKey(piece);
      if (n) { out.push({ w: piece, n, pre: s.slice(last, at) }); last = at + piece.length; }
      at += piece.length;
    }
  }
  return out;
}

// ---- parasha names -----------------------------------------------------------

// [slug, variants, ambiguous]. Variants are normalized and split into words at load.
const NAMES = [
  ['bereshit', ['בראשית'], true],
  ['noach', ['נח', 'נוח'], false],
  ['lech-lecha', ['לך לך', 'לך-לך'], false],
  ['vayera', ['וירא'], false],
  ['chayei-sara', ['חיי שרה', 'חי שרה'], false],
  ['toldot', ['תולדות', 'תולדת'], false],
  ['vayetzei', ['ויצא'], false],
  ['vayishlach', ['וישלח'], false],
  ['vayeshev', ['וישב'], false],
  ['miketz', ['מקץ'], false],
  ['vayigash', ['ויגש'], false],
  ['vayechi', ['ויחי'], false],
  ['shemot', ['שמות'], true],
  ['vaera', ['וארא'], false],
  ['bo', ['בא'], true],
  ['beshalach', ['בשלח'], false],
  ['yitro', ['יתרו'], true],
  ['mishpatim', ['משפטים'], true],
  ['terumah', ['תרומה'], true],
  ['tetzaveh', ['תצוה', 'תצווה'], false],
  ['ki-tisa', ['כי תשא'], false],
  ['vayakhel', ['ויקהל'], false],
  ['pekudei', ['פקודי'], false],
  ['vayikra', ['ויקרא'], true],
  ['tzav', ['צו'], true],
  ['shemini', ['שמיני'], true],
  ['tazria', ['תזריע'], false],
  ['metzora', ['מצורע'], false],
  ['achrei-mot', ['אחרי מות', 'אחרי'], true],
  ['kedoshim', ['קדושים', 'קדשים'], true],
  ['emor', ['אמור'], true],
  ['behar', ['בהר'], true],
  ['bechukotai', ['בחוקותי', 'בחקותי'], false],
  ['bamidbar', ['במדבר'], true],
  ['nasso', ['נשא', 'נשוא'], true],
  ['behaalotcha', ['בהעלותך', 'בהעלתך'], false],
  ['shlach', ['שלח', 'שלח לך'], true],
  ['korach', ['קרח'], true],
  ['chukat', ['חוקת', 'חקת'], false],
  ['balak', ['בלק'], true],
  ['pinchas', ['פינחס', 'פנחס'], true],
  ['matot', ['מטות'], false],
  ['masei', ['מסעי'], false],
  ['devarim', ['דברים'], true],
  ['vaetchanan', ['ואתחנן'], false],
  ['eikev', ['עקב'], true],
  ['reeh', ['ראה'], true],
  ['shoftim', ['שופטים'], false],
  ['ki-teitzei', ['כי תצא', 'כי תצה'], false],
  ['ki-tavo', ['כי תבוא', 'כי תבא'], false],
  ['nitzavim', ['נצבים', 'ניצבים'], false],
  ['vayeilech', ['וילך'], false],
  ['haazinu', ['האזינו'], false],
  ['vezot-haberakhah', ['וזאת הברכה'], false],
];

// Latin transliterations seen in English/Yiddish-English titles. Always ambiguous:
// they count with a cue ("Parshas X"), next to a year, or when expected.
const EN_NAMES = {
  bereshit: ['bereshit', 'bereishis', 'bereishit', 'breishis', 'bereshis', 'beresheet'],
  noach: ['noach', 'noah'],
  'lech-lecha': ['lech lecha', 'lech lecho', 'lekh lekha', 'lech lecha'],
  vayera: ['vayera', 'vayeira'],
  'chayei-sara': ['chayei sarah', 'chayei sara', 'chaye sarah', 'chayeh sarah'],
  toldot: ['toldot', 'toldos', 'toledot'],
  vayetzei: ['vayetzei', 'vayetze', 'vayeitzei', 'vayeitze'],
  vayishlach: ['vayishlach', 'vayishlah'],
  vayeshev: ['vayeshev', 'vayeishev'],
  miketz: ['miketz', 'mikeitz', 'mikets'],
  vayigash: ['vayigash'],
  vayechi: ['vayechi', 'vayehi'],
  shemot: ['shemot', 'shemos'],
  vaera: ['vaera', 'vaeira'],
  bo: ['bo'],
  beshalach: ['beshalach', 'beshalah'],
  yitro: ['yitro', 'yisro'],
  mishpatim: ['mishpatim'],
  terumah: ['terumah', 'trumah'],
  tetzaveh: ['tetzaveh', 'tetzave'],
  'ki-tisa': ['ki tisa', 'ki sisa', 'ki tissa'],
  vayakhel: ['vayakhel', 'vayakheil'],
  pekudei: ['pekudei', 'pekudey'],
  vayikra: ['vayikra'],
  tzav: ['tzav'],
  shemini: ['shemini', 'shmini'],
  tazria: ['tazria', 'tazriah'],
  metzora: ['metzora', 'metzorah'],
  'achrei-mot': ['achrei mot', 'acharei mot', 'acharei mos', 'achrei mos'],
  kedoshim: ['kedoshim', 'kedoshem'],
  emor: ['emor'],
  behar: ['behar'],
  bechukotai: ['bechukotai', 'bechukosai', 'bechukosay'],
  bamidbar: ['bamidbar'],
  nasso: ['nasso', 'naso'],
  behaalotcha: ['behaalotcha', 'behaaloscha', 'behaalosecha'],
  shlach: ['shelach', 'shlach'],
  korach: ['korach', 'korah'],
  chukat: ['chukat', 'chukas', 'chukkat'],
  balak: ['balak'],
  pinchas: ['pinchas', 'pinchos'],
  matot: ['matot', 'matos', 'mattot'],
  masei: ['masei', 'massei'],
  devarim: ['devarim'],
  vaetchanan: ['vaetchanan', 'vaeschanan'],
  eikev: ['eikev', 'ekev'],
  reeh: ['reeh', 'raeh'],
  shoftim: ['shoftim'],
  'ki-teitzei': ['ki teitzei', 'ki seitzei', 'ki tetzei', 'ki setzei'],
  'ki-tavo': ['ki tavo', 'ki savo', 'ki tovo'],
  nitzavim: ['nitzavim'],
  vayeilech: ['vayeilech', 'vayelech'],
  haazinu: ['haazinu', 'haazeinu'],
  'vezot-haberakhah': ['vezos haberacha', 'vezot haberakhah'],
};
for (const [slug, variants] of Object.entries(EN_NAMES)) NAMES.push([slug, variants, true]);

// Abbreviations of double readings as they appear in file names (quotes dropped).
const COMBO_ABBR = [
  ['נצו"י', ['nitzavim', 'vayeilech']],
  ['מטו"מ', ['matot', 'masei']],
  ['אחו"ק', ['achrei-mot', 'kedoshim']],
  ['תזו"מ', ['tazria', 'metzora']],
  ['בחו"ב', ['behar', 'bechukotai']],
].map(([a, s]) => [normalizeKey(a), s]);

const ORDER = new Map(PARASHA_SLUGS.map((s, i) => [s, i]));
// Real double readings in Torah order.
const VALID_COMBOS = new Set([
  'vayakhel,pekudei', 'tazria,metzora', 'achrei-mot,kedoshim', 'behar,bechukotai', 'chukat,balak', 'matot,masei',
  'nitzavim,vayeilech',
]);

const PHRASES = [];
for (const [slug, variants, ambiguous] of NAMES) {
  const seen = new Set();
  for (const v of variants) {
    const words = normalizeKey(v).split(' ');
    const key = words.join(' ');
    if (seen.has(key)) continue;
    seen.add(key);
    // "אחרי" alone is ambiguous even though "אחרי מות" is not.
    PHRASES.push({ slug, words, ambiguous: ambiguous && (words.length === 1 || /^[a-z]/.test(words[0])) });
  }
}
// Longest first: "אחרי מות" beats "אחרי", "שלח לך" beats "שלח".
PHRASES.sort((a, b) => b.words.length - a.words.length);

// Words directly before a name that make it a parasha reference.
const CUE_WORDS = N(['פרשת', 'פרשה', 'פר', 'בפרשת', 'לפרשת', 'ופרשת', 'פרשיית', 'פרשית', 'פרשתנו', 'שבת', 'לשבת', 'בשבת',
  'עלון', 'גליון', 'גיליון', 'parashat', 'parshas', 'parshat', 'parsha', 'parasha', 'parashah', 'parshah', 'weekly']);
// Cues removed from the display title together with the parasha.
const CUE_REMOVE = N(['פרשת', 'פרשה', 'פר', 'בפרשת', 'לפרשת', 'ופרשת', 'פרשיית', 'פרשית', 'parashat', 'parshas', 'parshat', 'parsha', 'parasha', 'parashah', 'parshah']);
// "נח" right after a title of respect is a person, not the parasha.
const PERSON_TITLES = N(['הרב', 'רבי', 'ר', 'מרן', 'הגאון', 'הצדיק', 'הרה', 'הגה', 'האדמור', 'הרבי', 'רבינו', 'מו']);

function comboOf(slugs) {
  const sorted = [...new Set(slugs)].sort((a, b) => ORDER.get(a) - ORDER.get(b));
  return VALID_COMBOS.has(sorted.join(',')) ? sorted : null;
}

function matchAt(tokens, i) {
  for (const p of PHRASES) {
    if (i + p.words.length > tokens.length) continue;
    let ok = true;
    for (let k = 0; ok && k < p.words.length; k++) if (tokens[i + k].n !== p.words[k]) ok = false;
    if (ok) return p;
  }
  return null;
}

/**
 * Finds the parasha (or double reading).
 * Returns { slugs, from, to } or null. `expect` is a list of slugs the caller
 * already predicts (e.g. from the upload week); it licenses ambiguous words.
 */
export function detectParasha(tokens, { expect = [] } = {}) {
  const yearIdx = tokens.map((t, i) => (parseYearWord(t.n) ? i : -1)).filter((i) => i >= 0);
  // "שמיני עצרת" is a festival, not parashat Shemini.
  const inEvent = new Set(detectEvents(tokens).flatMap((e) => Array.from({ length: e.to - e.from }, (_, k) => e.from + k)));
  const hits = [];
  for (let i = 0; i < tokens.length; i++) {
    if (inEvent.has(i)) continue;
    const abbr = COMBO_ABBR.find(([a]) => a === tokens[i].n);
    if (abbr) { hits.push({ slugs: abbr[1], from: i, to: i + 1, strong: true }); continue; }
    const p = matchAt(tokens, i);
    if (!p) continue;
    const to = i + p.words.length;
    const prev = tokens[i - 1]?.n;
    let strong;
    if (!p.ambiguous) {
      strong = !(p.slug === 'noach' && prev && PERSON_TITLES.has(prev));
    } else {
      const cue = prev ? CUE_WORDS.has(prev) : false;
      strong = cue || yearIdx.includes(to) || yearIdx.includes(i - 1) || tokens.length === 1 || expect.includes(p.slug);
    }
    hits.push({ slugs: [p.slug], from: i, to, strong });
    i = to - 1;
  }
  const first = hits.find((h) => h.strong);
  if (!first) return null;
  let { slugs, from, to } = first;
  if (first.slugs.length === 1) {
    // Extend to a neighbouring name (any strength) when the pair is a real double reading.
    for (const h of hits) {
      if (h === first || h.slugs.length !== 1) continue;
      const after = h.from >= to && tokens.slice(to, h.from).every((t) => t.n === 'ו') && h.from - to <= 1;
      const before = h.to <= from && tokens.slice(h.to, from).every((t) => t.n === 'ו') && from - h.to <= 1;
      if (!after && !before) continue;
      const c = comboOf([...slugs, ...h.slugs]);
      if (!c) continue;
      slugs = c;
      from = Math.min(from, h.from);
      to = Math.max(to, h.to);
      break;
    }
    // "ומסעי": a conjunctive prefix on the second name.
    if (slugs.length === 1) {
      const next = tokens[to];
      if (next && next.n.length > 2 && next.n.startsWith('ו')) {
        const cand = PHRASES.find((p) => p.words.length === 1 && p.words[0] === next.n.slice(1) && !p.ambiguous);
        const c = cand && comboOf([...slugs, cand.slug]);
        if (c) { slugs = c; to += 1; }
      }
    }
  }
  return { slugs, from, to };
}

// ---- events (special Shabbatot and festivals) ----------------------------

const EVENT_PHRASES = [
  ['rosh-hashana', ['ראש השנה']],
  ['yom-kippur', ['יום כיפור', 'יום הכיפורים', 'יום כיפורים', 'יו"כ']],
  ['shabbat-shuva', ['שבת שובה', 'שבת תשובה']],
  ['sukkot', ['סוכות', 'הושענא רבה']],
  ['shemini-atzeret', ['שמיני עצרת', 'שמחת תורה']],
  ['chanukah', ['חנוכה']],
  ['shabbat-shirah', ['שבת שירה']],
  ['shabbat-shekalim', ['שבת שקלים']],
  ['shabbat-zachor', ['שבת זכור']],
  ['purim', ['פורים']],
  ['shabbat-parah', ['שבת פרה']],
  ['shabbat-hachodesh', ['שבת החודש', 'שבת החדש']],
  ['shabbat-hagadol', ['שבת הגדול']],
  ['pesach', ['פסח', 'ליל הסדר']],
  ['shavuot', ['שבועות']],
  ['shabbat-chazon', ['שבת חזון']],
  ['tisha-bav', ['תשעה באב', 'ט באב']],
  ['shabbat-nachamu', ['שבת נחמו']],
  ['tu-bishvat', ['טו בשבט']],
  ['lag-baomer', ['לג בעומר']],
].map(([slug, vs]) => ({ slug, phrases: vs.map((v) => normalizeKey(v).split(' ')) }));

/** Events mentioned in the tokens, in text order: [{slug, from, to}]. */
export function detectEvents(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    for (const e of EVENT_PHRASES) {
      const hit = e.phrases.find((ph) => ph.every((w, k) => tokens[i + k]?.n === w));
      if (hit) { out.push({ slug: e.slug, from: i, to: i + hit.length }); i += hit.length - 1; break; }
    }
  }
  return out;
}

// ---- Hebrew year ---------------------------------------------------------

const TENS = { 'י': 10, 'כ': 20, 'ל': 30, 'מ': 40, 'נ': 50, 'ס': 60, 'ע': 70, 'פ': 80, 'צ': 90 };
const UNITS = { 'א': 1, 'ב': 2, 'ג': 3, 'ד': 4, 'ה': 5, 'ו': 6, 'ז': 7, 'ח': 8, 'ט': 9 };

/** Parses one normalized word as a Hebrew year ("תשפז", "5787") or returns null. 5750-5799 only. */
export function parseYearWord(n) {
  if (/^57[5-9]\d$/.test(n)) return Number(n);
  const m = /^ה?תש(טו|טז|[יכלמנסעפצ][א-ט]?|[א-ט])?$/.exec(n);
  if (!m) return null;
  const r = m[1] || '';
  let v = 700;
  if (r === 'טו') v += 15;
  else if (r === 'טז') v += 16;
  else for (const c of r) v += TENS[c] ?? UNITS[c] ?? 0;
  const year = 5000 + v;
  return year >= 5750 && year <= 5799 ? year : null;
}

/** Short year right after a parasha: נח פ"ז = 5787. Requires the quote marks, tens פ or צ. */
export function parseShortYear(rawWord) {
  const m = /^([פצ])['"׳״]{1,2}([א-ט])$/.exec(rawWord.replace(/\?+$/, ''));
  return m ? 5700 + TENS[m[1]] + UNITS[m[2]] : null;
}

/** First Hebrew year in the tokens: { hy, index } or null. */
export function detectHebrewYear(tokens) {
  for (let i = 0; i < tokens.length; i++) {
    const hy = parseYearWord(tokens[i].n);
    if (!hy) continue;
    // "תשע" without a units letter is also the number nine ("תשע ימים"): only at the end of
    // the text, after "שנת", or written with the ה prefix.
    const bareTens = /^תש[יכלמנסעפצ]$/.test(tokens[i].n);
    if (bareTens && i !== tokens.length - 1 && !['שנת', 'ה'].includes(tokens[i - 1]?.n)) continue;
    return { hy, index: i };
  }
  return null;
}

// ---- issue number ----------------------------------------------------------

const NO_PREFIX = N(['גליון', 'גיליון', 'גל', 'מס', 'מספר', 'no', 'nr', 'number', 'issue']);
const GEMATRIA = { ...TENS, ...UNITS, 'ק': 100, 'ר': 200 };
const GILYON = N(['גליון', 'גיליון']);
const NOT_NUMERAL = N(['של', 'על', 'לשבת', 'מיוחד', 'חדש', 'כפול', 'בלבד', 'אחד', 'עם', 'את', 'אל', 'זה', 'לפרשת', 'מס', 'מספר']);
const COUNT_UNITS = N(['ימים', 'עמודים', 'עמוד', 'דקות', 'עמ', 'שקלים']);

function gematria(n) {
  if (n === 'טו') return 15;
  if (n === 'טז') return 16;
  let v = 0;
  for (const c of n) { if (!(c in GEMATRIA)) return null; v += GEMATRIA[c]; }
  return v;
}

/**
 * Issue number. Strong: after a keyword (גליון 21, מס' 21, #21) or a Hebrew
 * numeral after גליון. Weak: one bare number at either end of the remaining
 * title. `skip` holds token indexes already explained (parasha, year).
 * Returns { no, index, strong } or null.
 */
export function detectIssueNo(tokens, { skip = new Set() } = {}) {
  for (let i = 0; i < tokens.length; i++) {
    if (skip.has(i)) continue;
    const t = tokens[i];
    if (/^\d{1,4}$/.test(t.n)) {
      const prev = tokens[i - 1];
      if ((prev && NO_PREFIX.has(prev.n) && !skip.has(i - 1)) || /#\s*$/.test(t.pre)) return { no: Number(t.n), index: i, strong: true };
    } else if (i > 0 && GILYON.has(tokens[i - 1].n) && /^[א-ת]{1,3}$/.test(t.n) && !NOT_NUMERAL.has(t.n)) {
      const g = gematria(t.n);
      if (g && g <= 400) return { no: g, index: i, strong: true };
    }
  }
  const rest = tokens.map((t, i) => ({ t, i })).filter(({ i }) => !skip.has(i));
  const nums = rest.filter(({ t }) => /^\d{1,4}$/.test(t.n) && Number(t.n) > 0);
  if (nums.length === 1 && (rest.length >= 2 || (skip.size > 0 && rest.length === 1))) {
    const { t, i } = nums[0];
    const edge = rest[0].i === i || rest[rest.length - 1].i === i;
    const val = Number(t.n);
    const yearLike = (val >= 1900 && val <= 2100) || (val >= 5700 && val <= 5800);
    const unitAfter = tokens[i + 1] && COUNT_UNITS.has(tokens[i + 1].n);
    if (edge && !yearLike && !unitAfter) return { no: val, index: i, strong: false };
  }
  return null;
}

// ---- language ----------------------------------------------------------------

const LANG_WORDS = {
  yi: ['אידיש', 'יידיש', 'yiddish'],
  en: ['אנגלית', 'ענגליש', 'english'],
  fr: ['צרפתית', 'french'],
  es: ['ספרדית', 'spanish'],
  ru: ['רוסית', 'russian'],
  de: ['גרמנית', 'german'],
  it: ['איטלקית', 'italian'],
  nl: ['הולנדית', 'dutch'],
  pt: ['פורטוגזית', 'portuguese'],
  fa: ['פרסית', 'persian'],
  ar: ['ערבית', 'arabic'],
  he: ['עברית', 'לשון קדוש', 'לשון הקודש', 'hebrew'],
};
const LANG_BY_WORD = new Map();
for (const [code, words] of Object.entries(LANG_WORDS)) for (const w of words) LANG_BY_WORD.set(normalizeKey(w), code);

/** Maps a Hebrew language name from a source ("אנגלית", "לשון קדוש") to a code, or null. */
export function langFromName(name) {
  return LANG_BY_WORD.get(normalizeKey(name)) ?? null;
}

const YIDDISH_MARKERS = N(['דעם', 'דער', 'פון', 'מיט', 'איז', 'ווארט', 'אידישע', 'אידישן', 'שטיקל', 'ליכטיגן', 'לעכטיגן', 'טיפערן', 'געשיכטע', 'ווערטער', 'וואס', 'זיך']);
/** Script/word based guess for a title with no explicit language marker. */
export function guessLang(text) {
  const letters = String(text || '').match(/\p{L}/gu) || [];
  if (!letters.length) return 'he';
  if (letters.filter((c) => /[A-Za-z]/.test(c)).length / letters.length > 0.6) return 'en';
  return normalizeKey(text).split(' ').some((w) => YIDDISH_MARKERS.has(w)) ? 'yi' : 'he';
}

/** Drops a trailing language word ("הבינני - אידיש"): { core, lang } (lang null if none). */
export function stripLanguage(title) {
  const tokens = tokenize(title);
  const last = tokens[tokens.length - 1];
  const code = last && tokens.length > 1 ? LANG_BY_WORD.get(last.n) : null;
  if (code && code !== 'he') return { core: joinTokens(tokens.slice(0, -1)), lang: code };
  return { core: String(title ?? '').trim(), lang: null };
}

// ---- title cleanup -------------------------------------------------------------

function joinTokens(tokens) {
  let out = '';
  for (const t of tokens) {
    if (!out) { out = t.w; continue; }
    out += (/[\-–—־]/.test(t.pre) && /\s/.test(t.pre) ? ' - ' : ' ') + t.w;
  }
  return out.replace(/\s+/g, ' ').trim();
}

const EXT_RE = /\.(pdf|docx?|jpe?g|png)$/i;

/** Drops file extension, a "(1)" copy marker, underscores and bidi marks. */
export function stripFileNoise(name) {
  return String(name ?? '')
    .replace(BIDI_RE, '')
    // A year split by underscore or space ("תשע_ז") must not read as 5770 plus a stray letter.
    .replace(/(^|[^א-ת])(ה?תש[יכלמנסעפצ])[_ ]([א-ט])(?![א-ת])/g, '$1$2$3')
    .replace(EXT_RE, '')
    .replace(EXT_RE, '')
    .replace(/\s*\(\d{1,2}\)\s*$/, '')
    .replace(/_+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const TRIM_RE = /^[\s\-–—־,.:;|]+|[\s\-–—־,.:;|]+$/g;

/**
 * Full analysis of a title or file name. Returns
 * { slugs, events, hy, no, noStrong, title } where `title` is the display title
 * without parasha, cue words, year and issue number (possibly empty).
 */
export function analyzeTitle(text, { expect = [], parasha = true } = {}) {
  const tokens = tokenize(stripFileNoise(text));
  const yr = detectHebrewYear(tokens);
  const events = detectEvents(tokens);
  const par = parasha ? detectParasha(tokens, { expect }) : null;
  const drop = new Set();
  let hy = yr ? yr.hy : null;
  if (par) {
    for (let i = par.from; i < par.to; i++) drop.add(i);
    // Cue words before the name belong to the parasha mention.
    for (let i = par.from - 1; i >= 0 && CUE_REMOVE.has(tokens[i].n); i--) drop.add(i);
    // "נח פ''ז": abbreviated year right after the name.
    const after = tokens[par.to];
    if (!hy && after) {
      const short = parseShortYear(after.w);
      if (short) { hy = short; drop.add(par.to); }
    }
  }
  if (yr) {
    drop.add(yr.index);
    for (let i = yr.index - 1; i >= 0 && (tokens[i].n === 'שנת' || tokens[i].n === 'ה'); i--) drop.add(i);
  }
  const no = detectIssueNo(tokens, { skip: drop });
  if (no) {
    drop.add(no.index);
    for (let i = no.index - 1; i >= 0 && NO_PREFIX.has(tokens[i].n); i--) drop.add(i);
  }
  return {
    slugs: par ? par.slugs : [],
    events: events.map((e) => e.slug),
    hy,
    no: no ? no.no : null,
    noStrong: no ? no.strong : false,
    title: joinTokens(tokens.filter((_, i) => !drop.has(i))).replace(TRIM_RE, ''),
  };
}

/**
 * Lenient scan for week labels from a source ("חקת - קרח", "שבועות - נשא"):
 * every parasha name counts, ambiguity is irrelevant because the text is
 * known to be a week name. Returns { slugs:Set, events:[slug] }.
 */
export function weekLabelParts(text) {
  const tokens = tokenize(stripFileNoise(text));
  const slugs = new Set();
  const events = detectEvents(tokens);
  const inEvent = new Set(events.flatMap((e) => Array.from({ length: e.to - e.from }, (_, k) => e.from + k)));
  for (let i = 0; i < tokens.length; i++) {
    if (inEvent.has(i)) continue;
    const abbr = COMBO_ABBR.find(([a]) => a === tokens[i].n);
    if (abbr) { abbr[1].forEach((s) => slugs.add(s)); continue; }
    const p = matchAt(tokens, i);
    if (p) { slugs.add(p.slug); i += p.words.length - 1; }
  }
  return { slugs, events: events.map((e) => e.slug) };
}

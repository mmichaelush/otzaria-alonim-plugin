// Festivals, fasts and special Shabbatot: slugs, Hebrew names, priorities and the
// mapping from Hebcal's event descriptions. The slugs are part of the catalog
// contract (docs/CATALOG_FORMAT.md, weeks.json); add new ones, never rename.
import { gematriya } from '@hebcal/core';

/**
 * slug -> Hebrew name. `secondary` events never become a row's primary `event`
 * (they only appear in `events`), so a Shabbat does not read "בראשית – שבת מברכים".
 */
export const EVENTS = {
  'rosh-hashana': { he: 'ראש השנה' },
  'tzom-gedaliah': { he: 'צום גדליה' },
  'aseret-yemei-teshuva': { he: 'עשרת ימי תשובה', secondary: true },
  'shabbat-shuva': { he: 'שבת שובה' },
  'yom-kippur': { he: 'יום כיפור' },
  sukkot: { he: 'סוכות' },
  'chol-hamoed-sukkot': { he: 'חול המועד סוכות' },
  'hoshana-raba': { he: 'הושענא רבה' },
  'shemini-atzeret': { he: 'שמיני עצרת' },
  'simchat-torah': { he: 'שמחת תורה' },
  chanukah: { he: 'חנוכה' },
  'asara-btevet': { he: 'עשרה בטבת' },
  'tu-bishvat': { he: 'ט״ו בשבט' },
  'shabbat-shirah': { he: 'שבת שירה' },
  'shabbat-shekalim': { he: 'שבת שקלים' },
  'shabbat-zachor': { he: 'שבת זכור' },
  'taanit-esther': { he: 'תענית אסתר' },
  purim: { he: 'פורים' },
  'shushan-purim': { he: 'שושן פורים' },
  'shabbat-parah': { he: 'שבת פרה' },
  'shabbat-hachodesh': { he: 'שבת החודש' },
  'shabbat-hagadol': { he: 'שבת הגדול' },
  pesach: { he: 'פסח' },
  'chol-hamoed-pesach': { he: 'חול המועד פסח' },
  'shvii-shel-pesach': { he: 'שביעי של פסח' },
  'lag-baomer': { he: 'ל״ג בעומר' },
  shavuot: { he: 'שבועות' },
  'shiva-asar-btammuz': { he: 'י״ז בתמוז' },
  'tisha-bav': { he: 'תשעה באב' },
  'shabbat-chazon': { he: 'שבת חזון' },
  'shabbat-nachamu': { he: 'שבת נחמו' },
  'rosh-chodesh': { he: 'ראש חודש' },
  'shabbat-mevarchim': { he: 'שבת מברכים', secondary: true },
};

export const EVENT_HE = Object.fromEntries(Object.entries(EVENTS).map(([k, v]) => [k, v.he]));
export const SECONDARY_EVENTS = new Set(Object.entries(EVENTS).filter(([, v]) => v.secondary).map(([k]) => k));

/** Highest first: which event names a day (or Shabbat) when several fall on it. */
export const EVENT_PRIORITY = [
  'rosh-hashana', 'yom-kippur', 'sukkot', 'shemini-atzeret', 'simchat-torah', 'pesach', 'shavuot',
  'hoshana-raba', 'shvii-shel-pesach', 'chol-hamoed-sukkot', 'chol-hamoed-pesach', 'chanukah', 'purim',
  'shushan-purim', 'tisha-bav', 'shabbat-shuva', 'shabbat-hagadol', 'shabbat-zachor', 'shabbat-parah',
  'shabbat-hachodesh', 'shabbat-shekalim', 'shabbat-chazon', 'shabbat-nachamu', 'shabbat-shirah',
  'tzom-gedaliah', 'taanit-esther', 'shiva-asar-btammuz', 'asara-btevet', 'tu-bishvat', 'lag-baomer',
  'rosh-chodesh', 'aseret-yemei-teshuva', 'shabbat-mevarchim',
];

/** Hebcal month name -> { slug, he }. */
export const MONTHS = {
  Tishrei: { slug: 'tishrei', he: 'תשרי' },
  Cheshvan: { slug: 'cheshvan', he: 'חשוון' },
  Kislev: { slug: 'kislev', he: 'כסלו' },
  Tevet: { slug: 'tevet', he: 'טבת' },
  "Sh'vat": { slug: 'shvat', he: 'שבט' },
  Adar: { slug: 'adar', he: 'אדר' },
  'Adar I': { slug: 'adar-1', he: 'אדר א׳' },
  'Adar II': { slug: 'adar-2', he: 'אדר ב׳' },
  Nisan: { slug: 'nisan', he: 'ניסן' },
  Iyyar: { slug: 'iyyar', he: 'אייר' },
  Sivan: { slug: 'sivan', he: 'סיוון' },
  Tamuz: { slug: 'tamuz', he: 'תמוז' },
  Av: { slug: 'av', he: 'אב' },
  Elul: { slug: 'elul', he: 'אלול' },
};

const SPECIAL_SHABBAT = {
  'Shabbat Shuva': 'shabbat-shuva', 'Shabbat Shekalim': 'shabbat-shekalim', 'Shabbat Zachor': 'shabbat-zachor',
  'Shabbat Parah': 'shabbat-parah', 'Shabbat HaChodesh': 'shabbat-hachodesh', 'Shabbat HaGadol': 'shabbat-hagadol',
  'Shabbat Shirah': 'shabbat-shirah', 'Shabbat Chazon': 'shabbat-chazon', 'Shabbat Nachamu': 'shabbat-nachamu',
};

const SKIP = /^Erev |^Pesach Sheni|^Purim (Katan|Meshulash)|^Leil Selichot|^Chag HaBanot|Rosh Hashana LaBehemot|^Tu B'Av|^Ta'anit Bechorot|^Yom |^Sigd|^Shabbat Rosh Chodesh|^Mevarchim/;

/**
 * Hebcal event description (diaspora calendar) -> { slug, month? } or null.
 * Day numbers of Sukkot/Pesach split into the festival days, Chol HaMoed and the last days.
 */
export function eventOfDesc(desc) {
  if (desc === 'Yom Kippur') return { slug: 'yom-kippur' };
  if (SKIP.test(desc)) return null;
  if (/^Rosh Hashana( \d+| II)$/.test(desc)) return { slug: 'rosh-hashana' };
  if (/^Tzom Gedaliah/.test(desc)) return { slug: 'tzom-gedaliah' };
  if (/^Sukkot (I|II)$/.test(desc)) return { slug: 'sukkot' };
  if (/^Sukkot (III|IV|V|VI) /.test(desc)) return { slug: 'chol-hamoed-sukkot' };
  if (/^Sukkot VII/.test(desc)) return { slug: 'hoshana-raba' };
  if (desc === 'Shmini Atzeret') return { slug: 'shemini-atzeret' };
  if (desc === 'Simchat Torah') return { slug: 'simchat-torah' };
  if (/^Chanukah/.test(desc)) return { slug: 'chanukah' };
  if (/^Asara B'Tevet/.test(desc)) return { slug: 'asara-btevet' };
  if (desc === 'Tu BiShvat') return { slug: 'tu-bishvat' };
  if (/^Ta'anit Esther/.test(desc)) return { slug: 'taanit-esther' };
  if (desc === 'Purim') return { slug: 'purim' };
  if (desc === 'Shushan Purim') return { slug: 'shushan-purim' };
  if (/^Pesach (I|II)$/.test(desc)) return { slug: 'pesach' };
  if (/^Pesach (III|IV|V|VI) /.test(desc)) return { slug: 'chol-hamoed-pesach' };
  if (/^Pesach (VII|VIII)$/.test(desc)) return { slug: 'shvii-shel-pesach' };
  if (desc === 'Lag BaOmer') return { slug: 'lag-baomer' };
  if (/^Shavuot (I|II)$/.test(desc)) return { slug: 'shavuot' };
  if (/^Tzom Tammuz/.test(desc)) return { slug: 'shiva-asar-btammuz' };
  if (/^Tish'a B'Av/.test(desc)) return { slug: 'tisha-bav' };
  const rc = /^Rosh Chodesh (.+)$/.exec(desc);
  if (rc && MONTHS[rc[1]]) return { slug: 'rosh-chodesh', month: rc[1] };
  if (SPECIAL_SHABBAT[desc]) return { slug: SPECIAL_SHABBAT[desc] };
  return null;
}

/** Label of an event, with the month for Rosh Chodesh ("ראש חודש חשוון"). */
export function eventLabel(slug, month) {
  return slug === 'rosh-chodesh' && month && MONTHS[month] ? `ראש חודש ${MONTHS[month].he}` : EVENT_HE[slug];
}

/**
 * "כ״ז בחשוון תשפ״ז" for an HDate. Gematria comes from @hebcal/core; the month
 * names are ours (Hebcal spells them חשון/סיון).
 */
export function hebrewDateString(hd) {
  const m = MONTHS[hd.getMonthName()];
  // year % 1000 is 0 only in years 5000/6000, which gematriya() rejects: spell the thousands then.
  const year = hd.getFullYear() % 1000 || hd.getFullYear();
  return `${gematriya(hd.getDate())} ב${m.he} ${gematriya(year)}`;
}

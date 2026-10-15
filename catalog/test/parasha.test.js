import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeTitle, tokenize, parseYearWord, weekLabelParts, stripLanguage, langFromName, guessLang, stripFileNoise } from '../lib/parasha.mjs';

const slugs = (t, o) => analyzeTitle(t, o).slugs;

test('parasha: with cue, bare name, spelling variants', () => {
  assert.deepEqual(slugs('להבין מאמרי להבין להתבונן פרשת נח תשפז_.pdf'), ['noach']);
  assert.deepEqual(slugs('שער המלך 240 נח.pdf'), ['noach']);
  assert.deepEqual(slugs('פרשת תצוה'), ['tetzaveh']);
  assert.deepEqual(slugs('פרשת תצווה'), ['tetzaveh']);
  assert.deepEqual(slugs('לך לך'), ['lech-lecha']);
  assert.deepEqual(slugs('פרשת לך־לך תשפו'), ['lech-lecha']);
  assert.deepEqual(slugs('פרשת חקת'), ['chukat']);
  assert.deepEqual(slugs('בחקתי'), []); // misspelling of nothing we know: stay silent
  assert.deepEqual(slugs('חיי שרה'), ['chayei-sara']);
  assert.deepEqual(slugs('וישלח'), ['vayishlach']);
});

test('parasha: double readings, joined by space, maqaf, "ו", or abbreviation', () => {
  assert.deepEqual(slugs('מטות מסעי'), ['matot', 'masei']);
  assert.deepEqual(slugs('מטות-מסעי תשפו'), ['matot', 'masei']);
  assert.deepEqual(slugs('מטות ומסעי'), ['matot', 'masei']);
  assert.deepEqual(slugs('מטות ומסעי'), ['matot', 'masei']);
  assert.deepEqual(slugs('אחרי מות קדושים 5786 גליון 12'), ['achrei-mot', 'kedoshim']);
  assert.deepEqual(slugs('אחרי מות - קדושים'), ['achrei-mot', 'kedoshim']);
  assert.deepEqual(slugs('נצבים וילך'), ['nitzavim', 'vayeilech']);
  assert.deepEqual(slugs('ויקהל פקודי'), ['vayakhel', 'pekudei']);
  assert.deepEqual(slugs('חוקת בלק'), ['chukat', 'balak']);
  assert.deepEqual(slugs('בהר בחוקותי'), ['behar', 'bechukotai']);
  assert.deepEqual(slugs('תזריע מצורע'), ['tazria', 'metzora']);
  assert.deepEqual(slugs('מטו"מ'), ['matot', 'masei']);
  assert.deepEqual(slugs('אחו"ק'), ['achrei-mot', 'kedoshim']);
  assert.deepEqual(slugs('נצו"י'), ['nitzavim', 'vayeilech']);
});

test('parasha: two names that are not a real double reading are not joined', () => {
  assert.deepEqual(slugs('נח לך לך'), ['noach']);
});

test('parasha: everyday words stay silent without a cue', () => {
  for (const t of ['בא לפרעה', 'ספר שמות והדברים', 'דברים בעתם', 'ראה אותו', 'צו השעה', 'הרב נח וינברג']) assert.deepEqual(slugs(t), [], t);
});

test('parasha: ambiguous names count with a cue, a year next to them, or an expectation', () => {
  assert.deepEqual(slugs('פרשת בא'), ['bo']);
  assert.deepEqual(slugs('עלון בא תשפו'), ['bo']);
  assert.deepEqual(slugs('בראשית תשפז'), ['bereshit']);
  assert.deepEqual(slugs('הבינני דברים'), []);
  assert.deepEqual(slugs('הבינני דברים', { expect: ['devarim'] }), ['devarim']);
});

test('parasha: English transliterations', () => {
  assert.deepEqual(slugs('Parshas Noach LP 5787'), ['noach']);
  assert.deepEqual(slugs('Noach 5787'), ['noach']);
  assert.deepEqual(slugs('Zera Shimshon Parshat Lech Lecha'), ['lech-lecha']);
  assert.deepEqual(slugs('Bo Bo'), []);
});

test('special Shabbatot and festivals are reported as events', () => {
  assert.deepEqual(analyzeTitle('שבת שובה האזינו תשפ"ז').events, ['shabbat-shuva']);
  assert.deepEqual(analyzeTitle('צו - שבת הגדול').events, ['shabbat-hagadol']);
  assert.deepEqual(analyzeTitle('חנוכה').events, ['chanukah']);
  assert.deepEqual(analyzeTitle('ראש השנה תשפז').events, ['rosh-hashana']);
  // "שמיני עצרת" is the festival, not parashat Shemini
  assert.deepEqual(analyzeTitle('שמיני עצרת').slugs, []);
  assert.deepEqual(weekLabelParts('שמיני עצרת - שמחת תורה').slugs.size, 0);
  assert.deepEqual([...weekLabelParts('חקת - קרח').slugs].sort(), ['chukat', 'korach']);
});

test('Hebrew year: letters, quotes, 5787, prefix ה, short form after parasha', () => {
  const hy = (t) => analyzeTitle(t).hy;
  assert.equal(hy('גליון תשפ"ז'), 5787);
  assert.equal(hy('גליון תשפז'), 5787);
  assert.equal(hy("גליון תשפ''ו"), 5786);
  assert.equal(hy('גליון תשפ״ה'), 5785);
  assert.equal(hy("גליון ה'תשפ\"ד"), 5784);
  assert.equal(hy('Noach 5787'), 5787);
  assert.equal(hy('פרשת נח פ"ז'), 5787);
  assert.equal(hy("136 עמק השבוע - למייל - נח פ''ז"), 5787);
  assert.equal(hy('תשע"ה'), 5775);
  assert.equal(parseYearWord('תש'), null); // 5700 alone is too ambiguous
  assert.equal(parseYearWord('תשפז'), 5787);
  assert.equal(parseYearWord('תשפה'), 5785);
  assert.equal(parseYearWord('תשובה'), null);
  assert.equal(parseYearWord('1999'), null);
});

test('issue number: keyword, hash, Hebrew numeral, weak trailing number, glued digits', () => {
  const no = (t) => analyzeTitle(t).no;
  assert.equal(no('גליון 21 נח'), 21);
  assert.equal(no("פרשת בא - גליון מס' 33"), 33);
  assert.equal(no('עלון #5'), 5);
  assert.equal(no('תניא גליון ב פרשת נח תשפז'), 2);
  assert.equal(no('שער המלך 240 נח'), 240);
  assert.equal(no('עלון נח 9'), 9);
  assert.equal(no('עלון שבועי - 138נח תשפז'), 138);
  assert.equal(no('מבחן 552-555'), null); // two numbers: not a gilyon number
  assert.equal(no('כל הגליונות פרשת נח'), null);
  assert.equal(no('נח תשפז'), null); // the year is not a number
  assert.equal(analyzeTitle('גליון 21 נח').noStrong, true);
  assert.equal(analyzeTitle('שער המלך 240 נח').noStrong, false);
});

test('display title drops parasha, cue, year and number but keeps the name', () => {
  assert.equal(analyzeTitle('משולחנא דמלכא פר\' נח תשפ\'\'ז.pdf').title, 'משולחנא דמלכא');
  assert.equal(analyzeTitle('אסיפת גליונות - נח.pdf').title, 'אסיפת גליונות');
  assert.equal(analyzeTitle('Parshas Noach LP 5787').title, 'LP');
  assert.equal(analyzeTitle('פרשת נח').title, '');
  assert.equal(analyzeTitle('אסיפת נח לשליחה (1).pdf').slugs[0], 'noach');
});

test('tokenize: RLM marks, maqaf, glued digits', () => {
  assert.deepEqual(tokenize('‏‏דעם רבינס מעשיות 301').map((t) => t.n), ['דעמ', 'רבינס', 'מעשיות', '301']);
  assert.equal(tokenize('לך־לך').length, 2);
  assert.deepEqual(tokenize('138נח').map((t) => t.w), ['138', 'נח']);
});

test('language helpers', () => {
  assert.deepEqual(stripLanguage('הבינני - אידיש'), { core: 'הבינני', lang: 'yi' });
  assert.deepEqual(stripLanguage('זרע שמשון - אנגלית'), { core: 'זרע שמשון', lang: 'en' });
  assert.equal(stripLanguage('הבינני').lang, null);
  assert.equal(langFromName('לשון קדוש'), 'he');
  assert.equal(langFromName('אנגלית'), 'en');
  assert.equal(langFromName('הולנדית'), 'nl');
  assert.equal(langFromName('???'), null);
  assert.equal(guessLang('A WELLSPRING OF CHIZUK'), 'en');
  assert.equal(guessLang('א טיפערן בליק'), 'yi');
  assert.equal(guessLang('אסיפת גליונות'), 'he');
});

test('stripFileNoise', () => {
  assert.equal(stripFileNoise('אסיפת נח לשליחה (1).pdf'), 'אסיפת נח לשליחה');
  assert.equal(stripFileNoise('a_b_c.pdf.pdf'), 'a b c');
});

test('years split by underscore or space, and the number nine that looks like a year', () => {
  assert.equal(analyzeTitle('סוד החשמל פרשת נצבים וילך תשע_ז').hy, 5777);
  assert.equal(analyzeTitle('פרשת וילך ה_תשע_ט').hy, 5779);
  assert.equal(analyzeTitle('תשע ימים').hy, null);
  assert.equal(analyzeTitle('פרשת נצבים וילך תשע').hy, 5770);
  assert.equal(analyzeTitle('גליון תשע"ז').hy, 5777);
});

test('events: festivals, fasts and Rosh Chodesh with its month; the longest phrase wins', () => {
  const ev = (t) => analyzeTitle(t).events;
  assert.deepEqual(ev('חול המועד סוכות'), ['chol-hamoed-sukkot']);
  assert.deepEqual(ev('חוה"מ פסח תשפו'), ['chol-hamoed-pesach']);
  assert.deepEqual(ev('שביעי של פסח'), ['shvii-shel-pesach']);
  assert.deepEqual(ev('פסח'), ['pesach']);
  assert.deepEqual(ev('שושן פורים'), ['shushan-purim']);
  assert.deepEqual(ev('תענית אסתר פורים'), ['taanit-esther', 'purim']);
  assert.deepEqual(ev('הושענא רבה'), ['hoshana-raba']);
  assert.deepEqual(ev('שמיני עצרת - שמחת תורה'), ['shemini-atzeret', 'simchat-torah']);
  assert.deepEqual(ev('י"ז בתמוז'), ['shiva-asar-btammuz']);
  assert.deepEqual(ev('עשרה בטבת'), ['asara-btevet']);
  assert.deepEqual(ev('צום גדליה'), ['tzom-gedaliah']);
  const rc = analyzeTitle('ראש חודש חשוון תשפז');
  assert.deepEqual(rc.events, ['rosh-chodesh']);
  assert.equal(rc.rcMonth, 'Cheshvan');
  assert.equal(analyzeTitle('ראש חודש אדר ב').rcMonth, 'Adar II');
  assert.equal(analyzeTitle('ראש חודש').rcMonth, null);
  assert.deepEqual(analyzeTitle('פרשת נח').events, []);
});

test('false friends: tractates Shevuot and Rosh Hashana, and תשעה as the number nine', () => {
  for (const t of ['מסכת שבועות גיליון 4 דף כו - לב', 'תמצית הדף היומי 131 שבועות ל"ד עד עבודה זרה', 'ראש השנה דף ג', 'מסכת ראש השנה']) assert.deepEqual(analyzeTitle(t).events, [], t);
  assert.deepEqual(analyzeTitle('החיזוק היומי שבועות תשפד').events, ['shavuot']);
  assert.deepEqual(analyzeTitle('הלכות שבועות').events, ['shavuot']);
  assert.deepEqual(analyzeTitle('שבועות פד').events, ['shavuot']); // 84 is beyond the tractate: a short year
  assert.equal(analyzeTitle('דיני תשעה באב תשפו').hy, 5786);
  assert.equal(analyzeTitle('שנת תשע"ה תשעה באב').hy, 5775);
});

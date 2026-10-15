// JSDoc types of the catalog's data (documentation only; this module exports nothing).
// The authoritative description of the files is docs/CATALOG_FORMAT.md; RawIssue and Item
// (the stages before the merge) are in enrich.mjs, WeekRow in calendar.mjs.

/**
 * One copy of an issue at one source, as held in memory (urls absolute and escaped).
 * On disk url/page/thumb are compressed per source (lib/urls.mjs) and rawTitle may be omitted (lib/wire.mjs).
 * @typedef {object} Asset
 * @property {string} src          source id: ladaat | tashma | gilyoines | alonolam
 * @property {string} ext          the file's id at the source
 * @property {string} [url]        direct PDF link
 * @property {string} [page]       the source's page for it
 * @property {string} [thumb]      thumbnail
 * @property {number} [bytes] @property {number} [pages] @property {number} [downloads]
 * @property {string} rawTitle     file name or title as the source gives it
 */

/**
 * An issue: the same publication, week and number, with every copy we found.
 * @typedef {object} Issue
 * @property {string} id           "i_" + 12 hex, stable (lib/merge.mjs)
 * @property {string} series       series id
 * @property {string} title
 * @property {number|null} [no]
 * @property {string|null} [date]  Shabbat/festival date the issue belongs to, not the upload date
 * @property {number|null} [hy]    Hebrew year
 * @property {string[]} [parasha]  slugs
 * @property {string|null} [event] event slug of that week
 * @property {string} lang
 * @property {number|null} [pages]
 * @property {string} added        ISO UTC, earliest sighting
 * @property {true} [archive]      `added` is not news (lib/archive.mjs)
 * @property {Asset[]} assets      at least one, best source first
 */

/**
 * A series: one publication over the years, across sources.
 * @typedef {object} Series
 * @property {string} id           "s_" + 10 hex of sha1(canonical key)
 * @property {string} title @property {string[]} [aliases] @property {string[]} [previousIds]
 * @property {string} lang @property {string} [circle] @property {'weekly'|'timeless'} kind
 * @property {{src: string, ext: string, title: string}[]} sources
 * @property {number} issueCount @property {number[]} [years] Hebrew years with issues
 * @property {string} [first] @property {string} [last] dates
 */

export {};

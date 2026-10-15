// Types for the plugin's public data shapes (docs/CATALOG_FORMAT.md) and the globals the
// classic-script modules share. Used only by `npm run typecheck` (tsc --noEmit, dev only);
// the plugin itself has no build.

/** A catalog asset (one file at one source). */
interface Asset {
  src: string;
  ext?: string;
  url?: string;
  page?: string;
  thumb?: string;
  bytes?: number;
  pages?: number;
  downloads?: number;
  rawTitle?: string;
  noUrl?: boolean;
}

/** An issue as the UI sees it (`CatalogIndex.item`): no URLs until hydrated. */
interface Item {
  id: string;
  series: string;
  seriesTitle: string;
  title: string;
  no: number | null;
  date: string | null;
  hy: number | null;
  parasha: string[];
  event: string | null;
  lang: string;
  pages: number | null;
  added: string | null;
  assets: Asset[];
  circleName: string;
  archive?: boolean;
  /** Internal: index position, normalized series title, "new" time (ms), date (ms), bytes, downloads. */
  _i: number;
  _ns: string;
  _added: number;
  _date: number;
  _bytes: number;
  _dl: number;
  _shard: string;
}

/** A row of weeks.json (or weeks-archive.json). */
interface WeekRow {
  date: string;
  hy: number;
  hebrew?: string;
  parasha: string[];
  parashaIL?: string[];
  label?: string;
  event?: string | null;
  events?: string[];
  shabbat?: boolean;
  derived?: boolean;
}

/** The canonical filter object (alonim-filters.js). Lists are OR, different keys are AND. */
interface FilterSpec {
  parasha?: string[];
  event?: string[];
  hy?: number[];
  lang?: string[];
  source?: string[];
  circle?: string[];
  series?: string[];
  dateFrom?: string;
  dateTo?: string;
  hyFrom?: number;
  hyTo?: number;
  pagesMin?: number;
  pagesMax?: number;
  sizeMin?: number;
  sizeMax?: number;
  multi?: boolean;
  favorite?: boolean;
  followed?: boolean;
  downloaded?: boolean;
  inList?: boolean;
  unread?: boolean;
  isNew?: boolean;
  sinceVisit?: boolean;
  hiddenOnly?: boolean;
}

/** User-state predicates the search needs (built by App.searchContext). */
interface SearchContext {
  isFavorite?: (item: Item) => boolean;
  isFollowed?: (item: Item) => boolean;
  isDownloaded?: (item: Item) => boolean;
  inList?: (item: Item) => boolean;
  isRead?: (item: Item) => boolean;
  isNew?: (item: Item) => boolean;
  lastVisit?: number;
}

interface SearchResult {
  idx: number[];
  total: number;
  hidden: number;
  ms: number;
  query: unknown;
}

/** Response envelope of Otzaria.call. */
interface SdkResponse<T = unknown> {
  success: boolean;
  data: T | null;
  error: { code: string; message?: string } | null;
}

// Globals shared by the classic scripts (each file registers itself on `Alonim`).
declare var Alonim: any;
declare var ALONIM_TRANSLATIONS: any;
interface Window {
  Alonim: any;
  Otzaria: any;
  __alonimApp: any;
  ALONIM_TRANSLATIONS: any;
}
interface Performance {
  memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number };
}
